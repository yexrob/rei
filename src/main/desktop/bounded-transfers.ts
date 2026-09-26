import type { BoundedDelivery, BoundedReceipt, BoundedRequest, PartRequest, TransferCancel } from '../../shared/desktop'
import type { SerializedPart } from '../../shared/rpc'
import { DesktopFailure } from './rpc-client'
import { DEFAULT_BOUNDED_BYTES, type RuntimePool } from './runtime-pool'
import type { EventDelivery } from './event-delivery'

const PART_BYTES = 256 * 1024
const MAX_ACTIVE = 8
const MAX_WAITING = 32
const MAX_PER_HOST_WAITING = 8
const MAX_INPUT_BYTES = 64 * 1024
const MAX_WAITING_BYTES = 2 * 1024 * 1024
const fail = (code: string, message: string): DesktopFailure => new DesktopFailure(code, message)
type Work = {
  id: string; hostId: string; connectionId: string; session: string | null; kind: 'response' | 'part'
  bytes: number; active: boolean; cancelled: boolean; settled: boolean
  run(): Promise<BoundedReceipt>; resolve(value: BoundedReceipt): void; reject(error: Error): void
}

/** One finite host-local FIFO for opt-in results and explicit part reads.
 * Main never returns a body through invoke: its sole downlink is EventDelivery.
 */
export class BoundedTransfers {
  private readonly waiting: Work[] = []
  private readonly activeHosts = new Set<string>()
  private readonly work = new Map<string, Work>()
  private waitingBytes = 0
  constructor(private readonly runtime: RuntimePool, private readonly delivery: EventDelivery) {}

  async requestBounded(input: BoundedRequest): Promise<BoundedReceipt> {
    this.validateBounded(input)
    const connection = this.runtime.getConnection(input.request.connectionId)
    if (connection.hostId !== input.hostId) throw fail('STALE_CONNECTION', 'The bounded result belongs to another project.')
    const session = this.requestSession(input)
    return this.submit(input.transferId, input.hostId, input.request.connectionId, session, 'response', input, async () => {
      const result = await this.runtime.request(input.request)
      if (this.work.get(input.transferId)?.cancelled) throw fail('TRANSFER_CANCELLED', 'The old bounded response arrived after cancellation.')
      const current = this.runtime.getConnection(input.request.connectionId)
      if (current.hostId !== input.hostId) throw fail('STALE_CONNECTION', 'The bounded result belongs to an old project epoch.')
      const actualSession = input.request.method === 'session/open' ? (result as { session: string }).session : session
      const delivery = { kind: 'response', transferId: input.transferId, hostId: input.hostId, connectionId: input.request.connectionId, session: actualSession, method: input.request.method, result } as BoundedDelivery
      await this.delivery.sendBounded(delivery)
      return { kind: 'response', transferId: input.transferId, hostId: input.hostId, connectionId: input.request.connectionId, session: actualSession, method: input.request.method, acceptedBytes: Buffer.byteLength(JSON.stringify(delivery)) }
    })
  }

  async readPart(input: PartRequest): Promise<BoundedReceipt> {
    this.validatePart(input)
    const connection = this.runtime.getConnection(input.connectionId)
    if (connection.hostId !== input.hostId) throw fail('STALE_CONNECTION', 'The part belongs to another project.')
    this.runtime.referenceFor(input)
    return this.submit(input.transferId, input.hostId, input.connectionId, input.session, 'part', input, async () => {
      // RPC itself is <=256 KiB of UTF-8 source data; there is no unbounded
      // concat/parse of an item/event in Main or React.
      const result: SerializedPart = await this.runtime.readCorePart(input)
      if (this.work.get(input.transferId)?.cancelled) throw fail('TRANSFER_CANCELLED', 'The old Core part arrived after cancellation.')
      this.runtime.getConnection(input.connectionId)
      const nextOffset = result.nextOffset ?? null
      const bytes = Buffer.byteLength(result.data, 'utf8')
      if (result.totalBytes !== this.runtime.referenceFor(input).totalBytes || bytes > input.maxBytes || bytes === 0 && input.offset < result.totalBytes ||
        nextOffset !== null && (nextOffset !== input.offset + bytes || nextOffset > result.totalBytes) ||
        nextOffset === null && input.offset + bytes !== result.totalBytes) throw fail('INVALID_PROTOCOL', 'The runtime returned an inconsistent bounded part; nothing was accepted.')
      const identity = { transferId: input.transferId, hostId: input.hostId, connectionId: input.connectionId, session: input.session }
      const delivery: BoundedDelivery = { ...identity, kind: 'part', partKind: input.kind, ...(input.kind === 'item' ? { item: input.item, generation: input.generation } : {}), token: input.token, offset: input.offset, nextOffset, totalBytes: result.totalBytes, data: result.data }
      await this.delivery.sendBounded(delivery)
      return { ...identity, kind: 'part', partKind: input.kind, offset: input.offset, nextOffset, totalBytes: result.totalBytes }
    })
  }

  cancelBounded(input: TransferCancel): void { this.cancel(input, 'response') }
  cancelPart(input: TransferCancel): void { this.cancel(input, 'part') }
  cancelAll(): void { for (const work of [...this.work.values()]) this.cancel({ transferId: work.id, connectionId: work.connectionId, session: work.session }, work.kind) }
  cancelHost(hostId: string): void { for (const work of [...this.work.values()]) if (work.hostId === hostId) this.cancel({ transferId: work.id, connectionId: work.connectionId, session: work.session }, work.kind) }

  private requestSession(input: BoundedRequest): string | null {
    const { method, params } = input.request
    if (method === 'session/listHeads') return null
    if (method === 'session/history') return (params as { session: string }).session
    if (method === 'session/children') return (params as { parent: string }).parent
    const selector = (params as { selector: { kind: string; id?: string } }).selector
    return selector.kind === 'byId' ? selector.id ?? null : null
  }
  private validateBounded(input: BoundedRequest): void {
    if (!input.transferId || input.transferId.length > 100) throw fail('INVALID_INPUT', 'A bounded request needs a short transfer id.')
    const { method, params } = input.request
    const budget = method === 'session/open' ? (params as { options?: { maxSnapshotBytes?: number | null } }).options?.maxSnapshotBytes
      : method === 'session/history' ? (params as { page?: { maxBytes?: number | null } }).page?.maxBytes
        : (params as { maxBytes?: number | null }).maxBytes
    if (budget === undefined || budget === null) throw fail('BOUNDED_REQUIRED', 'Use an explicit byte budget; an unbounded result cannot cross this bridge.')
    if (!Number.isSafeInteger(budget) || budget < 1024 || budget > DEFAULT_BOUNDED_BYTES) throw fail('INVALID_BUDGET', 'Request between 1 KiB and 4 MiB per bounded result.')
  }
  private validatePart(input: PartRequest): void {
    if (!input.transferId || input.transferId.length > 100 || !Number.isSafeInteger(input.offset) || input.offset < 0) throw fail('INVALID_INPUT', 'Invalid part identity or offset.')
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > PART_BYTES) throw fail('INVALID_BUDGET', 'Request at most 256 KiB for one part.')
  }
  private submit(id: string, hostId: string, connectionId: string, session: string | null, kind: Work['kind'], input: unknown, run: () => Promise<BoundedReceipt>): Promise<BoundedReceipt> {
    if (this.work.has(id) || this.delivery.hasTransfer(id)) throw fail('TRANSFER_IN_PROGRESS', 'This transfer identifier is already reserved.')
    const bytes = Buffer.byteLength(JSON.stringify(input))
    if (bytes > MAX_INPUT_BYTES) throw fail('BOUNDED_REQUEST_TOO_LARGE', 'A bounded request itself must fit in 64 KiB.')
    if (this.waiting.length >= MAX_WAITING || this.waitingBytes + bytes > MAX_WAITING_BYTES || this.waiting.filter(work => work.hostId === hostId).length >= MAX_PER_HOST_WAITING) throw fail('BOUNDED_BACKPRESSURE', 'Too many read-only operations are queued. Wait for the current results.')
    return new Promise<BoundedReceipt>((resolve, reject) => {
      const work: Work = { id, hostId, connectionId, session, kind, bytes, active: false, cancelled: false, settled: false, run, resolve, reject }
      this.work.set(id, work)
      this.waiting.push(work)
      this.waitingBytes += bytes
      this.drain()
    })
  }
  private cancel(input: TransferCancel, kind: Work['kind']): void {
    const work = this.work.get(input.transferId)
    if (!work) return // Idempotent cancellation after a receipt.
    if (work.kind !== kind || work.connectionId !== input.connectionId || work.session !== input.session) throw fail('STALE_CONNECTION', 'This cancellation belongs to another bounded result or session.')
    work.cancelled = true
    this.reject(work, fail('TRANSFER_CANCELLED', 'This read was cancelled. No content or cursor was accepted.'))
    if (work.active) { if (this.delivery.hasTransfer(work.id)) this.delivery.cancelTransfer(work.id); return }
    const index = this.waiting.indexOf(work)
    if (index >= 0) { this.waiting.splice(index, 1); this.waitingBytes -= work.bytes }
    this.work.delete(work.id)
    this.drain()
  }
  private reject(work: Work, error: Error): void { if (work.settled) return; work.settled = true; work.reject(error) }
  private drain(): void {
    for (let index = 0; index < this.waiting.length && this.activeHosts.size < MAX_ACTIVE;) {
      const work = this.waiting[index]
      if (this.activeHosts.has(work.hostId)) { index += 1; continue }
      this.waiting.splice(index, 1)
      this.waitingBytes -= work.bytes
      work.active = true
      this.activeHosts.add(work.hostId)
      void this.run(work)
    }
  }
  private async run(work: Work): Promise<void> {
    let release: (() => void) | undefined
    try {
      if (work.cancelled) return
      const current = this.runtime.getConnection(work.connectionId)
      if (current.hostId !== work.hostId) throw fail('STALE_CONNECTION', 'The queued request belongs to another project.')
      release = this.runtime.holdDelivery({ hostId: work.hostId, connectionId: work.connectionId })
      const receipt = await work.run()
      if (!work.cancelled && !work.settled) { work.settled = true; work.resolve(receipt) }
    } catch (error) { this.reject(work, error instanceof Error ? error : fail('DESKTOP_ERROR', 'The bounded request failed.')) }
    finally {
      release?.()
      this.activeHosts.delete(work.hostId)
      this.work.delete(work.id)
      this.drain()
    }
  }
}
