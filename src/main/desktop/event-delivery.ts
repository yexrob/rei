import { ipcMain, type BrowserWindow } from 'electron'
import { DESKTOP_IPC, type DesktopEvent } from '../../shared/desktop'
import { trustedSender } from './security'
import { DesktopFailure } from './rpc-client'

// The control reserve is INCLUDED in the total budget, not an extra IPC lane.
// Two validated 4096-character paths can expand to ~48 KiB when JSON-escaped.
export const EVENT_DELIVERY_LIMITS = { inFlight: 256, events: 4096, bytes: 32 * 1024 * 1024, controlBytes: 64 * 1024, timeout: 30_000 } as const
type Queued = { event: DesktopEvent; size: number }
type Pending = { size: number; sentAt: number }

/** A bounded FIFO absorbs synchronous stdout bursts; ACKs clock the Electron window. */
export class EventDelivery {
  private nextId = 0
  private bytes = 0
  private readonly pending = new Map<number, Pending>()
  private queue: Queued[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private failed = false
  private reportingFailure = false
  private transportBroken = false
  private draining = false

  constructor(private readonly window: () => BrowserWindow | null, documentUrl: string, private readonly overflow: (error: DesktopFailure) => void) {
    ipcMain.on('desktop:event-ack', (event, id: unknown) => {
      const target = window()
      if (!target || !trustedSender(event, target.webContents, documentUrl) || typeof id !== 'number' || !Number.isSafeInteger(id)) return
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      this.bytes -= pending.size
      this.drain()
    })
  }

  /** Only a destroyed/replaced renderer invalidates outstanding IPC deliveries. IDs never repeat. */
  reset(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending.clear()
    this.queue = []
    this.bytes = 0
    this.failed = false
    this.reportingFailure = false
    this.transportBroken = false
  }

  /** Explicit reconnect must not erase unacknowledged IPC or restart an old deadline. */
  recover(): void {
    if (!this.failed) return
    if (this.transportBroken || this.pending.size || this.queue.length) throw new DesktopFailure('RENDERER_BACKPRESSURE', 'The window is still recovering runtime events. Wait for it to catch up, or reload the window before reconnecting.')
    this.failed = false
  }

  send(event: DesktopEvent): void {
    const target = this.window()
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return
    // abort() synchronously publishes one terminal connection notice. Keep that
    // notice behind existing IPC, but fuse runtime events until reconnect.
    // Native menu commands remain usable and consume the same bounded budget.
    const control = this.failed && this.reportingFailure
    if (this.failed && !control && event.type !== 'menu') return
    if (control) this.reportingFailure = false
    const size = Buffer.byteLength(JSON.stringify(event))
    if (control) {
      if (size > EVENT_DELIVERY_LIMITS.controlBytes) return
    } else if (this.pending.size + this.queue.length >= EVENT_DELIVERY_LIMITS.events - 1 || this.bytes + size > EVENT_DELIVERY_LIMITS.bytes - EVENT_DELIVERY_LIMITS.controlBytes) {
      this.fail()
      return
    }
    this.queue.push({ event, size })
    this.bytes += size
    this.drain()
  }

  private drain(): void {
    if (this.draining || this.transportBroken) return
    this.draining = true
    try {
      const target = this.window()
      if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return
      while (this.queue.length && this.pending.size < EVENT_DELIVERY_LIMITS.inFlight) {
        const next = this.queue.shift()!
        const id = ++this.nextId
        this.pending.set(id, { size: next.size, sentAt: Date.now() })
        try { target.webContents.send(DESKTOP_IPC.event, { id, event: next.event }) }
        catch {
          // A throwing transport may have accepted the packet. Retain its budget
          // conservatively until renderer replacement, never loop/retry the send.
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
    if (this.failed) return
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
    // Recovery is now snapshot-based. Never pretend discarded frames were ACKed:
    // already-sent messages still occupy the physical IPC window and byte budget.
    for (const queued of this.queue) this.bytes -= queued.size
    this.queue = []
    this.reportingFailure = true
    try { this.overflow(new DesktopFailure('RENDERER_BACKPRESSURE', 'The window could not keep up with runtime events. Reconnect to recover an authoritative snapshot.')) }
    finally { this.reportingFailure = false }
  }
}
