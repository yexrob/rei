import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoundedDelivery, BoundedRequest, PartRequest } from '../../shared/desktop'
import { DesktopFailure } from './rpc-client'
import { BoundedTransfers } from './bounded-transfers'
import type { RuntimePool } from './runtime-pool'
import type { EventDelivery } from './event-delivery'

const a = { hostId: 'host-a', connectionId: 'epoch-a', session: 'session-a' }
const b = { hostId: 'host-b', connectionId: 'epoch-b', session: 'session-b' }
const read = (transferId: string, source = a): BoundedRequest<'session/history'> => ({ transferId, hostId: source.hostId, request: { connectionId: source.connectionId, method: 'session/history', params: { session: source.session, page: { maxBytes: 4 * 1024 * 1024, generation: 0, limit: 50 } } } })
const part = (transferId: string, source = a): PartRequest => ({ transferId, ...source, kind: 'item', item: 'item-1', generation: 0, token: 'pin-token', offset: 0, maxBytes: 256 * 1024 })
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; return { promise: new Promise<T>((done, fail) => { resolve = done; reject = fail }), resolve, reject } }
function setup() {
  const sent: BoundedDelivery[] = []
  const acknowledgments = new Map<string, ReturnType<typeof deferred<void>>>()
  const delivery = { sendBounded: vi.fn((value: BoundedDelivery) => { sent.push(value); const gate = deferred<void>(); acknowledgments.set(value.transferId, gate); return gate.promise }), cancelTransfer: vi.fn(), hasTransfer: vi.fn(() => false) }
  const runtime = { getConnection: vi.fn((id: string) => ({ hostId: id === a.connectionId ? a.hostId : b.hostId, connectionId: id, status: 'ready' })), holdDelivery: vi.fn(() => vi.fn()), request: vi.fn(async (input: BoundedRequest['request']) => ({ items: [], next: null, generation: 0 })), referenceFor: vi.fn(() => ({ totalBytes: 5, checksum: 'a430d84680aabd0b' })), readCorePart: vi.fn(async () => ({ data: 'hello', nextOffset: null, totalBytes: 5 })) }
  const manager = new BoundedTransfers(runtime as unknown as RuntimePool, delivery as unknown as EventDelivery)
  return { manager, runtime, delivery, sent, acknowledgments }
}
beforeEach(() => { vi.clearAllMocks() })
describe('finite and source-bound bounded Native transfers', () => {
  it('holds result bytes for consumer ACK, returns only a source receipt, and routes host B while A is blocked', async () => {
    const { manager, runtime, sent, acknowledgments } = setup()
    const waitingA = manager.requestBounded(read('A'))
    const waitingA2 = manager.requestBounded(read('A2'))
    const waitingB = manager.requestBounded(read('B', b))
    await vi.waitFor(() => expect(sent.map(item => item.transferId)).toEqual(['A', 'B']))
    expect(runtime.request).toHaveBeenCalledTimes(2)
    const first: BoundedDelivery = sent[0]
    expect(first).toMatchObject({ kind: 'response', transferId: 'A', hostId: 'host-a', connectionId: 'epoch-a', session: 'session-a', method: 'session/history' })
    acknowledgments.get('B')!.resolve()
    expect(await waitingB).toMatchObject({ kind: 'response', transferId: 'B', hostId: b.hostId, connectionId: b.connectionId, session: b.session, method: 'session/history' })
    expect(sent.map(item => item.transferId)).toEqual(['A', 'B'])
    acknowledgments.get('A')!.resolve()
    expect(await waitingA).toMatchObject({ kind: 'response', transferId: 'A' })
    await vi.waitFor(() => expect(sent.map(item => item.transferId)).toEqual(['A', 'B', 'A2']))
    acknowledgments.get('A2')!.resolve()
    await waitingA2
  })
  it('holds a ninth distinct host request outside Core until one acknowledged slot is freed', async () => {
    const { manager, runtime, sent, acknowledgments } = setup()
    runtime.getConnection.mockImplementation((id: string) => ({ hostId: id, connectionId: id, status: 'ready' }))
    const pending = Array.from({ length: 9 }, (_, index) => {
      const id = `epoch-${index}`
      return manager.requestBounded(read(`request-${index}`, { hostId: id, connectionId: id, session: `session-${index}` }))
    })
    await vi.waitFor(() => expect(sent).toHaveLength(8))
    expect(runtime.request).toHaveBeenCalledTimes(8)
    acknowledgments.get('request-0')!.resolve()
    await pending[0]
    await vi.waitFor(() => expect(sent).toHaveLength(9))
    expect(runtime.request).toHaveBeenCalledTimes(9)
    for (let index = 1; index < 9; index += 1) acknowledgments.get(`request-${index}`)!.resolve()
    expect((await Promise.allSettled(pending)).every(result => result.status === 'fulfilled')).toBe(true)
  })
  it('rejects unknown host, unbounded open/history, mixed source and oversized part before Core writes', async () => {
    const { manager, runtime } = setup()
    await expect(manager.requestBounded({ ...read('foreign'), hostId: b.hostId })).rejects.toMatchObject({ code: 'STALE_CONNECTION' })
    await expect(manager.requestBounded({ ...read('unbounded'), request: { ...read('unbounded').request, params: { session: a.session } } })).rejects.toMatchObject({ code: 'BOUNDED_REQUIRED' })
    await expect(manager.requestBounded({ transferId: 'open', hostId: a.hostId, request: { connectionId: a.connectionId, method: 'session/open', params: { selector: { kind: 'byId', id: a.session } } } })).rejects.toMatchObject({ code: 'BOUNDED_REQUIRED' })
    await expect(manager.readPart({ ...part('huge'), maxBytes: 256 * 1024 + 1 })).rejects.toMatchObject({ code: 'INVALID_BUDGET' })
    expect(runtime.request).not.toHaveBeenCalled(); expect(runtime.readCorePart).not.toHaveBeenCalled()
  })
  it('NACKs only the bad consumer, and rejects the receipt without returning any body to invoke', async () => {
    const { manager, sent, acknowledgments } = setup()
    const aPromise = manager.requestBounded(read('A'))
    const bPromise = manager.requestBounded(read('B', b))
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    const denied = new DesktopFailure('BOUNDED_CONSUMER_REJECTED', 'consumer refused')
    acknowledgments.get('A')!.reject(denied)
    await expect(aPromise).rejects.toMatchObject({ code: 'BOUNDED_CONSUMER_REJECTED' })
    acknowledgments.get('B')!.resolve()
    expect(await bPromise).toMatchObject({ transferId: 'B' })
  })
  it('cancels queued A before Core starts, keeping B and other A results independent', async () => {
    const { manager, runtime, sent, acknowledgments } = setup()
    const first = manager.requestBounded(read('A'))
    const second = manager.requestBounded(read('A2'))
    const other = manager.requestBounded(read('B', b))
    await vi.waitFor(() => expect(sent.map(item => item.transferId)).toEqual(['A', 'B']))
    manager.cancelBounded({ transferId: 'A2', connectionId: a.connectionId, session: a.session })
    await expect(second).rejects.toMatchObject({ code: 'TRANSFER_CANCELLED' })
    acknowledgments.get('A')!.resolve(); acknowledgments.get('B')!.resolve()
    await Promise.all([first, other])
    expect(runtime.request).toHaveBeenCalledTimes(2)
    expect(sent.map(item => item.transferId)).toEqual(['A', 'B'])
  })
  it('returns Core part offset metadata only after that same part is accepted; late canceled Core reply sends nothing', async () => {
    const { manager, runtime, sent, acknowledgments, delivery } = setup()
    const core = deferred<{ data: string; nextOffset: null; totalBytes: number }>()
    runtime.readCorePart.mockImplementationOnce(() => core.promise)
    const pending = manager.readPart(part('P'))
    manager.cancelPart({ transferId: 'P', connectionId: a.connectionId, session: a.session })
    await expect(pending).rejects.toMatchObject({ code: 'TRANSFER_CANCELLED' })
    core.resolve({ data: 'hello', nextOffset: null, totalBytes: 5 })
    await vi.waitFor(() => expect(runtime.holdDelivery).toHaveBeenCalled())
    expect(sent).toEqual([])
    expect(delivery.cancelTransfer).not.toHaveBeenCalled() // Nothing entered Electron.
    const accepted = manager.readPart(part('P2'))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    let settled = false; void accepted.then(() => { settled = true })
    await Promise.resolve(); expect(settled).toBe(false)
    acknowledgments.get('P2')!.resolve()
    expect(await accepted).toEqual({ kind: 'part', transferId: 'P2', ...a, partKind: 'item', offset: 0, nextOffset: null, totalBytes: 5 })
  })
})
