import { beforeEach, expect, it, vi } from 'vitest'
import type { BingoDesktopApi, BoundedDelivery, PartRequest } from '../shared/desktop'
import { DESKTOP_IPC } from '../shared/desktop'
import { epochA, selectionB, pageTargetA, interleavedHostEvents, rendererInvalidated } from '../shared/desktop.fixtures'
const bridge = vi.hoisted(() => ({ api: undefined as unknown as BingoDesktopApi, listeners: new Map<string, (native: unknown, delivery: unknown) => void>(), invoke: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, api: BingoDesktopApi) => { if (name === 'bingoDesktop') bridge.api = api } },
  ipcRenderer: { on: (name: string, callback: (native: unknown, delivery: unknown) => void) => bridge.listeners.set(name, callback), invoke: bridge.invoke, send: bridge.send }
}))
vi.mock('./panels', () => ({ installPanelsBridge: vi.fn() }))
vi.mock('./review', () => ({ installReviewBridge: vi.fn() }))
beforeEach(async () => { vi.resetModules(); bridge.listeners.clear(); bridge.invoke.mockReset().mockResolvedValue({ ok: true, value: undefined }); bridge.send.mockReset(); await import('./index') })
it('bridges frozen host epoch, selection and identity-only page fixtures through exact allowlisted channels', async () => {
  await bridge.api.reconnect(epochA); await bridge.api.closeHost(epochA); await bridge.api.selectConversation(selectionB); await bridge.api.selectConversation(null); await bridge.api.openAgentPage(pageTargetA)
  expect(bridge.invoke.mock.calls).toEqual([[DESKTOP_IPC.reconnect, epochA], [DESKTOP_IPC.closeHost, epochA], [DESKTOP_IPC.selectConversation, selectionB], [DESKTOP_IPC.selectConversation, null], [DESKTOP_IPC.openAgentPage, pageTargetA]])
  expect(Object.isFrozen(bridge.api)).toBe(true)
  expect(bridge.api).not.toHaveProperty('ipcRenderer')
})
it('bridges only small request/part receipts, never returns large bodies from invoke', async () => {
  const request = { transferId: 'test-result', hostId: 'host-project-a', request: { connectionId: 'epoch-a-1', method: 'session/listHeads' as const, params: { maxBytes: 4 * 1024 * 1024 } } }
  const part: PartRequest = { transferId: 'test-part', hostId: 'host-project-a', connectionId: 'epoch-a-1', session: 'session-a', kind: 'item', item: 'itm-1', generation: 0, token: 'token', offset: 0, maxBytes: 256 * 1024 }
  await bridge.api.requestBounded(request)
  await bridge.api.readPart(part)
  await bridge.api.cancelBounded({ transferId: request.transferId, connectionId: request.request.connectionId, session: null })
  await bridge.api.cancelPart({ transferId: part.transferId, connectionId: part.connectionId, session: part.session })
  expect(bridge.invoke.mock.calls).toEqual([
    [DESKTOP_IPC.requestBounded, request], [DESKTOP_IPC.readPart, part],
    [DESKTOP_IPC.cancelBounded, { transferId: 'test-result', connectionId: 'epoch-a-1', session: null }],
    [DESKTOP_IPC.cancelPart, { transferId: 'test-part', connectionId: 'epoch-a-1', session: 'session-a' }]
  ])
})
it('NACKs bounded packets with no consumer or a rejecting consumer instead of ordinary finally-ACK', async () => {
  const delivery: BoundedDelivery = { kind: 'response', transferId: 'large', hostId: 'h', connectionId: 'c', session: null, method: 'session/listHeads', result: { heads: [] } }
  const dispatch = bridge.listeners.get(DESKTOP_IPC.boundedPacket)!
  dispatch({}, { id: 17, delivery })
  await vi.waitFor(() => expect(bridge.send).toHaveBeenCalledWith(DESKTOP_IPC.boundedAck, { id: 17, ok: false }))
  let rejectReceipt!: (value: unknown) => void
  bridge.invoke.mockImplementationOnce(() => new Promise(resolve => { rejectReceipt = resolve }))
  const waiting = bridge.api.requestBounded({ transferId: delivery.transferId, hostId: delivery.hostId, request: { connectionId: delivery.connectionId, method: 'session/listHeads', params: { maxBytes: 4096 } } })
  const consumer = vi.fn(async () => { throw new Error('renderer rejected this body') })
  const off = bridge.api.onBounded(consumer)
  dispatch({}, { id: 18, delivery })
  await vi.waitFor(() => expect(bridge.send).toHaveBeenCalledWith(DESKTOP_IPC.boundedAck, { id: 18, ok: false }))
  expect(consumer).toHaveBeenCalledOnce()
  rejectReceipt({ ok: false, error: { code: 'BOUNDED_CONSUMER_REJECTED', message: 'no content accepted' } })
  await waiting
  off()
  expect(bridge.send.mock.calls.some(([channel]) => channel === 'desktop:event-ack')).toBe(false)
})
it('waits for the sole bounded consumer to finish before a trusted success ACK, and NACKs after unsubscribe', async () => {
  const delivery: BoundedDelivery = { kind: 'part', transferId: 'part', hostId: 'h', connectionId: 'c', session: 's', partKind: 'item', item: 'i', generation: 1, token: 'token', offset: 0, nextOffset: 5, totalBytes: 5, data: 'hello' }
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const consumer = vi.fn(() => pending)
  const off = bridge.api.onBounded(consumer)
  expect(() => bridge.api.onBounded(async () => {})).toThrow()
  let finishReceipt!: (value: unknown) => void
  bridge.invoke.mockImplementationOnce(() => new Promise(resolve => { finishReceipt = resolve }))
  const request: PartRequest = { transferId: 'part', hostId: 'h', connectionId: 'c', session: 's', kind: 'item', item: 'i', generation: 1, token: 'token', offset: 0, maxBytes: 256 * 1024 }
  const waiting = bridge.api.readPart(request)
  bridge.listeners.get(DESKTOP_IPC.boundedPacket)!({}, { id: 21, delivery })
  await Promise.resolve()
  expect(consumer).toHaveBeenCalledExactlyOnceWith(delivery)
  expect(bridge.send).not.toHaveBeenCalled()
  release()
  await vi.waitFor(() => expect(bridge.send).toHaveBeenCalledWith(DESKTOP_IPC.boundedAck, { id: 21, ok: true }))
  finishReceipt({ ok: true, value: { kind: 'part', transferId: 'part', hostId: 'h', connectionId: 'c', session: 's', partKind: 'item', offset: 0, nextOffset: 5, totalBytes: 5 } })
  expect(await waiting).toMatchObject({ ok: true })
  bridge.send.mockClear()
  let next!: () => void
  const second = new Promise<void>(resolve => { next = resolve })
  off()
  const offAgain = bridge.api.onBounded(() => second)
  let rejectAgain!: (value: unknown) => void
  bridge.invoke.mockImplementationOnce(() => new Promise(resolve => { rejectAgain = resolve }))
  const secondRequest = bridge.api.readPart({ ...request, transferId: 'part-2' })
  bridge.listeners.get(DESKTOP_IPC.boundedPacket)!({}, { id: 22, delivery: { ...delivery, transferId: 'part-2' } })
  offAgain(); next()
  await vi.waitFor(() => expect(bridge.send).toHaveBeenCalledWith(DESKTOP_IPC.boundedAck, { id: 22, ok: false }))
  rejectAgain({ ok: false, error: { code: 'BOUNDED_CONSUMER_REJECTED', message: 'consumer left' } })
  await secondRequest
})
it('NACKs a mismatched host or open result identity before the bounded consumer sees data', async () => {
  let finish!: (value: unknown) => void
  bridge.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const consumer = vi.fn(async () => {})
  const off = bridge.api.onBounded(consumer)
  const request = { transferId: 'cross-host', hostId: 'host-a', request: { connectionId: 'epoch-a', method: 'session/listHeads' as const, params: { maxBytes: 4096 } } }
  const first = bridge.api.requestBounded(request)
  bridge.listeners.get(DESKTOP_IPC.boundedPacket)!({}, { id: 91, delivery: { kind: 'response', transferId: request.transferId, hostId: 'host-b', connectionId: 'epoch-a', session: null, method: 'session/listHeads', result: { heads: [] } } })
  await vi.waitFor(() => expect(bridge.send).toHaveBeenCalledWith(DESKTOP_IPC.boundedAck, { id: 91, ok: false }))
  expect(consumer).not.toHaveBeenCalled()
  finish({ ok: false, error: { code: 'STALE_CONNECTION', message: 'source mismatch' } }); await first
  const opened = bridge.api.requestBounded({ transferId: 'wrong-open', hostId: 'host-a', request: { connectionId: 'epoch-a', method: 'session/open', params: { selector: { kind: 'byId', id: 'session-a' }, options: { maxSnapshotBytes: 4096 } } } })
  bridge.listeners.get(DESKTOP_IPC.boundedPacket)!({}, { id: 92, delivery: { kind: 'response', transferId: 'wrong-open', hostId: 'host-a', connectionId: 'epoch-a', session: 'session-a', method: 'session/open', result: { session: 'session-other', snapshot: { seq: 0, summary: { id: 'session-other', cwd: '/project', createdAt: '', updatedAt: '' }, items: [] } } } })
  await vi.waitFor(() => expect(bridge.send).toHaveBeenCalledWith(DESKTOP_IPC.boundedAck, { id: 92, ok: false }))
  expect(consumer).not.toHaveBeenCalled()
  finish({ ok: false, error: { code: 'INVALID_PROTOCOL', message: 'wrong opened session' } }); await opened
  off()
})
it('rejects receipt metadata that disagrees with the already accepted bounded packet', async () => {
  let finish!: (value: unknown) => void
  bridge.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const packet: BoundedDelivery = { kind: 'part', transferId: 'receipt-mismatch', hostId: 'h', connectionId: 'c', session: 's', partKind: 'field', token: 'token', offset: 0, nextOffset: 5, totalBytes: 5, data: 'hello' }
  const off = bridge.api.onBounded(async () => {})
  const waiting = bridge.api.readPart({ kind: 'field', transferId: packet.transferId, hostId: packet.hostId, connectionId: packet.connectionId, session: packet.session!, token: packet.token, offset: 0, maxBytes: 256 * 1024 })
  bridge.listeners.get(DESKTOP_IPC.boundedPacket)!({}, { id: 93, delivery: packet })
  await vi.waitFor(() => expect(bridge.send).toHaveBeenCalledWith(DESKTOP_IPC.boundedAck, { id: 93, ok: true }))
  finish({ ok: true, value: { kind: 'part', transferId: packet.transferId, hostId: packet.hostId, connectionId: packet.connectionId, session: packet.session, partKind: 'field', offset: 0, nextOffset: 4, totalBytes: 5 } })
  await expect(waiting).resolves.toMatchObject({ ok: false, error: { code: 'TRANSFER_MISMATCH' } })
  off()
})
it('preserves interleaved host events/global invalidation order and ACKs despite a throwing subscriber', () => {
  const events = [...interleavedHostEvents, rendererInvalidated], received: unknown[] = []
  bridge.api.onEvent(() => { throw new Error('isolated subscriber') })
  bridge.api.onEvent(event => received.push(event))
  for (const [index, event] of events.entries()) bridge.listeners.get(DESKTOP_IPC.event)!({ privileged: true }, { id: index + 1, event })
  expect(received).toEqual(events)
  expect(bridge.send.mock.calls).toEqual(events.map((_, index) => ['desktop:event-ack', index + 1]))
})
it('bridges attention notices and validates notification activations before routing them', async () => {
  const notice = { kind: 'waiting' as const, title: 'Bingo needs your input', body: 'Task', hostId: 'h', sessionId: 's' }
  await bridge.api.notify!(notice); await bridge.api.setBadgeCount!(2)
  expect(bridge.invoke.mock.calls).toEqual([[DESKTOP_IPC.notify, notice], [DESKTOP_IPC.setBadgeCount, 2]])
  const listener = vi.fn()
  const off = bridge.api.onNotificationActivated!(listener)
  const dispatch = bridge.listeners.get(DESKTOP_IPC.notificationActivated)!
  dispatch({}, { hostId: 'h', sessionId: 's', extra: 'ignored' }); dispatch({}, { hostId: 1 }); dispatch({}, null)
  expect(listener.mock.calls).toEqual([[{ hostId: 'h', sessionId: 's' }]])
  off(); dispatch({}, { hostId: 'h', sessionId: 's' })
  expect(listener).toHaveBeenCalledOnce()
  expect(bridge.api.homeDirectory === null || typeof bridge.api.homeDirectory === 'string').toBe(true)
})
