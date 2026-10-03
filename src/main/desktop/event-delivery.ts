import { ipcMain, type BrowserWindow } from 'electron'
import { DESKTOP_IPC, type BoundedDelivery, type ConnectionState, type DesktopEvent } from '../../shared/desktop'
import { trustedSender } from './security'
import { DesktopFailure } from './rpc-client'

// The control reserve is INCLUDED in the total budget, not an extra IPC lane.
// Two validated 4096-character paths can expand to ~48 KiB when JSON-escaped.
export const EVENT_DELIVERY_LIMITS = { inFlight: 256, events: 4096, bytes: 32 * 1024 * 1024, controlBytes: 64 * 1024, timeout: 30_000 } as const
type Ticket = { transferId: string; settled: boolean; id?: number; resolve(): void; reject(error: DesktopFailure): void }
type Queued = { channel: string; payload: { event: DesktopEvent } | { delivery: BoundedDelivery }; size: number; charged: boolean; ticket?: Ticket }
type Pending = { size: number; sentAt: number; ticket?: Ticket }
type Dropped = { connectionId: string; session: string; root?: string | null; from: number; to: number }
const MAX_DROPPED_SESSIONS = 4096
const error = (code: string, message: string) => new DesktopFailure(code, message)

/** One bounded FIFO/window for runtime events and explicitly accepted results. */
export class EventDelivery {
  private nextId = 0
  private bytes = 0
  private readonly pending = new Map<number, Pending>()
  private readonly tickets = new Map<string, Ticket>()
  private queue: Queued[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private failed = false
  private reportingFailure = false
  private transportBroken = false
  private draining = false
  private suspended = false
  // Runtime traffic fused while the renderer was behind. Recovery replays it as
  // canonical 'lagged' frames so the renderer reopens authoritative snapshots.
  private readonly dropped = new Map<string, Dropped>()
  private readonly droppedGateway = new Map<string, string>()
  private droppedConnections = false

  /** Backpressure only fuses renderer delivery; it never stops native runtimes. */
  constructor(private readonly window: () => BrowserWindow | null, documentUrl: string, private readonly overflow: (failure: DesktopFailure) => void, private readonly connections: () => ConnectionState[] = () => []) {
    ipcMain.on('desktop:event-ack', (event, id: unknown) => {
      if (!this.trusted(event, documentUrl) || !Number.isSafeInteger(id)) return
      const pending = this.pending.get(id as number)
      if (!pending || pending.ticket) return // An ordinary ACK cannot release a result body.
      this.release(id as number)
    })
    ipcMain.on(DESKTOP_IPC.boundedAck, (event, input: unknown) => {
      if (!this.trusted(event, documentUrl) || !input || typeof input !== 'object') return
      const packet = input as { id?: unknown; ok?: unknown }
      if (Object.keys(packet).sort().join(',') !== 'id,ok' || !Number.isSafeInteger(packet.id) || typeof packet.ok !== 'boolean') return
      const pending = this.pending.get(packet.id as number)
      if (!pending?.ticket) return // A bounded ACK cannot free a lifecycle packet.
      const ticket = pending.ticket
      this.release(packet.id as number)
      this.tickets.delete(ticket.transferId)
      if (!ticket.settled) {
        ticket.settled = true
        if (packet.ok) ticket.resolve()
        else ticket.reject(error('BOUNDED_CONSUMER_REJECTED', 'The renderer could not accept this bounded result. Retry after inspecting the current session.'))
      }
    })
  }

  /** Only a destroyed/replaced renderer invalidates outstanding IPC deliveries. IDs never repeat. */
  reset(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    for (const ticket of this.tickets.values()) this.rejectTicket(ticket, error('RENDERER_CHANGED', 'The window changed before it accepted the bounded result. Reopen its authoritative snapshot.'))
    this.tickets.clear()
    this.pending.clear()
    this.queue = []
    this.bytes = 0
    this.failed = false
    this.reportingFailure = false
    this.transportBroken = false
    this.clearDropped()
  }

  /** System sleep must not count against the renderer's ACK deadline. */
  suspend(): void { this.suspended = true; clearTimeout(this.timer); this.timer = undefined }
  resume(): void {
    this.suspended = false
    const now = Date.now()
    for (const pending of this.pending.values()) pending.sentAt = now
    this.armDeadline()
  }

  /** Explicit reconnect must not erase unacknowledged IPC or restart an old deadline. */
  recover(): void {
    if (!this.failed) return
    if (this.transportBroken || this.pending.size || this.queue.length) throw error('RENDERER_BACKPRESSURE', 'The window is still recovering runtime events. Wait for it to catch up, or reload the window before reconnecting.')
    this.resync()
  }

  send(event: DesktopEvent): void {
    const target = this.window()
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return
    // abort() synchronously publishes one terminal connection notice. Keep that
    // notice behind existing IPC, but fuse runtime events until reconnect.
    // Native menu commands remain usable and consume the same bounded budget.
    const control = this.failed && this.reportingFailure
    if (this.failed && !control && event.type !== 'menu') { this.drop(event); return }
    if (control) this.reportingFailure = false
    const size = this.packetBytes({ id: Number.MAX_SAFE_INTEGER, event })
    if (control) {
      if (size > EVENT_DELIVERY_LIMITS.controlBytes) return
    } else if (this.pending.size + this.queue.length >= EVENT_DELIVERY_LIMITS.events - 1 || this.bytes + size > EVENT_DELIVERY_LIMITS.bytes - EVENT_DELIVERY_LIMITS.controlBytes) {
      this.fail()
      this.drop(event)
      return
    }
    this.queue.push({ channel: DESKTOP_IPC.event, payload: { event }, size, charged: true })
    this.bytes += size
    this.drain()
  }

  /** Tracks sent-but-cancelled packets too, so their transfer ids cannot be reused. */
  hasTransfer(transferId: string): boolean { return this.tickets.has(transferId) }

  /** A bounded result only resolves after the trusted async consumer ACKs it. */
  sendBounded(delivery: BoundedDelivery): Promise<void> {
    const target = this.window()
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return Promise.reject(error('WINDOW_CLOSED', 'The conversation window cannot receive this result.'))
    if (this.failed || this.transportBroken) return Promise.reject(error('RENDERER_BACKPRESSURE', 'Reconnect the window before reading more results.'))
    if (this.tickets.has(delivery.transferId)) return Promise.reject(error('TRANSFER_IN_PROGRESS', 'This transfer identifier is still in use.'))
    const size = this.packetBytes({ id: Number.MAX_SAFE_INTEGER, delivery })
    if (size > 8 * 1024 * 1024 + 64 * 1024) return Promise.reject(error('BOUNDED_TOO_LARGE', 'This result exceeds one bounded renderer packet. Request a smaller page.'))
    // This queue may hold at most eight uncharged, bounded producer results.
    // They live in Main, never in Electron's unacknowledged IPC queue. The
    // producer controller enforces the same count before requesting Core data.
    if (this.queue.filter(entry => entry.ticket && !entry.charged).length >= 8 || this.pending.size + this.queue.length >= EVENT_DELIVERY_LIMITS.events - 1) return Promise.reject(error('BOUNDED_BACKPRESSURE', 'Too many bounded results are awaiting the window. Wait for a receipt.'))
    return new Promise<void>((resolve, reject) => {
      const ticket: Ticket = { transferId: delivery.transferId, settled: false, resolve, reject }
      this.tickets.set(delivery.transferId, ticket)
      this.queue.push({ channel: DESKTOP_IPC.boundedPacket, payload: { delivery }, size, charged: false, ticket })
      this.drain()
    })
  }

  /** Cancellation does not pretend that an already-sent IPC packet disappeared. */
  cancelTransfer(transferId: string): void {
    const ticket = this.tickets.get(transferId)
    if (!ticket) return
    this.rejectTicket(ticket, error('TRANSFER_CANCELLED', 'The bounded transfer was cancelled; its outcome was not applied.'))
    if (ticket.id !== undefined) return // Still charged until ACK/NACK or renderer reset.
    const index = this.queue.findIndex(entry => entry.ticket === ticket)
    if (index >= 0) {
      const [queued] = this.queue.splice(index, 1)
      if (queued.charged) this.bytes -= queued.size
    }
    this.tickets.delete(transferId)
    this.drain()
  }

  private packetBytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value)) }
  private trusted(event: { sender: unknown; senderFrame: unknown }, documentUrl: string): boolean {
    const target = this.window()
    return Boolean(target && trustedSender(event, target.webContents, documentUrl))
  }
  private rejectTicket(ticket: Ticket, failure: DesktopFailure): void {
    if (ticket.settled) return
    ticket.settled = true
    ticket.reject(failure)
  }
  private release(id: number): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    this.bytes -= pending.size
    this.drain()
    // The renderer caught up with everything already sent: reopen delivery.
    if (this.failed && !this.transportBroken && !this.pending.size && !this.queue.length) this.resync()
  }
  private drop(event: DesktopEvent): void {
    if (event.type === 'connection') { this.droppedConnections = true; return }
    if (event.type !== 'rpc') return
    if (event.method === 'gateway/event' || event.method === 'gateway/sessionHead') {
      const params = event.params, session = 'session' in params ? params.session : 'summary' in params ? params.summary.id : null
      if (session && (this.droppedGateway.has(event.connectionId) || this.droppedGateway.size < MAX_DROPPED_SESSIONS)) this.droppedGateway.set(event.connectionId, session)
      return
    }
    const { session, seq } = event.params, key = JSON.stringify([event.connectionId, session]), previous = this.dropped.get(key)
    if (previous) { previous.from = Math.min(previous.from, seq); previous.to = Math.max(previous.to, seq); return }
    if (this.dropped.size < MAX_DROPPED_SESSIONS) this.dropped.set(key, { connectionId: event.connectionId, session, root: event.params.root, from: seq, to: seq })
  }
  private clearDropped(): void { this.dropped.clear(); this.droppedGateway.clear(); this.droppedConnections = false }
  /** Publishes current host states and one canonical lagged frame per session with fused events. */
  private resync(): void {
    this.failed = false
    const dropped = [...this.dropped.values()], gateway = [...this.droppedGateway], connections = this.droppedConnections
    this.clearDropped()
    if (connections || dropped.length || gateway.length) for (const connection of this.connections()) this.send({ type: 'connection', connection })
    for (const lost of dropped) this.send({ type: 'rpc', connectionId: lost.connectionId, method: 'event', params: { seq: lost.to, ts: new Date().toISOString(), session: lost.session, ...(lost.root ? { root: lost.root } : {}), event: { type: 'lagged', from: lost.from, to: lost.to } } })
    for (const [connectionId, session] of gateway) this.send({ type: 'rpc', connectionId, method: 'gateway/sessionHead', params: { session } })
  }
  private drain(): void {
    if (this.draining || this.transportBroken) return
    this.draining = true
    try {
      const target = this.window()
      if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return
      while (this.queue.length && this.pending.size < EVENT_DELIVERY_LIMITS.inFlight) {
        const next = this.queue[0]
        if (!next.charged) {
          if (this.bytes + next.size > EVENT_DELIVERY_LIMITS.bytes - EVENT_DELIVERY_LIMITS.controlBytes) break
          this.bytes += next.size
          next.charged = true
        }
        this.queue.shift()
        const id = ++this.nextId
        next.ticket && (next.ticket.id = id)
        this.pending.set(id, { size: next.size, sentAt: Date.now(), ticket: next.ticket })
        try { target.webContents.send(next.channel, { id, ...next.payload }) }
        catch {
          // A throwing transport may have accepted the packet. Retain its
          // physical budget conservatively until renderer replacement.
          this.transportBroken = true
          this.fail()
          break
        }
      }
    } finally {
      this.draining = false
      this.armDeadline()
    }
  }
  private armDeadline(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.failed || this.suspended) return
    const oldest = this.pending.values().next().value
    if (!oldest) return
    this.timer = setTimeout(() => this.fail(), Math.max(0, oldest.sentAt + EVENT_DELIVERY_LIMITS.timeout - Date.now()))
    this.timer.unref()
  }
  private fail(): void {
    if (this.failed) return
    this.failed = true
    clearTimeout(this.timer)
    this.timer = undefined
    // Already-sent packets still occupy the physical window after failure.
    for (const queued of this.queue) {
      if ('event' in queued.payload) this.drop(queued.payload.event)
      if (queued.charged) this.bytes -= queued.size
      if (queued.ticket) { this.rejectTicket(queued.ticket, error('RENDERER_BACKPRESSURE', 'The renderer could not receive this bounded result.')); this.tickets.delete(queued.ticket.transferId) }
    }
    this.queue = []
    for (const pending of this.pending.values()) if (pending.ticket) this.rejectTicket(pending.ticket, error('RENDERER_BACKPRESSURE', 'The renderer did not acknowledge this bounded result.'))
    this.reportingFailure = true
    try { this.overflow(error('RENDERER_BACKPRESSURE', 'The window could not keep up with runtime events. Delivery resumes with fresh snapshots once it catches up.')) }
    finally { this.reportingFailure = false }
  }
}
