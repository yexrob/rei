import { contextBridge, ipcRenderer } from 'electron'
import { installPanelsBridge } from './panels'
import { installReviewBridge } from './review'
import { DESKTOP_IPC, type BingoDesktopApi, type BoundedDelivery, type BoundedReceipt, type BoundedRequest, type DesktopEvent, type PartRequest, type Result } from '../shared/desktop'
import type { RpcMethods } from '../shared/rpc'

function homeDirectory(): string | null {
  const value = typeof process === 'undefined' ? undefined : process.env?.HOME || process.env?.USERPROFILE
  return typeof value === 'string' && value.length > 1 && value.length <= 4096 ? value : null
}
const activations = new Set<(target: { hostId: string; sessionId: string }) => void>()
ipcRenderer.on(DESKTOP_IPC.notificationActivated, (_event, target: unknown) => {
  const value = target as { hostId?: unknown; sessionId?: unknown } | null
  if (!value || typeof value.hostId !== 'string' || typeof value.sessionId !== 'string' || value.hostId.length > 100 || value.sessionId.length > 512) return
  for (const listener of activations) { try { listener({ hostId: value.hostId, sessionId: value.sessionId }) } catch { /* Isolate subscribers. */ } }
})
const listeners = new Set<(event: DesktopEvent) => void>()
let boundedConsumer: ((delivery: BoundedDelivery) => Promise<void>) | null = null
type AcceptedMeta = { kind: 'response' | 'part'; transferId: string; hostId: string; connectionId: string; session: string | null; method?: string; partKind?: string; offset?: number; nextOffset?: number | null; totalBytes?: number }
type Expected = { hostId: string; connectionId: string; session: string | null; kind: BoundedDelivery['kind']; method?: string; partKind?: string; token?: string; offset?: number; item?: string; generation?: number; seen: boolean; meta?: AcceptedMeta }
const expected = new Map<string, Expected>()
const failure = (code: string, message: string): Result<BoundedReceipt> => ({ ok: false, error: { code, message } })
function source(input: BoundedRequest): string | null {
  const { method, params } = input.request
  if (method === 'session/listHeads') return null
  if (method === 'session/history') return (params as RpcMethods['session/history']['params']).session
  if (method === 'session/children') return (params as RpcMethods['session/children']['params']).parent
  const selector = (params as RpcMethods['session/open']['params']).selector
  return selector.kind === 'byId' ? selector.id : null
}
function matches(part: BoundedDelivery, tracked: Expected): boolean {
  if (part.hostId !== tracked.hostId || part.connectionId !== tracked.connectionId || part.kind !== tracked.kind || (tracked.session !== null && part.session !== tracked.session)) return false
  if (part.kind === 'response') {
    if (part.method !== tracked.method || tracked.method === 'session/listHeads' && part.session !== null) return false
    if (part.method === 'session/open' && (part.result.session !== part.session || part.result.snapshot.summary.id !== part.session)) return false
    return true
  }
  return part.partKind === tracked.partKind && part.token === tracked.token && part.offset === tracked.offset && part.item === tracked.item && part.generation === tracked.generation && typeof part.data === 'string'
}
function acceptedMeta(part: BoundedDelivery): AcceptedMeta {
  const identity = { transferId: part.transferId, hostId: part.hostId, connectionId: part.connectionId, session: part.session }
  return part.kind === 'response' ? { ...identity, kind: 'response', method: part.method }
    : { ...identity, kind: 'part', partKind: part.partKind, offset: part.offset, nextOffset: part.nextOffset, totalBytes: part.totalBytes }
}
async function invokeBounded(input: BoundedRequest | PartRequest, channel: string, tracked: Expected): Promise<Result<BoundedReceipt>> {
  if (expected.has(input.transferId)) return failure('TRANSFER_IN_PROGRESS', 'This transfer identifier is still in use.')
  expected.set(input.transferId, tracked)
  try {
    const answer: Result<BoundedReceipt> = await ipcRenderer.invoke(channel, input)
    if (!answer.ok) return answer
    if (!tracked.seen || !tracked.meta) return failure('TRANSFER_MISMATCH', 'The result arrived before a bounded body was accepted.')
    const receipt = answer.value, packet = tracked.meta
    if (receipt.kind !== packet.kind || receipt.transferId !== packet.transferId || receipt.hostId !== packet.hostId || receipt.connectionId !== packet.connectionId || receipt.session !== packet.session ||
      receipt.kind === 'response' && receipt.method !== packet.method ||
      receipt.kind === 'part' && (receipt.partKind !== packet.partKind || receipt.offset !== packet.offset || receipt.nextOffset !== packet.nextOffset || receipt.totalBytes !== packet.totalBytes)) return failure('TRANSFER_MISMATCH', 'The receipt does not match the acknowledged bounded packet.')
    return answer
  } finally { expected.delete(input.transferId) }
}
ipcRenderer.on(DESKTOP_IPC.event, (_event, delivery: { id: number; event: DesktopEvent }) => {
  try { for (const listener of listeners) { try { listener(delivery.event) } catch { /* One subscriber must not block the others or the acknowledgement. */ } } }
  finally { ipcRenderer.send('desktop:event-ack', delivery.id) }
})
// Unlike ordinary notification delivery, a bounded body must be accepted by
// the one async consumer BEFORE its packet can release Main's physical budget.
ipcRenderer.on(DESKTOP_IPC.boundedPacket, (_event, packet: { id: number; delivery: BoundedDelivery }) => {
  if (!Number.isSafeInteger(packet?.id) || packet.id < 1) return
  const consumer = boundedConsumer
  void Promise.resolve().then(async () => {
    const tracked = expected.get(packet.delivery?.transferId)
    if (!consumer || !tracked || tracked.seen || !matches(packet.delivery, tracked)) throw new Error('No eligible bounded result consumer or the packet source is stale.')
    tracked.seen = true
    tracked.meta = acceptedMeta(packet.delivery)
    await consumer(packet.delivery)
    if (boundedConsumer !== consumer) throw new Error('The bounded result consumer changed before its ACK.')
    ipcRenderer.send(DESKTOP_IPC.boundedAck, { id: packet.id, ok: true })
  }).catch(() => ipcRenderer.send(DESKTOP_IPC.boundedAck, { id: packet.id, ok: false }))
})

// The main process validates both sender and input. Never expose ipcRenderer,
// filesystem paths-as-operations, shell access, or Electron event objects.
const api: BingoDesktopApi = {
  bootstrap: () => ipcRenderer.invoke(DESKTOP_IPC.bootstrap),
  connect: (input) => ipcRenderer.invoke(DESKTOP_IPC.connect, input),
  reconnect: (input) => ipcRenderer.invoke(DESKTOP_IPC.reconnect, input),
  closeHost: (input) => ipcRenderer.invoke(DESKTOP_IPC.closeHost, input),
  selectConversation: (input) => ipcRenderer.invoke(DESKTOP_IPC.selectConversation, input),
  openAgentPage: (input) => ipcRenderer.invoke(DESKTOP_IPC.openAgentPage, input),
  request: (input) => ipcRenderer.invoke(DESKTOP_IPC.request, input),
  requestBounded: (input) => invokeBounded(input, DESKTOP_IPC.requestBounded, { kind: 'response', hostId: input.hostId, connectionId: input.request.connectionId, session: source(input), method: input.request.method, seen: false }),
  cancelBounded: (input) => ipcRenderer.invoke(DESKTOP_IPC.cancelBounded, input),
  readPart: (input) => invokeBounded(input, DESKTOP_IPC.readPart, { kind: 'part', hostId: input.hostId, connectionId: input.connectionId, session: input.session, partKind: input.kind, token: input.token, offset: input.offset, item: input.kind === 'item' ? input.item : undefined, generation: input.kind === 'item' ? input.generation : undefined, seen: false }),
  cancelPart: (input) => ipcRenderer.invoke(DESKTOP_IPC.cancelPart, input),
  exportReference: (input) => ipcRenderer.invoke(DESKTOP_IPC.exportReference, input),
  cancelExport: (input) => ipcRenderer.invoke(DESKTOP_IPC.cancelExport, input),
  onBounded: (listener) => {
    if (boundedConsumer) throw new Error('One bounded result consumer can be active at a time.')
    boundedConsumer = listener
    return () => { if (boundedConsumer === listener) boundedConsumer = null }
  },
  chooseWorkspace: () => ipcRenderer.invoke(DESKTOP_IPC.chooseWorkspace),
  chooseBinary: () => ipcRenderer.invoke(DESKTOP_IPC.chooseBinary),
  chooseImages: () => ipcRenderer.invoke(DESKTOP_IPC.chooseImages),
  savePreferences: (input) => ipcRenderer.invoke(DESKTOP_IPC.savePreferences, input),
  openExternal: (url) => ipcRenderer.invoke(DESKTOP_IPC.openExternal, url),
  exportText: (input) => ipcRenderer.invoke(DESKTOP_IPC.exportText, input),
  deleteSession: (input) => ipcRenderer.invoke(DESKTOP_IPC.deleteSession, input),
  configureProvider: (input) => ipcRenderer.invoke(DESKTOP_IPC.configureProvider, input),
  notify: (input) => ipcRenderer.invoke(DESKTOP_IPC.notify, input),
  setBadgeCount: (count) => ipcRenderer.invoke(DESKTOP_IPC.setBadgeCount, count),
  onNotificationActivated: (listener) => {
    if (activations.size >= 4) throw new Error('Too many notification subscriptions.')
    activations.add(listener)
    return () => { activations.delete(listener) }
  },
  // Display-only (`~` abbreviation). Sandboxed preloads still receive env.
  homeDirectory: homeDirectory(),
  onEvent: (listener) => {
    if (listeners.size >= 32) throw new Error('Too many desktop event subscriptions.')
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
}
contextBridge.exposeInMainWorld('bingoDesktop', Object.freeze(api))
installPanelsBridge()
installReviewBridge()
