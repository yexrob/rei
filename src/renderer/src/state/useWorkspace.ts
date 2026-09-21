import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionState, DesktopBootstrap, DesktopEvent, DesktopMethod, DesktopPreferences, Result } from '../../../shared/desktop'
import type { Activation, Answer, Catalog, CatalogKind, Frame, Image, Input, IntentOutcome, RpcMethods, SessionSpec, SessionSummary, View } from '../../../shared/rpc'
import { createSessionProjection, projectFrame, projectHistory, type SessionProjection } from './session'
import { errorMessage, object } from '../components/primitives'
import { selectCollaboration } from './collaboration'
import { isDescendantFrame, projectTreeFrames, treeAttachmentTarget } from './sessionTree'

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
const disconnected: ConnectionState = { status: 'disconnected', connectionId: null, workspace: null, binary: null }
type Pending = { session: string; presentResult: boolean; resolve: (value: IntentOutcome) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
type RuntimeSelection = { model: string | null; thinking: string | null }
const defaultRuntime: RuntimeSelection = { model: null, thinking: null }

function selectedModel(id: string | null, catalogs: Partial<Record<CatalogKind, Catalog>>): Pick<SessionSpec, 'provider' | 'model'> {
  if (!id) return {}
  const entry = catalogs.models?.entries.find((entry) => entry.id === id)
  const provider = entry ? object(entry.meta).provider : catalogs.providers?.entries.find((entry) => id.startsWith(`${entry.id}/`))?.id
  if (typeof provider === 'string' && id.startsWith(`${provider}/`) && id.length > provider.length + 1) {
    // Labels are presentation, and model IDs can themselves contain slashes.
    return { provider, model: id.slice(provider.length + 1) }
  }
  if (entry) throw new Error('This model catalog entry has no valid provider identity. Refresh the models and try again.')
  // Free-form /model input from settings retains the core's unqualified-model semantics.
  return { model: id }
}

export function useWorkspace() {
  const [bootstrap, setBootstrap] = useState<DesktopBootstrap | null>(null)
  const [connection, setConnection] = useState<ConnectionState>(disconnected)
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [projections, setProjections] = useState<Record<string, SessionProjection>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [catalogs, setCatalogs] = useState<Partial<Record<CatalogKind, Catalog>>>({})
  const [runtimeDrafts, setRuntimeDrafts] = useState<Record<string, RuntimeSelection>>({})
  const runtimeDraftRef = useRef(runtimeDrafts)
  const catalogRef = useRef(catalogs)
  const initialThinking = useRef(new Map<string, string>())
  const preparing = useRef(new Map<string, Promise<void>>())
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [commandView, setCommandView] = useState<View | null>(null)
  const [loading, setLoading] = useState(false)
  const current = useRef(connection)
  const projectionRef = useRef(projections)
  const activeRef = useRef(activeId)
  const pending = useRef(new Map<string, Pending>())
  const buffered = useRef(new Map<string, Frame[]>())
  const opening = useRef(new Set<string>())
  const attachments = useRef(new Map<string, boolean>())
  const ancestorAttempts = useRef(new Set<string>())
  const recoveryAttempts = useRef(new Set<string>())
  const removedSessions = useRef(new Set<string>())
  const sessionsRef = useRef(sessions)
  const openFlights = useRef(new Map<string, Promise<string>>())
  const commandSession = useRef<{ connection: string | null; session: Promise<string> } | null>(null)
  const initialized = useRef(false)
  const menuHandler = useRef<(action: string) => void>(() => {})
  const selection = useRef(0)
  const connecting = useRef(0)
  const expectedReset = useRef<number | null>(null)
  current.current = connection; projectionRef.current = projections; activeRef.current = activeId

  const request = useCallback(async <M extends DesktopMethod>(method: M, params: RpcMethods[M]['params']): Promise<RpcMethods[M]['result']> => {
    const id = current.current.connectionId
    if (!id || current.current.status !== 'ready') throw new Error('bingo is not connected. Reconnect to continue.')
    return unwrap(await window.bingoDesktop.request({ connectionId: id, method, params }))
  }, [])

  const updateSessions = useCallback((items: SessionSummary[]) => {
    sessionsRef.current = items
    setSessions(items)
  }, [])

  const updateProjection = useCallback((id: string, next: SessionProjection) => {
    projectionRef.current = { ...projectionRef.current, [id]: next }
    setProjections(projectionRef.current)
    updateSessions([next.snapshot.summary, ...sessionsRef.current.filter((item) => item.id !== id)])
  }, [updateSessions])

  const clearContext = useCallback(() => {
    if (current.current.status === 'ready') setError('')
    setNotice(''); setCommandView(null)
  }, [])

  const refreshSessions = useCallback(async () => {
    const epoch = current.current.connectionId
    const result = await request('session/list', { filter: { cwd: current.current.workspace ?? undefined, limit: 500 } })
    if (epoch === current.current.connectionId) {
      const known = new Set(sessionsRef.current.map((item) => item.id))
      updateSessions([...sessionsRef.current, ...result.sessions.filter((item) => !known.has(item.id) && !removedSessions.current.has(item.id))])
    }
  }, [request, updateSessions])

  const readCatalog = useCallback(async (kind: CatalogKind) => {
    const epoch = current.current.connectionId
    const catalog = await request('catalog/read', { kind })
    if (epoch === current.current.connectionId) { catalogRef.current = { ...catalogRef.current, [kind]: catalog }; setCatalogs(catalogRef.current) }
    return catalog
  }, [request])

  const openSession = useCallback(async (id?: string, resync = false, driver: 'model' | 'log' = 'model', foreground = true): Promise<string> => {
    const token = resync || !foreground ? selection.current : ++selection.current
    const epoch = current.current.connectionId
    if (foreground) setLoading(true)
    if (foreground && !resync) clearContext()
    const flightKey = `${epoch}:${id ?? `new-${driver}-${foreground}`}`
    let flight = openFlights.current.get(flightKey)
    if (!flight) {
      if (id) opening.current.add(flightKey)
      flight = (async () => {
        const draft = runtimeDraftRef.current[current.current.workspace ?? ''] ?? defaultRuntime
        const known = id ? sessionsRef.current.find((summary) => summary.id === id) : undefined
        const children = (id ? attachments.current.get(id) : undefined) ?? (!known?.parent && driver !== 'log')
        const opened = await request('session/open', { selector: id ? { kind: 'byId', id } : { kind: 'create', spec: { cwd: current.current.workspace ?? '', driver, ...(driver === 'log' ? { title: foreground ? 'Provider setup' : 'Runtime commands' } : selectedModel(draft.model, catalogRef.current)) } }, options: { children } })
        if (epoch !== current.current.connectionId) throw new Error('Workspace changed while opening the session.')
        if (removedSessions.current.has(opened.session)) throw new Error('The session was removed while opening it.')
        attachments.current.set(opened.session, children)
        let projection = createSessionProjection(opened.snapshot)
        for (const frame of buffered.current.get(opened.session) ?? []) {
          if (isDescendantFrame(frame)) continue
          if (frame.event.type === 'lagged' ? frame.event.to <= opened.snapshot.seq : frame.seq <= opened.snapshot.seq) continue
          projection = projectFrame(projection, frame)
        }
        buffered.current.delete(opened.session)
        updateProjection(opened.session, projection)
        if (!id && driver === 'model' && draft.thinking !== null) initialThinking.current.set(opened.session, draft.thinking)
        return opened.session
      })().finally(() => { if (id) opening.current.delete(flightKey); openFlights.current.delete(flightKey) })
      openFlights.current.set(flightKey, flight)
    }
    try {
      const session = await flight
      if (foreground && !resync && token === selection.current) { activeRef.current = session; setActiveId(session); setCommandView(null) }
      return session
    } finally { if (foreground && token === selection.current) setLoading(false) }
  }, [request, updateProjection, clearContext])

  // Opening the selected child gives it a command port. Its main ancestor
  // remains tree-attached; background descendants are journal replay only.
  useEffect(() => {
    if (connection.status !== 'ready' || !activeId) return
    const target = treeAttachmentTarget(sessions, activeId)
    if (!target || attachments.current.has(target)) return
    const key = `${connection.connectionId}:${target}`
    if (opening.current.has(key) || ancestorAttempts.current.has(key)) return
    ancestorAttempts.current.add(key)
    void openSession(target, false, 'model', false).catch((error) => {
      if (current.current.connectionId === connection.connectionId && activeRef.current === target) setError(errorMessage(error))
    })
  }, [activeId, sessions, connection, openSession])

  // Recovery is bounded per session/watermark. A failed or still-gapped
  // snapshot is retried only by explicit navigation, never on every token.
  useEffect(() => {
    if (connection.status !== 'ready') return
    for (const [id, projection] of Object.entries(projections)) {
      if (!projection.resync || !attachments.current.has(id)) continue
      const key = `${connection.connectionId}:${id}:${projection.resync.since}`
      if (recoveryAttempts.current.has(key)) continue
      recoveryAttempts.current.add(key)
      void openSession(id, true, 'model', false).catch((error) => {
        if (current.current.connectionId === connection.connectionId && activeRef.current === id) setError(errorMessage(error))
      })
    }
  }, [projections, connection, openSession])

  const connect = useCallback(async (workspace?: string, binary?: string) => {
    const attempt = ++connecting.current
    expectedReset.current = attempt
    const previousWorkspace = current.current.workspace
    const previousActive = activeRef.current
    setError(''); setLoading(true)
    const token = ++selection.current
    try {
      const state = unwrap(await window.bingoDesktop.connect({ workspace, ...(binary ? { binary } : {}) }))
      if (expectedReset.current === attempt) expectedReset.current = null
      if (attempt !== connecting.current) return
      current.current = state; setConnection(state)
      projectionRef.current = {}; setProjections({}); buffered.current.clear(); updateSessions([]); catalogRef.current = {}; setCatalogs({}); setActiveId(null); activeRef.current = null; setCommandView(null)
      attachments.current.clear(); ancestorAttempts.current.clear(); recoveryAttempts.current.clear(); removedSessions.current.clear()
      initialThinking.current.clear(); preparing.current.clear(); commandSession.current = null
      const preferences = unwrap(await window.bingoDesktop.savePreferences({ workspace: workspace ?? null }))
      if (attempt !== connecting.current) return
      setPreferences(preferences)
      await request('gateway/subscribe', {})
      if (attempt !== connecting.current) return
      await refreshSessions()
      if (attempt !== connecting.current) return
      await Promise.all((['models', 'commands', 'providers'] as const).map((kind) => readCatalog(kind).catch(() => undefined)))
      if (attempt === connecting.current && token === selection.current && previousActive && previousWorkspace === state.workspace) await openSession(previousActive)
    } catch (error) { if (attempt === connecting.current) setError(errorMessage(error)) }
    finally {
      if (expectedReset.current === attempt) expectedReset.current = null
      if (attempt === connecting.current) setLoading(false)
    }
  }, [refreshSessions, readCatalog, request, updateSessions, openSession])

  const handleEvent = useRef<(event: DesktopEvent) => void>(() => {})
  handleEvent.current = (event) => {
    if (event.type === 'menu') { menuHandler.current(event.action); return }
    if (event.type === 'connection') {
      // Native connect begins with close(), even on first launch. Only that
      // first clean reset is expected; later transport failures remain errors.
      const reset = expectedReset.current !== null && event.connection.status === 'disconnected' && event.connection.connectionId === null && !event.connection.error
      expectedReset.current = null
      current.current = event.connection; setConnection(event.connection)
      if (event.connection.status === 'failed' || event.connection.status === 'disconnected') {
        if (!reset) setError(event.connection.error?.message ?? 'bingo is not connected. Reconnect to continue.')
        for (const item of pending.current.values()) { clearTimeout(item.timer); item.reject(new Error('Connection lost. The request may have been accepted; reconnect and check the session before resending.')) }
        pending.current.clear()
      }
      return
    }
    if (event.connectionId !== current.current.connectionId) return
    if (event.method === 'gateway/event') {
      if (event.params.type === 'sessionCreated') {
        const summary = event.params.summary
        removedSessions.current.delete(summary.id)
        updateSessions([projectionRef.current[summary.id]?.snapshot.summary ?? summary, ...sessionsRef.current.filter((item) => item.id !== summary.id)])
      }
      if (event.params.type === 'sessionRemoved') {
        const removed = event.params.session
        removedSessions.current.add(removed); buffered.current.delete(removed); attachments.current.delete(removed)
        const { [removed]: _, ...remaining } = projectionRef.current
        projectionRef.current = remaining; setProjections(remaining)
        updateSessions(sessionsRef.current.filter((item) => item.id !== removed))
        if (activeRef.current === removed) { setActiveId(null); activeRef.current = null; clearContext() }
      }
      if (event.params.type === 'catalogChanged') void readCatalog(event.params.kind).catch(() => {})
      return
    }
    const frame = event.params
    if (removedSessions.current.has(frame.session)) return
    const descendant = isDescendantFrame(frame)
    const openingKey = `${current.current.connectionId}:${frame.session}`
    // An ancestor replay must not race the direct attachment's live watermark.
    if (descendant && (attachments.current.has(frame.session) || opening.current.has(openingKey))) return
    const data = frame.event
    if (data.type === 'intentAck') {
      const waiting = pending.current.get(data.intent)
      if (waiting) {
        clearTimeout(waiting.timer); pending.current.delete(data.intent)
        if (data.outcome.kind === 'rejected') waiting.reject(new Error(data.outcome.error.message))
        else waiting.resolve(data.outcome)
      }
      if (data.outcome.kind === 'applied' && frame.session === activeRef.current && waiting?.presentResult === true) {
        const result = object(data.outcome.result)
        if (object(result.view).kind) setCommandView(result.view as View)
        if (typeof result.message === 'string') setNotice(result.message)
      }
    }
    if (data.type === 'notice' && frame.session === activeRef.current) { if (data.level === 'error') setError(data.text); else setNotice(data.text) }
    if (data.type === 'itemCompleted' && data.item.body.kind === 'action' && ['login', 'logout'].includes(data.item.body.name)) void readCatalog('providers').catch(() => {})
    if (data.type === 'catalogChanged' && ['models', 'providers', 'tools', 'commands', 'plugins'].includes(data.kind)) void readCatalog(data.kind as CatalogKind).catch(() => {})
    const existing = projectionRef.current[frame.session]
    if (descendant && !existing) {
      const summary = data.type === 'sessionUpdated' ? data.summary : sessionsRef.current.find((item) => item.id === frame.session)
      if (summary) {
        const frames = [...buffered.current.get(frame.session) ?? [], frame]
        buffered.current.delete(frame.session)
        updateProjection(frame.session, projectTreeFrames(summary, frames))
        return
      }
    }
    if (!existing || opening.current.has(openingKey)) {
      const queue = buffered.current.get(frame.session) ?? []
      if (queue.length < 10000) buffered.current.set(frame.session, [...queue, frame])
      return
    }
    const next = projectFrame(existing, frame, descendant ? 'replay' : 'live')
    if (next !== existing) updateProjection(frame.session, next)
  }

  useEffect(() => {
    if (!window.bingoDesktop) { setError('Open Rei in the desktop app to connect to bingo.'); return }
    const unsubscribe = window.bingoDesktop.onEvent((event) => handleEvent.current(event))
    if (!initialized.current) {
      initialized.current = true
      void window.bingoDesktop.bootstrap().then(unwrap).then((info) => {
        setBootstrap(info); setPreferences(info.preferences); current.current = info.connection; setConnection(info.connection)
        if (info.binary.path) void connect(info.preferences.workspace ?? undefined, info.binary.path)
      }).catch((error) => setError(errorMessage(error)))
    }
    return unsubscribe
  }, [connect])

  const intent = useCallback(async (method: 'session/submit' | 'session/interrupt' | 'session/answer', params: Record<string, unknown> & { session: string }, presentResult = true) => {
    const id = crypto.randomUUID()
    const outcome = new Promise<IntentOutcome>((resolve, reject) => {
      const input = object(params.input)
      const timeout = object(input.action).name === 'login' ? 300000 : 30000
      const timer = setTimeout(() => { pending.current.delete(id); reject(new Error('bingo has not acknowledged this request. Check the session before sending it again.')) }, timeout)
      pending.current.set(id, { session: params.session, presentResult, resolve, reject, timer })
    })
    try {
      const wire = request(method, { ...params, intent: id } as RpcMethods[typeof method]['params'])
      const [, acknowledged] = await Promise.all([wire, outcome])
      return acknowledged
    } finally {
      const waiting = pending.current.get(id)
      if (waiting) { clearTimeout(waiting.timer); pending.current.delete(id) }
    }
  }, [request])

  const prepareSession = useCallback(async (session: string) => {
    const thinking = initialThinking.current.get(session)
    if (thinking === undefined) return
    let flight = preparing.current.get(session)
    if (!flight) {
      flight = intent('session/submit', { session, input: { kind: 'action', action: { name: 'think', args: thinking } } })
        .then(() => { if (initialThinking.current.get(session) === thinking) initialThinking.current.delete(session) })
        .finally(() => { preparing.current.delete(session) })
      preparing.current.set(session, flight)
    }
    await flight
  }, [intent])

  const submitResult = useCallback(async (input: Input, session?: string, presentResult = true) => {
    const epoch = current.current.connectionId
    const id = session ?? activeRef.current ?? await openSession()
    if (epoch !== current.current.connectionId) throw new Error('Workspace changed before the message could be sent.')
    // Creation has no thinking field. Apply the draft through the canonical
    // command before the first text; failed setup must never start a turn.
    if (input.kind === 'text') await prepareSession(id)
    if (epoch !== current.current.connectionId) throw new Error('Workspace changed before the message could be sent.')
    const outcome = await intent('session/submit', { session: id, input }, presentResult)
    if (input.kind === 'action' && input.action.name === 'think' && typeof input.action.args === 'string' && input.action.args.trim()) initialThinking.current.delete(id)
    return { id, outcome }
  }, [intent, openSession, prepareSession])
  const submit = useCallback(async (input: Input, session?: string) => (await submitResult(input, session)).id, [submitResult])
  const runActionView = useCallback(async (name: string, args: unknown = null): Promise<View | null> => {
    const epoch = current.current.connectionId
    let session = activeRef.current
    if (!session) {
      if (commandSession.current?.connection !== epoch) {
        const flight = openSession(undefined, false, 'log', false)
        commandSession.current = { connection: epoch, session: flight }
        void flight.catch(() => { if (commandSession.current?.session === flight) commandSession.current = null })
      }
      session = await commandSession.current.session
    }
    if (epoch !== current.current.connectionId) throw new Error('Workspace changed before the command could be read.')
    const { outcome } = await submitResult({ kind: 'action', action: { name, args } }, session, false)
    if (outcome.kind !== 'applied') return null
    const view = object(outcome.result).view
    return typeof object(view).kind === 'string' ? view as View : null
  }, [submitResult, openSession])

  const signIn = useCallback(async (provider: string) => {
    const id = await openSession(undefined, false, 'log')
    await submit({ kind: 'action', action: { name: 'login', args: `${provider} browser` } }, id)
    await readCatalog('providers')
  }, [openSession, submit, readCatalog])
  const send = useCallback((text: string, images: Image[], session?: string) => submit({ kind: 'text', text, images, origin: { surface: 'desktop' } }, session), [submit])
  const runAction = useCallback(async (name: string, args: unknown = null) => {
    if (!activeRef.current && (name === 'model' || name === 'think') && typeof args === 'string' && args.trim()) {
      const workspace = current.current.workspace ?? ''
      const value = args.trim()
      if (name === 'model') selectedModel(value, catalogRef.current)
      const draft = { ...(runtimeDraftRef.current[workspace] ?? defaultRuntime), [name === 'model' ? 'model' : 'thinking']: value }
      runtimeDraftRef.current = { ...runtimeDraftRef.current, [workspace]: draft }
      setRuntimeDrafts(runtimeDraftRef.current)
      return null
    }
    return submit({ kind: 'action', action: { name, args } })
  }, [submit])
  const respond = useCallback(async (session: string, interaction: string, answer: Answer, activation: Activation) => { await intent('session/answer', { session, interaction, answer, activation }) }, [intent])
  const interrupt = useCallback(async () => { if (activeRef.current) await intent('session/interrupt', { session: activeRef.current, scope: { kind: 'head' } }) }, [intent])
  const newSession = useCallback(() => { ++selection.current; activeRef.current = null; setActiveId(null); clearContext(); setLoading(false) }, [clearContext])

  const loadHistory = useCallback(async () => {
    const id = activeRef.current
    if (!id) return
    const before = projectionRef.current[id]?.history.before
    const epoch = current.current.connectionId
    setLoading(true)
    try {
      const chunk = await request('session/history', { session: id, page: { ...(before ? { before } : {}), limit: 100 } })
      const existing = projectionRef.current[id]
      if (existing && epoch === current.current.connectionId) {
        const next = projectHistory(existing, chunk, before)
        updateProjection(id, next)
        if (next.resync) await openSession(id, true)
      }
    } finally { setLoading(false) }
  }, [request, updateProjection, openSession])

  const chooseWorkspace = useCallback(async () => { const path = unwrap(await window.bingoDesktop.chooseWorkspace()); if (path) await connect(path) }, [connect])
  const savePreferences = useCallback(async (patch: Parameters<typeof window.bingoDesktop.savePreferences>[0]) => { setPreferences(unwrap(await window.bingoDesktop.savePreferences(patch))) }, [])
  const removeSession = useCallback(async () => {
    const id = activeRef.current, connectionId = current.current.connectionId
    if (!id || !connectionId) return
    if (unwrap(await window.bingoDesktop.deleteSession({ connectionId, session: id }))) { newSession(); await refreshSessions() }
  }, [newSession, refreshSessions])
  const report = useCallback((error: unknown) => setError(errorMessage(error)), [])
  const active = activeId ? projections[activeId] ?? null : null
  const summary = active?.snapshot.summary
  const runtimeSelection: RuntimeSelection = active ? {
    model: summary?.provider && summary.model ? `${summary.provider}/${summary.model}` : summary?.model ?? null,
    thinking: String(object(active.snapshot.config?.kernel).thinking ?? 'off')
  } : runtimeDrafts[connection.workspace ?? ''] ?? defaultRuntime
  const collaboration = selectCollaboration(sessions, projections, activeId)
  return { bootstrap, connection, preferences, sessions, projections, collaboration, active, activeId, catalogs, runtimeSelection, error, notice, commandView, loading, menuHandler, connect, openSession, newSession, send, runAction, runActionView, respond, interrupt, loadHistory, readCatalog, chooseWorkspace, savePreferences, removeSession, signIn, report, setError, setNotice, setCommandView, request }
}
