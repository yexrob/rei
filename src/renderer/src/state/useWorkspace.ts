import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentPageState, AgentPageTarget, BoundedDelivery, BoundedMethod, ConnectionState, ConversationSelection, DesktopBootstrap, DesktopEvent, DesktopMethod, DesktopPreferences, ExportProgress, ExportReferenceRequest, HostEpoch, Result } from '../../../shared/desktop'
import type { Activation, Answer, Catalog, CatalogKind, EventRefParams, Frame, HeadOmission, Image, Input, IntentOutcome, RpcMethods, SessionSpec, SessionSummary, View } from '../../../shared/rpc'
import { createSessionProjection, projectEventReference, projectFrame, projectHistory, type SessionProjection } from './session'
import { errorMessage, object } from '../components/primitives'
import { selectCollaboration } from './collaboration'
import { isDescendantFrame, projectTreeFrames, treeAttachmentTarget } from './sessionTree'

export function unwrap<T>(result: Result<T>): T { if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code }); return result.value }
export const conversationKey = (hostId: string, sessionId: string | null): string => JSON.stringify([hostId, sessionId])
const contextKey = (session: string | null) => JSON.stringify(session)
const pageKey = (page: AgentPageTarget) => JSON.stringify([page.hostId, page.connectionId, page.sessionId, page.itemId])
const disconnected: ConnectionState = { hostId: '', status: 'disconnected', connectionId: null, busy: false, workspace: null, binary: null }
type RuntimeSelection = { model: string | null; thinking: string | null }
const defaultRuntime: RuntimeSelection = { model: null, thinking: null }
const boundedBytes = 4 * 1024 * 1024
const boundedMethods = ['session/listHeads', 'session/children', 'session/open', 'session/history', 'session/itemPart', 'session/fieldPart', 'session/eventPart'] as const
function requireBoundedRuntime(connection: ConnectionState): void {
  const capabilities = connection.server?.capabilities
  if (!capabilities || !boundedMethods.every(method => capabilities.methods.includes(method)) || !['eventRef', 'gateway/sessionHead'].every(name => capabilities.notifications.includes(name))) throw new Error('RUNTIME_UPDATE_REQUIRED: Update the bingo runtime to open sessions safely in Rei.')
}
type BoundedSlot = { scope: HostEpoch; method: BoundedMethod; expectedSession?: string | null; receivedSession?: string | null; received: boolean; accept: (delivery: BoundedDelivery) => void; rollback?: () => void }
type PartSlot = { scope: HostEpoch; session: string; selectedAt: number; kind: 'item' | 'field' | 'event'; token: string; item?: string; generation?: number; offset: number; totalBytes: number; received: boolean; data?: string; nextOffset?: number | null }
type SessionContext = { error: string; notice: string; commandView: View | null; loading: number }
const emptyContext: SessionContext = { error: '', notice: '', commandView: null, loading: 0 }
export type WorkspaceHost = { connection: ConnectionState; sessions: SessionSummary[]; headOmissions: Record<string, HeadOmission[]>; listComplete: boolean; childIds: Record<string, string[]>; childScanComplete: Record<string, boolean>; projections: Record<string, SessionProjection>; projectionEpochs: Record<string, string>; catalogs: Partial<Record<CatalogKind, Catalog>>; contexts: Record<string, SessionContext>; runtimeDraft: RuntimeSelection }
type Pending = { target: ConversationSelection; presentResult: boolean; resolve: (value: IntentOutcome) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
type EpochCache = { buffered: Map<string, Frame[]>; deferred: Map<string, EventRefParams[]>; opening: Set<string>; flights: Map<string, Promise<string>>; attachments: Map<string, { children: boolean; generation: number }>; ancestors: Set<string>; recovery: Set<string>; removed: Set<string>; discovering: Set<string>; scanned: Set<string>; gatewayRevision: number; initialThinking: Map<string, string>; preparing: Map<string, Promise<void>>; commandSession?: Promise<string>; initialized?: Promise<void> }
function cache(): EpochCache { return { buffered: new Map(), deferred: new Map(), opening: new Set(), flights: new Map(), attachments: new Map(), ancestors: new Set(), recovery: new Set(), removed: new Set(), discovering: new Set(), scanned: new Set(), gatewayRevision: 0, initialThinking: new Map(), preparing: new Map() } }
function workspaceHost(connection: ConnectionState): WorkspaceHost { return { connection, sessions: [], headOmissions: {}, listComplete: false, childIds: {}, childScanComplete: {}, projections: {}, projectionEpochs: {}, catalogs: {}, contexts: {}, runtimeDraft: defaultRuntime } }
function selectedModel(id: string | null, catalogs: Partial<Record<CatalogKind, Catalog>>): Pick<SessionSpec, 'provider' | 'model'> {
  if (!id) return {}
  const entry = catalogs.models?.entries.find(entry => entry.id === id)
  const provider = entry ? object(entry.meta).provider : catalogs.providers?.entries.find(entry => id.startsWith(`${entry.id}/`))?.id
  if (typeof provider === 'string' && id.startsWith(`${provider}/`) && id.length > provider.length + 1) return { provider, model: id.slice(provider.length + 1) }
  if (entry) throw new Error('This model catalog entry has no valid provider identity. Refresh the models and try again.')
  return { model: id }
}
function savedWatermarks(): Record<string, number> {
  try { return Object.fromEntries(Object.entries(object(JSON.parse(localStorage.getItem('rei.read.v1') ?? '{}'))).filter((pair): pair is [string, number] => typeof pair[1] === 'number' && Number.isSafeInteger(pair[1]) && pair[1] >= 0)) } catch { return {} }
}

export function useWorkspace() {
  const [bootstrap, setBootstrap] = useState<DesktopBootstrap | null>(null)
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null)
  const [hosts, setHosts] = useState<Record<string, WorkspaceHost>>({})
  const hostsRef = useRef(hosts)
  const [target, setTarget] = useState<ConversationSelection | null>(null)
  const targetRef = useRef(target)
  const [preview, setPreview] = useState<ConversationSelection | null>(null)
  const previewRef = useRef(preview)
  const [applicationError, setApplicationError] = useState('')
  const [agentPages, setAgentPages] = useState<AgentPageState[]>([])
  const pagesRef = useRef(agentPages)
  const [agentPageEvent, setAgentPageEvent] = useState<{ page: AgentPageState; sequence: number } | null>(null)
  const [watermarks, setWatermarks] = useState(savedWatermarks)
  const [exportProgress, setExportProgress] = useState<Record<string, ExportProgress>>({})
  const exporting = useRef(new Map<string, ConversationSelection>())
  const navigation = useRef(0), pageSequence = useRef(0)
  const epochs = useRef(new Map<string, EpochCache>())
  const retiredEpochs = useRef(new Set<string>())
  const expectedStops = useRef(new Map<string, string | null>())
  const pending = useRef(new Map<string, Pending>())
  const boundedSlots = useRef(new Map<string, BoundedSlot>())
  const partSlots = useRef(new Map<string, PartSlot>())
  const initialized = useRef(false)
  const menuHandler = useRef<(action: string) => void>(() => {})

  const updateHost = useCallback((id: string, update: (host: WorkspaceHost) => WorkspaceHost) => {
    const host = hostsRef.current[id]
    if (!host) return
    hostsRef.current = { ...hostsRef.current, [id]: update(host) }; setHosts(hostsRef.current)
  }, [])
  const setSelection = useCallback((next: ConversationSelection | null, show = true) => {
    targetRef.current = next; setTarget(next)
    if (show) { previewRef.current = next; setPreview(next) }
  }, [])
  const live = useCallback((scope: HostEpoch): boolean => Boolean(scope.connectionId && hostsRef.current[scope.hostId]?.connection.connectionId === scope.connectionId), [])
  const requireHost = useCallback((scope: HostEpoch): WorkspaceHost => {
    const host = hostsRef.current[scope.hostId]
    if (!live(scope) || host.connection.status !== 'ready') throw new Error('This runtime connection is no longer available. Reconnect and check the session before trying again.')
    return host
  }, [live])
  const updateContext = useCallback((scope: ConversationSelection | null, patch: Partial<SessionContext> | ((old: SessionContext) => SessionContext)) => {
    if (!scope) { if (typeof patch !== 'function' && patch.error !== undefined) setApplicationError(patch.error); return }
    // Old callbacks may not mutate a replacement process, even with identical IDs.
    if (scope.connectionId !== hostsRef.current[scope.hostId]?.connection.connectionId) return
    updateHost(scope.hostId, host => { const key = contextKey(scope.sessionId), old = host.contexts[key] ?? emptyContext; return { ...host, contexts: { ...host.contexts, [key]: typeof patch === 'function' ? patch(old) : { ...old, ...patch } } } })
  }, [updateHost])
  const reportFor = useCallback((scope: ConversationSelection | null, error: unknown) => updateContext(scope, { error: errorMessage(error) }), [updateContext])
  const epochCache = useCallback((scope: HostEpoch): EpochCache => {
    requireHost(scope)
    let value = epochs.current.get(scope.connectionId!)
    if (!value) { value = cache(); epochs.current.set(scope.connectionId!, value) }
    return value
  }, [requireHost])
  const rejectEpoch = useCallback((connectionId: string | null, message: string) => {
    for (const [id, item] of pending.current) if (item.target.connectionId === connectionId) {
      clearTimeout(item.timer); pending.current.delete(id); reportFor(item.target, new Error(message)); item.reject(new Error(message))
    }
    for (const [id, slot] of boundedSlots.current) if (slot.scope.connectionId === connectionId) {
      boundedSlots.current.delete(id); if (slot.received) slot.rollback?.()
      void window.bingoDesktop.cancelBounded({ transferId: id, connectionId: connectionId!, session: slot.receivedSession ?? slot.expectedSession ?? null }).catch(() => {})
    }
    for (const [id, slot] of partSlots.current) if (slot.scope.connectionId === connectionId) {
      partSlots.current.delete(id)
      void window.bingoDesktop.cancelPart({ transferId: id, connectionId: connectionId!, session: slot.session }).catch(() => {})
    }
    for (const [id, owner] of exporting.current) if (owner.connectionId === connectionId) {
      exporting.current.delete(id)
      void window.bingoDesktop.cancelExport({ transferId: id, connectionId: connectionId!, session: owner.sessionId }).catch(() => {})
      setExportProgress(current => { const key = conversationKey(owner.hostId, owner.sessionId), progress = current[key]; return progress?.transferId === id ? { ...current, [key]: { ...progress, status: 'failed' } } : current })
    }
    if (connectionId) epochs.current.delete(connectionId)
  }, [reportFor])
  const adoptConnection = useCallback((incoming: ConnectionState) => {
    const previous = hostsRef.current[incoming.hostId]
    const expectedStop = expectedStops.current.has(incoming.hostId) && expectedStops.current.get(incoming.hostId) === previous?.connection.connectionId
    const connection = incoming.status === 'disconnected' && !incoming.error && !expectedStop && previous && (previous.connection.status !== 'disconnected' || previous.connection.error)
      ? { ...incoming, error: { code: 'DISCONNECTED', message: 'bingo is not connected. Reconnect to continue.' } }
      : incoming
    if (connection.connectionId && retiredEpochs.current.has(connection.connectionId)) return
    if (previous?.connection.connectionId === connection.connectionId && ['failed', 'disconnected'].includes(previous.connection.status) && connection.status === 'ready') return
    const changedEpoch = previous && previous.connection.connectionId !== connection.connectionId
    if (changedEpoch && previous.connection.connectionId) retiredEpochs.current.add(previous.connection.connectionId)
    if (changedEpoch || connection.status === 'failed' || connection.status === 'disconnected') {
      rejectEpoch(previous?.connection.connectionId ?? connection.connectionId, 'Connection lost. The request may have been accepted; reconnect and check the session before resending.')
      if (targetRef.current?.hostId === connection.hostId) setSelection(null, false)
      pagesRef.current = pagesRef.current.map(page => page.hostId === connection.hostId ? { ...page, status: 'invalidated' } : page); setAgentPages(pagesRef.current)
    }
    const retained = hostsRef.current[connection.hostId]
    hostsRef.current = { ...hostsRef.current, [connection.hostId]: retained ? { ...retained, connection, ...(changedEpoch ? { catalogs: {}, listComplete: false, childIds: {}, childScanComplete: {}, sessions: retained.sessions.map(summary => ({ ...summary, busy: false })) } : {}) } : workspaceHost(connection) }
    setHosts(hostsRef.current)
  }, [rejectEpoch, setSelection])
  const requestFor = useCallback(async <M extends DesktopMethod>(scope: HostEpoch, method: M, params: RpcMethods[M]['params']): Promise<RpcMethods[M]['result']> => {
    requireHost(scope)
    const result = unwrap(await window.bingoDesktop.request({ connectionId: scope.connectionId!, method, params }))
    requireHost(scope)
    return result
  }, [requireHost])
  const receiveBounded = useRef<(delivery: BoundedDelivery) => Promise<void>>(async () => { throw new Error('No bounded result consumer.') })
  receiveBounded.current = async delivery => {
    if (delivery.kind === 'part') {
      const slot = partSlots.current.get(delivery.transferId)
      if (!slot || slot.received || slot.scope.hostId !== delivery.hostId || slot.scope.connectionId !== delivery.connectionId || slot.session !== delivery.session || slot.kind !== delivery.partKind || slot.token !== delivery.token || slot.offset !== delivery.offset || slot.totalBytes !== delivery.totalBytes || slot.item !== delivery.item || slot.generation !== delivery.generation) throw new Error('The part belongs to another source or an expired request.')
      requireHost(slot.scope)
      const length = new TextEncoder().encode(delivery.data).byteLength
      if (length <= 0 || length > 64 * 1024 || slot.offset + length > slot.totalBytes || (delivery.nextOffset !== null && delivery.nextOffset !== slot.offset + length) || (delivery.nextOffset === null && slot.offset + length !== slot.totalBytes)) throw new Error('The part did not make valid bounded progress.')
      slot.data = delivery.data; slot.nextOffset = delivery.nextOffset; slot.received = true
      return
    }
    const slot = boundedSlots.current.get(delivery.transferId)
    if (!slot || slot.received || slot.scope.hostId !== delivery.hostId || slot.scope.connectionId !== delivery.connectionId || slot.method !== delivery.method) throw new Error('The bounded result has no matching live request.')
    if (slot.expectedSession !== undefined && slot.expectedSession !== delivery.session) throw new Error('The bounded result belongs to another session.')
    if (delivery.method === 'session/open' && delivery.session !== delivery.result.session) throw new Error('The opened session does not match its delivery source.')
    requireHost(slot.scope)
    slot.received = true; slot.receivedSession = delivery.session
    slot.accept(delivery)
  }
  const requestBoundedFor = useCallback(async <M extends BoundedMethod, T>(scope: HostEpoch, method: M, params: RpcMethods[M]['params'], expectedSession: string | null | undefined, consume: (result: RpcMethods[M]['result']) => T, rollback?: () => void): Promise<T> => {
    requireHost(scope)
    const transferId = crypto.randomUUID()
    let accepted!: T
    const slot: BoundedSlot = { scope, method, expectedSession, received: false, accept: delivery => { accepted = consume((delivery as { result: RpcMethods[M]['result'] }).result) }, rollback }
    boundedSlots.current.set(transferId, slot)
    let timer!: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The bounded result was not acknowledged in time. Check the session before retrying.')), 120000) })
    try {
      const input = { transferId, hostId: scope.hostId, request: { connectionId: scope.connectionId!, method, params } }
      const receipt = unwrap(await Promise.race([window.bingoDesktop.requestBounded(input), timeout]))
      if (!slot.received || receipt.kind !== 'response' || receipt.transferId !== transferId || receipt.hostId !== scope.hostId || receipt.connectionId !== scope.connectionId || receipt.method !== method || receipt.session !== slot.receivedSession || receipt.acceptedBytes <= 0 || receipt.acceptedBytes > 8 * 1024 * 1024) throw new Error('The bounded result was not acknowledged by its source.')
      requireHost(scope)
      return accepted
    } catch (error) {
      if (slot.received) rollback?.()
      void window.bingoDesktop.cancelBounded({ transferId, connectionId: scope.connectionId!, session: slot.receivedSession ?? slot.expectedSession ?? null }).catch(() => {})
      throw error
    } finally { clearTimeout(timer); boundedSlots.current.delete(transferId) }
  }, [requireHost])
  const updateProjection = useCallback((scope: HostEpoch, id: string, next: SessionProjection) => {
    if (!live(scope)) return
    updateHost(scope.hostId, host => ({ ...host, projections: { ...host.projections, [id]: next }, projectionEpochs: { ...host.projectionEpochs, [id]: scope.connectionId! }, sessions: [next.snapshot.summary, ...host.sessions.filter(item => item.id !== id)] }))
  }, [live, updateHost])
  const readPreviewPart = useCallback(async (owner: ConversationSelection, ref: { id: string; kind: PartSlot['kind']; token: string; item?: string; generation?: number; totalBytes: number }) => {
    if (!owner.sessionId) throw new Error('Select a session before reading its content.')
    requireHost(owner)
    const transferId = crypto.randomUUID(), selectedAt = navigation.current
    const slot: PartSlot = { scope: owner, session: owner.sessionId, selectedAt, kind: ref.kind, token: ref.token, item: ref.item, generation: ref.generation, offset: 0, totalBytes: ref.totalBytes, received: false }
    partSlots.current.set(transferId, slot)
    try {
      const common = { transferId, hostId: owner.hostId, connectionId: owner.connectionId!, session: owner.sessionId, token: ref.token, offset: 0, maxBytes: 64 * 1024 }
      const request = ref.kind === 'item' ? { ...common, kind: 'item' as const, item: ref.item!, generation: ref.generation! } : { ...common, kind: ref.kind }
      const receipt = unwrap(await window.bingoDesktop.readPart(request))
      if (!slot.received || receipt.kind !== 'part' || receipt.transferId !== transferId || receipt.hostId !== owner.hostId || receipt.connectionId !== owner.connectionId || receipt.session !== owner.sessionId || receipt.partKind !== ref.kind || receipt.offset !== 0 || receipt.nextOffset !== slot.nextOffset || receipt.totalBytes !== ref.totalBytes || selectedAt !== navigation.current) throw new Error('The preview part was not acknowledged by its source.')
      const projection = requireHost(owner).projections[owner.sessionId]
      if (!projection) throw new Error('This session is no longer available.')
      updateProjection(owner, owner.sessionId, { ...projection, rawPreview: { id: ref.id, text: slot.data!, totalBytes: ref.totalBytes, nextOffset: slot.nextOffset! } })
    } catch (error) { void window.bingoDesktop.cancelPart({ transferId, connectionId: owner.connectionId!, session: owner.sessionId }).catch(() => {}); throw error }
    finally { partSlots.current.delete(transferId) }
  }, [requireHost, updateProjection])
  const refreshSessionsFor = useCallback(async (scope: HostEpoch) => {
    const host = requireHost(scope); requireBoundedRuntime(host.connection)
    const removed = epochCache(scope).removed
    let after: string | undefined
    updateHost(scope.hostId, current => ({ ...current, listComplete: false }))
    while (true) {
      const cursor = after
      const next = await requestBoundedFor(scope, 'session/listHeads', { filter: { cwd: host.connection.workspace ?? undefined }, ...(cursor ? { after: cursor } : {}), maxBytes: boundedBytes }, null, result => {
        if (result.heads.some((head, index) => head.cwd !== host.connection.workspace || (index === 0 ? cursor !== undefined && head.id <= cursor : head.id <= result.heads[index - 1].id)) || (result.next && (!result.heads.length || result.next !== result.heads.at(-1)?.id))) throw new Error('The bounded session list did not advance safely.')
        updateHost(scope.hostId, current => {
          const heads = result.heads.filter(head => !removed.has(head.id))
          const omitted = { ...current.headOmissions }
          const summaries = heads.map(({ omitted: fields, ...summary }) => { omitted[summary.id] = fields ?? []; return summary as SessionSummary })
          const fresh = new Map(summaries.map(summary => [summary.id, summary]))
          const known = new Set(current.sessions.map(summary => summary.id))
          const authoritative = (summary: SessionSummary) => current.projectionEpochs[summary.id] === scope.connectionId ? current.projections[summary.id]?.snapshot.summary ?? summary : summary
          return { ...current, headOmissions: omitted, sessions: [...current.sessions.filter(summary => !removed.has(summary.id)).map(summary => authoritative(fresh.get(summary.id) ?? summary)), ...summaries.filter(summary => !known.has(summary.id)).map(authoritative)] }
        })
        return result.next ?? null
      }, () => updateHost(scope.hostId, current => ({ ...current, listComplete: false })))
      if (!next) break
      if (next === after) throw new Error('The bounded session list repeated its cursor.')
      after = next
    }
    updateHost(scope.hostId, current => ({ ...current, listComplete: true }))
  }, [requireHost, epochCache, updateHost, requestBoundedFor])
  const readCatalogFor = useCallback(async (scope: HostEpoch, kind: CatalogKind) => {
    const catalog = await requestFor(scope, 'catalog/read', { kind })
    updateHost(scope.hostId, host => ({ ...host, catalogs: { ...host.catalogs, [kind]: catalog } }))
    return catalog
  }, [requestFor, updateHost])
  const selectFor = useCallback(async (scope: ConversationSelection | null, token = navigation.current) => {
    if (scope) {
      const host = requireHost(scope)
      if (scope.sessionId && (host.projectionEpochs[scope.sessionId] !== scope.connectionId || host.projections[scope.sessionId]?.provisional || !epochCache(scope).attachments.has(scope.sessionId))) throw new Error('Open this session directly on its owning runtime before selecting it.')
    }
    if (token !== navigation.current) return
    const selection = scope ? { hostId: scope.hostId, connectionId: scope.connectionId, sessionId: scope.sessionId } : null
    unwrap(await window.bingoDesktop.selectConversation(selection))
    if (token === navigation.current && (!selection || live(selection))) setSelection(selection)
  }, [requireHost, epochCache, live, setSelection])
  const openFor = useCallback(async (scope: HostEpoch, id?: string, resync = false, driver: 'model' | 'log' = 'model', foreground = true, token = foreground && !resync ? ++navigation.current : navigation.current): Promise<string> => {
    const host = requireHost(scope), store = epochCache(scope)
    const owner: ConversationSelection = { ...scope, sessionId: id ?? null }
    const flightKey = id ?? `create:${driver}:${foreground}`
    let flight = store.flights.get(flightKey)
    const attachment = id ? store.attachments.get(id) : undefined
    const projection = id && host.projectionEpochs[id] === scope.connectionId ? host.projections[id] : undefined
    // A tree-projected descendant is not an opened direct port. Never reuse a
    // stale generation, a closed session, or a projection awaiting recovery.
    if (id && !resync && !flight && !store.opening.has(id) && !store.buffered.has(id) && !store.removed.has(id) && attachment && projection && !projection.resync && !projection.provisional && !projection.snapshot.closed && (projection.snapshot.historyGeneration ?? 0) === attachment.generation) {
      try { if (foreground) await selectFor(owner, token); return id }
      catch (error) { reportFor(owner, error); throw error }
    }
    updateContext(owner, old => ({ ...old, loading: old.loading + 1 }))
    if (!flight) {
      if (id) store.opening.add(id)
      const draft = host.runtimeDraft
      const known = id ? host.sessions.find(item => item.id === id) : undefined
      const discoveredParents = id ? Object.entries(host.childIds).filter(([, children]) => children.includes(id)).map(([parent]) => parent) : []
      const children = attachment?.children ?? (!known?.parent && !discoveredParents.length && driver !== 'log')
      flight = (async () => {
        let previous: SessionProjection | undefined, previousSummary: SessionSummary | undefined, openedId: string | undefined
        const session = await requestBoundedFor(scope, 'session/open', { selector: id ? { kind: 'byId', id } : { kind: 'create', spec: { cwd: host.connection.workspace ?? '', driver, ...(driver === 'log' ? { title: foreground ? 'Provider setup' : 'Runtime commands' } : selectedModel(draft.model, host.catalogs)) } }, options: { children, maxSnapshotBytes: boundedBytes, ...(children ? { treeBackfill: 'liveOnly' as const } : {}) } }, id, opened => {
          if (opened.snapshot.summary.id !== opened.session || opened.snapshot.summary.cwd !== host.connection.workspace || store.removed.has(opened.session)) throw new Error('The opened session did not belong to this project or was removed.')
          if (discoveredParents.length && (discoveredParents.length !== 1 || opened.snapshot.summary.parent?.session !== discoveredParents[0])) {
            updateHost(scope.hostId, current => ({ ...current, childIds: Object.fromEntries(Object.entries(current.childIds).map(([parent, ids]) => [parent, ids.filter(child => child !== opened.session)])), childScanComplete: { ...current.childScanComplete, ...Object.fromEntries(discoveredParents.map(parent => [parent, false])) } }))
            throw new Error('The discovered child parent did not match its direct-open session.')
          }
          openedId = opened.session
          previous = hostsRef.current[scope.hostId]?.projections[opened.session]
          previousSummary = hostsRef.current[scope.hostId]?.sessions.find(summary => summary.id === opened.session)
          store.attachments.set(opened.session, { children, generation: opened.snapshot.historyGeneration ?? 0 })
          updateProjection(scope, opened.session, { ...createSessionProjection(opened.snapshot, opened.history ?? undefined), provisional: true, omittedFields: opened.omittedFields, ...(opened.tree ? { tree: opened.tree } : {}) })
          return opened.session
        }, () => {
          if (!openedId) return
          store.attachments.delete(openedId)
          updateHost(scope.hostId, current => {
            const projections = { ...current.projections }, projectionEpochs = { ...current.projectionEpochs }
            if (previous) projections[openedId!] = previous
            else { delete projections[openedId!]; delete projectionEpochs[openedId!] }
            return { ...current, projections, projectionEpochs, listComplete: false, sessions: previousSummary ? [previousSummary, ...current.sessions.filter(summary => summary.id !== openedId)] : current.sessions.filter(summary => summary.id !== openedId) }
          })
        })
        let projection = hostsRef.current[scope.hostId]?.projections[session]
        if (!projection) throw new Error('The bounded session snapshot was not accepted.')
        const buffered = [
          ...(store.buffered.get(session) ?? []).map(frame => ({ seq: frame.seq, frame })),
          ...(store.deferred.get(session) ?? []).map(ref => ({ seq: ref.seq, ref }))
        ].sort((left, right) => left.seq - right.seq)
        for (const entry of buffered) {
          if ('ref' in entry) { projection = projectEventReference(projection, entry.ref); continue }
          const frame = entry.frame
          if (isDescendantFrame(frame)) continue
          if (frame.event.type === 'lagged' ? frame.event.to <= projection.snapshot.seq : frame.seq <= projection.snapshot.seq) continue
          projection = projectFrame(projection, frame)
        }
        store.buffered.delete(session); store.deferred.delete(session)
        updateProjection(scope, session, { ...projection, provisional: false })
        if (!id && driver === 'model' && draft.thinking !== null) store.initialThinking.set(session, draft.thinking)
        return session
      })().finally(() => { if (id) store.opening.delete(id); store.flights.delete(flightKey) })
      store.flights.set(flightKey, flight)
    }
    let openedSession: string | null = null
    try {
      const session = await flight
      openedSession = session
      if (foreground && !resync) await selectFor({ ...scope, sessionId: session }, token)
      return session
    } catch (error) { reportFor(openedSession ? { ...scope, sessionId: openedSession } : owner, error); throw error }
    finally { updateContext(owner, old => ({ ...old, loading: Math.max(0, old.loading - 1) })) }
  }, [requireHost, epochCache, requestBoundedFor, updateHost, updateContext, updateProjection, selectFor, reportFor])
  const discoverChildrenFor = useCallback(async (scope: HostEpoch, parent: string) => {
    const store = epochCache(scope)
    if (!store.attachments.has(parent) || store.scanned.has(parent) || store.discovering.has(parent)) return
    store.discovering.add(parent)
    updateHost(scope.hostId, host => ({ ...host, childScanComplete: { ...host.childScanComplete, [parent]: false } }))
    const selected = () => targetRef.current?.hostId === scope.hostId && targetRef.current?.sessionId === parent
    try {
      let revision = -1, attempts = 0
      do {
        if (!selected()) return
        revision = store.gatewayRevision
        let after: string | undefined
        do {
          if (!selected()) return
          const cursor = after
          const page = await requestBoundedFor(scope, 'session/children', { parent, ...(cursor ? { after: cursor } : {}), maxBytes: boundedBytes }, parent, result => {
            if (result.children.some((id, index) => index === 0 ? cursor !== undefined && id <= cursor : id <= result.children[index - 1]) || (result.next && (!result.children.length || result.next !== result.children.at(-1)))) throw new Error('Child discovery did not advance its bounded cursor.')
            updateHost(scope.hostId, host => ({ ...host, childIds: { ...host.childIds, [parent]: [...new Set([...(host.childIds[parent] ?? []), ...result.children])].sort() } }))
            return { next: result.next ?? null }
          })
          after = page.next ?? undefined
        } while (after)
        attempts += 1
      } while (revision !== store.gatewayRevision && attempts < 3)
      if (revision !== store.gatewayRevision) throw new Error('Child discovery changed during pagination. The tree remains incomplete; retry when activity settles.')
      store.scanned.add(parent)
      updateHost(scope.hostId, host => ({ ...host, childScanComplete: { ...host.childScanComplete, [parent]: true } }))
    } catch (error) { store.scanned.add(parent); reportFor({ ...scope, sessionId: parent }, error) }
    finally { store.discovering.delete(parent) }
  }, [epochCache, requestBoundedFor, updateHost, reportFor])
  const initializeHost = useCallback(async (scope: HostEpoch) => {
    const store = epochCache(scope)
    if (!store.initialized) store.initialized = (async () => {
      requireBoundedRuntime(requireHost(scope).connection)
      await requestFor(scope, 'gateway/subscribe', { maxBytes: boundedBytes })
      await refreshSessionsFor(scope)
      await Promise.all((['models', 'commands', 'providers'] as const).map(kind => readCatalogFor(scope, kind).catch(error => reportFor({ ...scope, sessionId: null }, error))))
    })().catch(error => { store.initialized = undefined; throw error })
    await store.initialized
  }, [epochCache, requestFor, refreshSessionsFor, readCatalogFor, reportFor])
  const connect = useCallback(async (workspace?: string, binary?: string): Promise<void> => {
    const token = ++navigation.current
    try {
      const state = unwrap(await window.bingoDesktop.connect({ workspace, ...(binary ? { binary } : {}) }))
      adoptConnection(state)
      await initializeHost(state)
      if (token !== navigation.current) return
      await selectFor({ hostId: state.hostId, connectionId: state.connectionId, sessionId: null }, token)
      if (token !== navigation.current) return
      setApplicationError('')
      setPreferences(unwrap(await window.bingoDesktop.savePreferences({ workspace: workspace ?? null })))
    } catch (error) { if (token === navigation.current) setApplicationError(errorMessage(error)) }
  }, [adoptConnection, initializeHost, selectFor])
  const intentFor = useCallback(async (scope: ConversationSelection, method: 'session/submit' | 'session/interrupt' | 'session/answer', params: Record<string, unknown>, presentResult = true) => {
    requireHost(scope)
    if (!scope.sessionId) throw new Error('Select a session before sending this request.')
    const projection = hostsRef.current[scope.hostId]?.projections[scope.sessionId]
    if (!epochCache(scope).attachments.has(scope.sessionId)) throw new Error('Open this session directly on its owning runtime before sending an intent.')
    // A source-verified direct Stop only asks the same runtime to cancel work.
    // Unknown permission/request state must still block new submit and answer.
    const directStop = method === 'session/interrupt'
    if (!directStop && projection?.unloaded?.some(ref => ref.stateUncertain)) throw new Error('A runtime event is not loaded; permission and request outcomes must be inspected before sending another action.')
    if (!directStop && projection?.snapshot.summary.parent && projection.omittedFields?.some(field => field.path.join('.') === 'summary.key')) throw new Error('This session type is not loaded; its identity must be verified before sending or answering.')
    const id = crypto.randomUUID()
    let rejectOutcome!: (error: Error) => void
    const outcome = new Promise<IntentOutcome>((resolve, reject) => {
      rejectOutcome = reject
      const timeout = object(object(params.input).action).name === 'login' ? 300000 : 30000
      const timer = setTimeout(() => { pending.current.delete(id); const error = new Error('bingo has not acknowledged this request. Check the session before sending it again.'); reportFor(scope, error); reject(error) }, timeout)
      pending.current.set(id, { target: scope, presentResult, resolve, reject, timer })
    })
    try {
      const wire = requestFor(scope, method, { ...params, session: scope.sessionId, intent: id } as RpcMethods[typeof method]['params']).catch(error => { rejectOutcome(error); throw error })
      const [, acknowledged] = await Promise.all([wire, outcome])
      return acknowledged
    } catch (error) { reportFor(scope, error); throw error }
    finally { const item = pending.current.get(id); if (item) { clearTimeout(item.timer); pending.current.delete(id) } }
  }, [requireHost, epochCache, requestFor, reportFor])
  const submitFor = useCallback(async (scope: ConversationSelection, input: Input, session?: string, presentResult = true) => {
    let destination = scope
    try {
    requireHost(scope)
    const id = session ?? scope.sessionId ?? await openFor(scope)
    destination = { ...scope, sessionId: id }
    const store = epochCache(scope)
    const thinking = store.initialThinking.get(id)
    if (input.kind === 'text' && thinking !== undefined) {
      let flight = store.preparing.get(id)
      if (!flight) {
        flight = intentFor(destination, 'session/submit', { input: { kind: 'action', action: { name: 'think', args: thinking } } }).then(() => { if (store.initialThinking.get(id) === thinking) store.initialThinking.delete(id) }).finally(() => store.preparing.delete(id))
        store.preparing.set(id, flight)
      }
      await flight
    }
    requireHost(scope)
    const outcome = await intentFor(destination, 'session/submit', { input }, presentResult)
    if (input.kind === 'action' && input.action.name === 'think' && typeof input.action.args === 'string' && input.action.args.trim()) store.initialThinking.delete(id)
    return { id, outcome }
    } catch (error) { reportFor(destination, error); throw error }
  }, [requireHost, openFor, epochCache, intentFor, reportFor])

  const handleEvent = useRef<(event: DesktopEvent) => void>(() => {})
  handleEvent.current = event => {
    if (event.type === 'menu') { menuHandler.current(event.action); return }
    if (event.type === 'connection') { adoptConnection(event.connection); return }
    if (event.type === 'runtime-invalidated') {
      for (const host of Object.values(hostsRef.current)) { rejectEpoch(host.connection.connectionId, event.error.message); updateHost(host.connection.hostId, value => ({ ...value, connection: { ...value.connection, status: 'failed', busy: true, error: event.error } })) }
      setSelection(null, false); setApplicationError(event.error.message)
      pagesRef.current = pagesRef.current.map(page => ({ ...page, status: 'invalidated' })); setAgentPages(pagesRef.current)
      return
    }
    if (event.type === 'agent-page') {
      if (!live(event.page) && event.page.status !== 'invalidated') return
      const key = pageKey(event.page)
      pagesRef.current = [...pagesRef.current.filter(page => pageKey(page) !== key), event.page]; setAgentPages(pagesRef.current)
      if (event.page.status === 'opened') setAgentPageEvent({ page: event.page, sequence: ++pageSequence.current })
      return
    }
    if (event.type === 'export-progress') {
      const owner = exporting.current.get(event.transferId)
      if (owner && owner.hostId === event.hostId && owner.connectionId === event.connectionId && owner.sessionId === event.session && live(owner)) setExportProgress(current => ({ ...current, [conversationKey(owner.hostId, owner.sessionId)]: { ...event, status: 'running' } }))
      return
    }
    const host = Object.values(hostsRef.current).find(host => host.connection.connectionId === event.connectionId && host.connection.status === 'ready')
    if (!host) return
    const scope = { hostId: host.connection.hostId, connectionId: event.connectionId }
    const store = epochCache(scope)
    if (event.method === 'eventRef') {
      const ref = event.params
      if (store.removed.has(ref.session)) return
      const owner = { ...scope, sessionId: ref.session }
      if (ref.stateUncertain) {
        const awaiting = ref.intent ? pending.current.get(ref.intent) : undefined
        if (ref.intent && awaiting && awaiting.target.hostId === scope.hostId && awaiting.target.connectionId === scope.connectionId && awaiting.target.sessionId === ref.session) { clearTimeout(awaiting.timer); pending.current.delete(ref.intent); awaiting.reject(new Error('An incomplete runtime event left the request outcome uncertain. Load the event before sending another action.')) }
        updateContext(owner, { error: 'A runtime event is not loaded. Permission or request state may have changed; inspect it before continuing.' })
      }
      const existing = host.projectionEpochs[ref.session] === scope.connectionId ? host.projections[ref.session] : undefined
      if (!existing || store.opening.has(ref.session)) { store.deferred.set(ref.session, [...store.deferred.get(ref.session) ?? [], ref]); return }
      const next = projectEventReference(existing, ref)
      if (next !== existing) updateProjection(scope, ref.session, next)
      return
    }
    if (event.method === 'gateway/sessionHead') {
      store.gatewayRevision += 1
      void refreshSessionsFor(scope).catch(error => reportFor({ ...scope, sessionId: null }, error))
      return
    }
    if (event.method === 'gateway/event') {
      if (event.params.type === 'sessionCreated') {
        store.gatewayRevision += 1
        const summary = event.params.summary; store.removed.delete(summary.id)
        updateHost(scope.hostId, value => ({ ...value, sessions: [value.projectionEpochs[summary.id] === scope.connectionId ? value.projections[summary.id]?.snapshot.summary ?? summary : summary, ...value.sessions.filter(item => item.id !== summary.id)] }))
      }
      if (event.params.type === 'sessionRemoved') {
        store.gatewayRevision += 1
        const removed = event.params.session; store.removed.add(removed); store.buffered.delete(removed); store.deferred.delete(removed); store.attachments.delete(removed)
        updateHost(scope.hostId, value => { const { [removed]: _, ...projections } = value.projections; return { ...value, projections, childIds: Object.fromEntries(Object.entries(value.childIds).map(([parent, ids]) => [parent, ids.filter(id => id !== removed)])), sessions: value.sessions.filter(item => item.id !== removed) } })
        if (targetRef.current?.hostId === scope.hostId && targetRef.current.sessionId === removed) { setSelection(null, false); previewRef.current = { ...scope, sessionId: null }; setPreview(previewRef.current) }
      }
      if (event.params.type === 'catalogChanged') void readCatalogFor(scope, event.params.kind).catch(error => reportFor({ ...scope, sessionId: null }, error))
      return
    }
    const frame = event.params
    if (store.removed.has(frame.session)) return
    const descendant = isDescendantFrame(frame)
    if (descendant && (store.attachments.has(frame.session) || store.opening.has(frame.session))) return
    const owner = { ...scope, sessionId: frame.session }, data = frame.event
    if (data.type === 'intentAck') {
      const waiting = pending.current.get(data.intent)
      if (waiting && waiting.target.connectionId === scope.connectionId && waiting.target.hostId === scope.hostId && waiting.target.sessionId === frame.session) {
        clearTimeout(waiting.timer); pending.current.delete(data.intent)
        if (data.outcome.kind === 'rejected') waiting.reject(new Error(data.outcome.error.message))
        else {
          if (data.outcome.kind === 'applied' && waiting.presentResult) { const result = object(data.outcome.result); updateContext(owner, { ...(object(result.view).kind ? { commandView: result.view as View } : {}), ...(typeof result.message === 'string' ? { notice: result.message } : {}) }) }
          waiting.resolve(data.outcome)
        }
      }
    }
    if (data.type === 'notice') updateContext(owner, data.level === 'error' ? { error: data.text } : { notice: data.text })
    if (data.type === 'itemCompleted' && data.item.body.kind === 'action' && ['login', 'logout'].includes(data.item.body.name)) void readCatalogFor(scope, 'providers').catch(error => reportFor(owner, error))
    if (data.type === 'catalogChanged' && ['models', 'providers', 'tools', 'commands', 'plugins'].includes(data.kind)) void readCatalogFor(scope, data.kind as CatalogKind).catch(error => reportFor(owner, error))
    const existing = host.projectionEpochs[frame.session] === scope.connectionId ? host.projections[frame.session] : undefined
    if (descendant && !existing) {
      const summary = data.type === 'sessionUpdated' ? data.summary : host.sessions.find(item => item.id === frame.session)
      if (summary) { const frames = [...store.buffered.get(frame.session) ?? [], frame]; store.buffered.delete(frame.session); updateProjection(scope, frame.session, projectTreeFrames(summary, frames)); return }
    }
    if (!existing || store.opening.has(frame.session)) { const queue = store.buffered.get(frame.session) ?? []; if (queue.length < 10000) store.buffered.set(frame.session, [...queue, frame]); return }
    const next = projectFrame(existing, frame, descendant ? 'replay' : 'live')
    if (next !== existing) updateProjection(scope, frame.session, next)
  }
  useEffect(() => {
    if (!window.bingoDesktop) { setApplicationError('Open Rei in the desktop app to connect to bingo.'); return }
    const unsubscribeBounded = window.bingoDesktop.onBounded(delivery => receiveBounded.current(delivery))
    const unsubscribe = window.bingoDesktop.onEvent(event => handleEvent.current(event))
    if (!initialized.current) {
      initialized.current = true
      const startupToken = navigation.current
      void window.bingoDesktop.bootstrap().then(unwrap).then(async info => {
        setBootstrap(info); setPreferences(info.preferences)
        // An event or user-initiated ensure can supersede this older snapshot.
        for (const connection of info.connections) if (!hostsRef.current[connection.hostId]) adoptConnection(connection)
        pagesRef.current = [...info.agentPages.filter(page => live(page) && !pagesRef.current.some(current => pageKey(current) === pageKey(page))), ...pagesRef.current]
        setAgentPages(pagesRef.current)
        if (startupToken === navigation.current) setSelection(info.selection)
        await Promise.all(info.connections.filter(connection => connection.status === 'ready' && live(connection)).map(connection => initializeHost(connection).catch(error => reportFor({ ...connection, sessionId: null }, error))))
        if (info.selection?.sessionId && live(info.selection)) await openFor(info.selection, info.selection.sessionId, false, 'model', false)
        const selectedReady = info.selection && info.connections.some(connection => connection.hostId === info.selection!.hostId && connection.connectionId === info.selection!.connectionId && connection.status === 'ready')
        if (!selectedReady && info.binary.path && startupToken === navigation.current) await connect(info.preferences.workspace ?? undefined, info.binary.path)
      }).catch(error => { if (startupToken === navigation.current) setApplicationError(errorMessage(error)) })
    }
    return () => { unsubscribe(); unsubscribeBounded() }
  }, [adoptConnection, setSelection, initializeHost, reportFor, live, openFor, connect])
  useEffect(() => {
    for (const host of Object.values(hosts)) {
      if (host.connection.status !== 'ready') continue
      const scope = host.connection, store = epochCache(scope)
      for (const [id, projection] of Object.entries(host.projections)) {
        if (host.projectionEpochs[id] !== scope.connectionId || !projection.resync || !store.attachments.has(id)) continue
        const key = `${id}:${projection.resync.since}`
        if (store.recovery.has(key)) continue
        store.recovery.add(key)
        void openFor(scope, id, true, 'model', false).catch(error => reportFor({ ...scope, sessionId: id }, error))
      }
    }
  }, [hosts, epochCache, openFor, reportFor])
  useEffect(() => {
    if (!target?.sessionId || !live(target)) return
    const host = hosts[target.hostId], store = epochCache(target)
    const ancestor = treeAttachmentTarget(host.sessions, target.sessionId)
    if (!ancestor || store.attachments.has(ancestor) || store.opening.has(ancestor) || store.ancestors.has(ancestor)) return
    store.ancestors.add(ancestor)
    void openFor(target, ancestor, false, 'model', false).catch(error => reportFor({ ...target, sessionId: ancestor }, error))
  }, [target, hosts, live, epochCache, openFor, reportFor])
  useEffect(() => {
    if (!target?.sessionId || !live(target)) return
    const host = hosts[target.hostId], projection = host?.projections[target.sessionId]
    if (!projection || projection.provisional || host.projectionEpochs[target.sessionId] !== target.connectionId) return
    const root = treeAttachmentTarget(host.sessions, target.sessionId)
    const incomplete = projection.tree?.descendantsComplete === false || Boolean(host.sessions.find(summary => summary.id === target.sessionId)?.parent && root && host.projections[root]?.tree?.descendantsComplete === false)
    if (incomplete) void discoverChildrenFor(target, target.sessionId)
  }, [target, hosts, live, discoverChildrenFor])
  const viewHost = useCallback(async (hostId: string, sessionId: string | null = null) => {
    const host = hostsRef.current[hostId]
    if (!host) throw new Error('This project connection is no longer available.')
    const token = ++navigation.current, owner = { hostId, connectionId: host.connection.connectionId, sessionId }
    try {
      if (host.connection.status === 'disconnected' && host.connection.connectionId === null) {
        const next = unwrap(await window.bingoDesktop.connect({ workspace: host.connection.workspace ?? undefined, binary: host.connection.binary ?? undefined }))
        adoptConnection(next); await initializeHost(next)
        if (token !== navigation.current) return
        if (sessionId) await openFor(next, sessionId, false, 'model', true, token)
        else await selectFor({ ...next, sessionId: null }, token)
      } else if (host.connection.status === 'ready') {
        await initializeHost(owner)
        if (token !== navigation.current) return
        if (sessionId) await openFor(owner, sessionId, false, 'model', true, token)
        else await selectFor(owner, token)
      } else {
        unwrap(await window.bingoDesktop.selectConversation(null))
        if (token !== navigation.current) return
        setSelection(null, false); previewRef.current = owner; setPreview(owner)
      }
    } catch (error) { reportFor(owner, error); throw error }
  }, [adoptConnection, initializeHost, openFor, selectFor, setSelection, reportFor])
  const markRead = useCallback((scope: ConversationSelection, seq: number) => {
    if (!scope.sessionId || !live(scope)) return
    const projection = hostsRef.current[scope.hostId]?.projections[scope.sessionId]
    if (projection?.unloaded?.length || projection?.unloadedHistory?.length) return
    const key = conversationKey(scope.hostId, scope.sessionId)
    setWatermarks(previous => {
      if ((previous[key] ?? -1) >= seq) return previous
      const next = Object.fromEntries(Object.entries({ ...previous, [key]: seq }).slice(-1000))
      try { localStorage.setItem('rei.read.v1', JSON.stringify(next)) } catch { /* In-memory marks remain accurate. */ }
      return next
    })
  }, [live])

  const viewedHost = preview ? hosts[preview.hostId] : undefined
  const connection = viewedHost?.connection ?? disconnected
  const activeId = preview?.sessionId ?? null
  const active = activeId ? viewedHost?.projections[activeId] ?? null : null
  const ready = Boolean(target && preview && target.hostId === preview.hostId && target.connectionId === connection.connectionId && target.sessionId === preview.sessionId && connection.status === 'ready' && (!activeId || viewedHost?.projectionEpochs[activeId] === target.connectionId && !viewedHost?.projections[activeId]?.provisional))
  const context = viewedHost?.contexts[contextKey(activeId)] ?? emptyContext
  const bindingKey = JSON.stringify(preview)
  // These callbacks belong to the render that created them. They never acquire
  // their destination from a mutable foreground ref after awaiting work.
  const actions = useMemo(() => {
    const bound = preview ? { ...preview } : null
    const scope = () => { if (!bound) throw new Error('Select a project before sending a request.'); requireHost(bound); return bound }
    const referenceFor = (owner: ConversationSelection, kind: 'event' | 'history' | 'field', id: string) => {
      if (!owner.sessionId) throw new Error('Select a session before inspecting its content.')
      const projection = requireHost(owner).projections[owner.sessionId]
      if (!projection) throw new Error('The session preview is not available.')
      const reference = kind === 'event' ? projection.unloaded?.find(ref => ref.messageId === id) : kind === 'history' ? projection.unloadedHistory?.find(ref => ref.id === id) : projection.omittedFields?.find(ref => ref.path.join('.') === id)
      if (!reference) throw new Error('This content reference is no longer available.')
      if (reference.availability.kind !== 'available') throw new Error(`Full content is unavailable: ${reference.availability.reason}`)
      return { ...reference, availability: reference.availability }
    }
    const runAction = async (name: string, args: unknown = null) => {
      const owner = scope()
      if (!owner.sessionId && (name === 'model' || name === 'think') && typeof args === 'string' && args.trim()) {
        const host = requireHost(owner)
        if (name === 'model') { try { selectedModel(args.trim(), host.catalogs) } catch (error) { reportFor(owner, error); throw error } }
        updateHost(owner.hostId, value => ({ ...value, runtimeDraft: { ...value.runtimeDraft, [name === 'model' ? 'model' : 'thinking']: args.trim() } }))
        return null
      }
      return (await submitFor(owner, { kind: 'action', action: { name, args } })).id
    }
    const runActionView = async (name: string, args: unknown = null): Promise<View | null> => {
      const owner = scope(), store = epochCache(owner)
      let session = owner.sessionId
      if (!session) { if (!store.commandSession) { store.commandSession = openFor(owner, undefined, false, 'log', false); void store.commandSession.catch(() => { store.commandSession = undefined }) } session = await store.commandSession }
      const { outcome } = await submitFor(owner, { kind: 'action', action: { name, args } }, session, false)
      return outcome.kind === 'applied' && typeof object(object(outcome.result).view).kind === 'string' ? object(outcome.result).view as View : null
    }
    return {
      request: <M extends DesktopMethod>(method: M, params: RpcMethods[M]['params']) => requestFor(scope(), method, params),
      openSession: (id?: string, resync = false, driver: 'model' | 'log' = 'model', foreground = true, hostId?: string) => openFor(hostId ? hostsRef.current[hostId]?.connection ?? { hostId, connectionId: null } : scope(), id, resync, driver, foreground),
      newSession: async () => {
        if (!bound) throw new Error('Select a project before starting a conversation.')
        const token = ++navigation.current, host = hostsRef.current[bound.hostId]
        if (host?.connection.status === 'ready' && live(bound)) return selectFor({ ...bound, sessionId: null }, token)
        // A failed host can still show its unsent draft without starting a process.
        unwrap(await window.bingoDesktop.selectConversation(null))
        if (token === navigation.current && host) {
          setSelection(null, false)
          previewRef.current = { ...bound, connectionId: host.connection.connectionId, sessionId: null }; setPreview(previewRef.current)
        }
      },
      send: async (text: string, images: Image[], session?: string) => (await submitFor(scope(), { kind: 'text', text, images, origin: { surface: 'desktop' } }, session)).id,
      runAction, runActionView,
      respond: async (session: string, interaction: string, answer: Answer, activation: Activation) => { const owner = scope(); await intentFor({ ...owner, sessionId: session }, 'session/answer', { interaction, answer, activation }) },
      interrupt: async (turn?: string) => { const owner = scope(); if (owner.sessionId) await intentFor(owner, 'session/interrupt', { scope: turn ? { kind: 'turn', turn } : { kind: 'head' } }) },
      readCatalog: (kind: CatalogKind) => readCatalogFor(scope(), kind),
      loadHistory: async () => {
        const owner = scope(); if (!owner.sessionId) return
        const before = requireHost(owner).projections[owner.sessionId]?.history.before
        updateContext(owner, old => ({ ...old, loading: old.loading + 1 }))
        try {
          const recovery = await requestBoundedFor(owner, 'session/history', { session: owner.sessionId, page: { ...(before ? { before } : {}), limit: 100, maxBytes: boundedBytes, generation: requireHost(owner).projections[owner.sessionId]?.snapshot.historyGeneration ?? 0 } }, owner.sessionId, chunk => {
            const existing = requireHost(owner).projections[owner.sessionId!]
            if (!existing) throw new Error('The selected session disappeared while loading history.')
            const next = projectHistory(existing, chunk, before)
            if (next !== existing) updateProjection(owner, owner.sessionId!, { ...next, historyPending: true })
            return next !== existing && Boolean(next.resync)
          }, () => updateHost(owner.hostId, host => {
            const existing = host.projections[owner.sessionId!]
            return existing?.historyPending ? { ...host, projections: { ...host.projections, [owner.sessionId!]: { ...existing, historyPending: false, resync: { reason: 'gap', since: existing.snapshot.seq } } } } : host
          }))
          const existing = requireHost(owner).projections[owner.sessionId]
          if (existing?.historyPending) updateProjection(owner, owner.sessionId, { ...existing, historyPending: false })
          if (recovery) await openFor(owner, owner.sessionId, true)
        } catch (error) {
          if ((error as { code?: string }).code === 'STALE_GENERATION') { await openFor(owner, owner.sessionId, true); return }
          reportFor(owner, error); throw error
        } finally { updateContext(owner, old => ({ ...old, loading: Math.max(0, old.loading - 1) })) }
      },
      previewReference: async (kind: 'event' | 'history' | 'field', id: string) => {
        const owner = scope(), reference = referenceFor(owner, kind, id)
        await readPreviewPart(owner, { id, kind: kind === 'history' ? 'item' : kind, token: reference.availability.token, totalBytes: reference.totalBytes, ...(kind === 'history' ? { item: id, generation: (reference as NonNullable<SessionProjection['unloadedHistory']>[number]).generation } : {}) })
      },
      exportReference: async (kind: 'event' | 'history' | 'field', id: string): Promise<boolean> => {
        const owner = scope(), reference = referenceFor(owner, kind, id)
        if (!owner.sessionId) throw new Error('Select a session before exporting its content.')
        if ([...exporting.current.values()].some(active => active.hostId === owner.hostId && active.connectionId === owner.connectionId)) throw new Error('This runtime is already exporting a reference.')
        const transferId = crypto.randomUUID(), suggestedName = `${(id.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60) || 'content')}.json`
        const common = { transferId, hostId: owner.hostId, connectionId: owner.connectionId!, session: owner.sessionId, token: reference.availability.token, totalBytes: reference.totalBytes, checksum: reference.checksum, suggestedName }
        const input: ExportReferenceRequest = kind === 'history' ? { ...common, kind: 'item', item: id, generation: (reference as NonNullable<SessionProjection['unloadedHistory']>[number]).generation } : { ...common, kind }
        const key = conversationKey(owner.hostId, owner.sessionId)
        exporting.current.set(transferId, owner)
        setExportProgress(current => Object.fromEntries([...Object.entries(current).filter(([existing]) => existing !== key), [key, { type: 'export-progress', transferId, hostId: owner.hostId, connectionId: owner.connectionId!, session: owner.sessionId!, doneBytes: 0, totalBytes: reference.totalBytes, status: 'running' as const }]].slice(-8)))
        try {
          const saved = unwrap(await window.bingoDesktop.exportReference(input))
          if (!live(owner) || !exporting.current.has(transferId)) throw new Error('The export source changed before the save was acknowledged.')
          setExportProgress(current => { const progress = current[key]; return progress?.transferId === transferId ? { ...current, [key]: { ...progress, doneBytes: saved ? reference.totalBytes : progress.doneBytes, status: saved ? 'completed' : 'cancelled' } } : current })
          return saved
        } catch (error) {
          setExportProgress(current => { const progress = current[key]; return progress?.transferId === transferId ? { ...current, [key]: { ...progress, status: 'failed' } } : current })
          reportFor(owner, error); throw error
        } finally { exporting.current.delete(transferId) }
      },
      cancelExport: async () => {
        const owner = scope(), progress = exportProgress[conversationKey(owner.hostId, owner.sessionId)]
        if (progress && exporting.current.has(progress.transferId)) unwrap(await window.bingoDesktop.cancelExport({ transferId: progress.transferId, connectionId: owner.connectionId!, session: owner.sessionId }))
      },
      signIn: async (provider: string) => { const owner = scope(); const id = await openFor(owner, undefined, false, 'log'); await submitFor(owner, { kind: 'action', action: { name: 'login', args: `${provider} browser` } }, id); await readCatalogFor(owner, 'providers') },
      removeSession: async () => {
        const owner = scope(); if (!owner.sessionId) return
        const deleted = unwrap(await window.bingoDesktop.deleteSession({ connectionId: owner.connectionId!, session: owner.sessionId }))
        if (!live(owner) || !deleted) return
        const store = epochCache(owner); store.removed.add(owner.sessionId); store.attachments.delete(owner.sessionId); store.deferred.delete(owner.sessionId)
        updateHost(owner.hostId, host => { const { [owner.sessionId!]: _, ...projections } = host.projections; return { ...host, projections, sessions: host.sessions.filter(item => item.id !== owner.sessionId) } })
        if (targetRef.current?.hostId === owner.hostId && targetRef.current.sessionId === owner.sessionId) await selectFor({ ...owner, sessionId: null }, ++navigation.current)
      },
      report: (error: unknown) => reportFor(bound, error),
      setError: (error: string) => {
        if (!error && applicationError) {
          setApplicationError('')
          for (const host of Object.values(hostsRef.current)) if (host.connection.error?.message === applicationError) updateHost(host.connection.hostId, value => ({ ...value, connection: { ...value.connection, error: undefined } }))
        } else if (!error && connection.error?.message && !((bound && hostsRef.current[bound.hostId]?.contexts[contextKey(bound.sessionId)]?.error))) {
          updateHost(connection.hostId, host => ({ ...host, connection: { ...host.connection, error: undefined } }))
        } else updateContext(bound, { error })
      },
      clearContextError: () => updateContext(bound, { error: '' }),
      setNotice: (notice: string) => updateContext(bound, { notice }),
      setCommandView: (commandView: View | null) => updateContext(bound, { commandView }),
      reconnect: async () => {
        if (!bound) return connect()
        const token = ++navigation.current, oldSession = bound.sessionId
        setSelection(null, false)
        try {
          expectedStops.current.set(bound.hostId, connection.connectionId)
          let state: ConnectionState
          try {
            state = unwrap(await (connection.connectionId === null
              ? window.bingoDesktop.connect({ workspace: connection.workspace ?? undefined, binary: connection.binary ?? undefined })
              : window.bingoDesktop.reconnect({ hostId: bound.hostId, connectionId: connection.connectionId })))
          } finally { expectedStops.current.delete(bound.hostId) }
          adoptConnection(state); await initializeHost(state)
          if (token !== navigation.current) return
          if (oldSession) await openFor(state, oldSession, false, 'model', true, token)
          else await selectFor({ ...state, sessionId: null }, token)
          if (token === navigation.current) setApplicationError('')
        } catch (error) {
          reportFor({ ...bound, connectionId: hostsRef.current[bound.hostId]?.connection.connectionId ?? null }, error)
          throw error
        }
      }
    }
  // The binding is identity-only; stream frames must not recreate page loaders.
  }, [bindingKey, requireHost, updateHost, submitFor, epochCache, openFor, requestFor, requestBoundedFor, readPreviewPart, selectFor, intentFor, readCatalogFor, updateContext, updateProjection, reportFor, live, setSelection, adoptConnection, initializeHost, connect, connection.connectionId, applicationError, exportProgress])
  const closeHost = useCallback(async (hostId: string) => {
    const host = hostsRef.current[hostId]; if (!host) return
    const epoch = { hostId, connectionId: host.connection.connectionId }
    expectedStops.current.set(hostId, epoch.connectionId)
    try {
      unwrap(await window.bingoDesktop.closeHost(epoch))
      if (hostsRef.current[hostId]?.connection.connectionId === epoch.connectionId) adoptConnection({ ...host.connection, status: 'disconnected', busy: false, connectionId: null, error: undefined })
    } catch (error) { reportFor({ ...epoch, sessionId: null }, error); throw error }
    finally { expectedStops.current.delete(hostId) }
  }, [adoptConnection, reportFor])
  const chooseWorkspace = useCallback(async () => { const token = ++navigation.current; const path = unwrap(await window.bingoDesktop.chooseWorkspace()); if (path && token === navigation.current) await connect(path) }, [connect])
  const savePreferences = useCallback(async (patch: Parameters<typeof window.bingoDesktop.savePreferences>[0]) => { setPreferences(unwrap(await window.bingoDesktop.savePreferences(patch))) }, [])
  const openAgentPage = useCallback(async (page: AgentPageTarget) => {
    const token = ++navigation.current
    const known = pagesRef.current.find(value => pageKey(value) === pageKey(page))
    if (!known || known.status === 'invalidated') throw new Error('This page is no longer available.')
    try {
      await openFor(page, page.sessionId, false, 'model', true, token)
      if (token === navigation.current) unwrap(await window.bingoDesktop.openAgentPage({ hostId: page.hostId, connectionId: page.connectionId, sessionId: page.sessionId, itemId: page.itemId }))
    } catch (error) { reportFor(page, error); throw error }
  }, [openFor, reportFor])
  const selectConversation = useCallback((scope: ConversationSelection | null) => selectFor(scope, ++navigation.current), [selectFor])
  const runtimeSelection: RuntimeSelection = active ? { model: active.snapshot.summary.provider && active.snapshot.summary.model ? `${active.snapshot.summary.provider}/${active.snapshot.summary.model}` : active.snapshot.summary.model ?? null, thinking: String(object(active.snapshot.config?.kernel).thinking ?? 'off') } : viewedHost?.runtimeDraft ?? defaultRuntime
  const sessions = viewedHost?.sessions ?? [], projections = viewedHost?.projections ?? {}, catalogs = viewedHost?.catalogs ?? {}
  const collaboration = selectCollaboration(sessions, projections, activeId)
  return { bootstrap, hosts, target, preview, connection, ready, preferences, sessions, projections, collaboration, active, activeId, exportProgress: exportProgress[conversationKey(connection.hostId, activeId)] ?? null, catalogs, runtimeSelection, error: applicationError || context.error || connection.error?.message || '', notice: context.notice, commandView: context.commandView, loading: context.loading > 0, menuHandler, connect, ...actions, closeHost, viewHost, chooseWorkspace, savePreferences, selectConversation, agentPages, agentPageEvent, openAgentPage, markRead, watermarks, isCurrentEpoch: live }
}
