import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionState, DesktopBootstrap, DesktopEvent, DesktopMethod, DesktopPreferences, Result } from '../../../shared/desktop'
import type { Activation, Answer, Catalog, CatalogKind, Frame, Image, Input, RpcMethods, SessionSpec, SessionSummary, View } from '../../../shared/rpc'
import { createSessionProjection, projectFrame, projectHistory, type SessionProjection } from './session'
import { errorMessage, object } from '../components/primitives'

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
const disconnected: ConnectionState = { status: 'disconnected', connectionId: null, workspace: null, binary: null }
type Pending = { session: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
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
  const openFlights = useRef(new Map<string, Promise<string>>())
  const initialized = useRef(false)
  const menuHandler = useRef<(action: string) => void>(() => {})
  const selection = useRef(0)
  current.current = connection; projectionRef.current = projections; activeRef.current = activeId

  const request = useCallback(async <M extends DesktopMethod>(method: M, params: RpcMethods[M]['params']): Promise<RpcMethods[M]['result']> => {
    const id = current.current.connectionId
    if (!id || current.current.status !== 'ready') throw new Error('bingo is not connected. Reconnect to continue.')
    return unwrap(await window.bingoDesktop.request({ connectionId: id, method, params }))
  }, [])

  const updateProjection = useCallback((id: string, next: SessionProjection) => {
    projectionRef.current = { ...projectionRef.current, [id]: next }
    setProjections(projectionRef.current)
    setSessions((items) => [next.snapshot.summary, ...items.filter((item) => item.id !== id)])
  }, [])

  const refreshSessions = useCallback(async () => {
    const epoch = current.current.connectionId
    const result = await request('session/list', { filter: { cwd: current.current.workspace ?? undefined, limit: 500 } })
    if (epoch === current.current.connectionId) setSessions(result.sessions)
  }, [request])

  const readCatalog = useCallback(async (kind: CatalogKind) => {
    const epoch = current.current.connectionId
    const catalog = await request('catalog/read', { kind })
    if (epoch === current.current.connectionId) { catalogRef.current = { ...catalogRef.current, [kind]: catalog }; setCatalogs(catalogRef.current) }
    return catalog
  }, [request])

  const openSession = useCallback(async (id?: string, resync = false, driver: 'model' | 'log' = 'model'): Promise<string> => {
    const token = resync ? selection.current : ++selection.current
    const epoch = current.current.connectionId
    setLoading(true)
    const flightKey = `${epoch}:${id ?? `new-${driver}`}`
    let flight = openFlights.current.get(flightKey)
    if (!flight) {
      if (id) opening.current.add(id)
      flight = (async () => {
        const draft = runtimeDraftRef.current[current.current.workspace ?? ''] ?? defaultRuntime
        const opened = await request('session/open', { selector: id ? { kind: 'byId', id } : { kind: 'create', spec: { cwd: current.current.workspace ?? '', driver, ...(driver === 'log' ? { title: 'Provider setup' } : selectedModel(draft.model, catalogRef.current)) } }, options: { children: false } })
        if (epoch !== current.current.connectionId) throw new Error('Workspace changed while opening the session.')
        let projection = createSessionProjection(opened.snapshot)
        for (const frame of buffered.current.get(opened.session) ?? []) {
          if (frame.event.type === 'lagged' ? frame.event.to <= opened.snapshot.seq : frame.seq <= opened.snapshot.seq) continue
          projection = projectFrame(projection, frame)
        }
        buffered.current.delete(opened.session)
        updateProjection(opened.session, projection)
        if (!id && driver === 'model' && draft.thinking !== null) initialThinking.current.set(opened.session, draft.thinking)
        return opened.session
      })().finally(() => { if (id) opening.current.delete(id); openFlights.current.delete(flightKey) })
      openFlights.current.set(flightKey, flight)
    }
    try {
      const session = await flight
      if (!resync && token === selection.current) { activeRef.current = session; setActiveId(session); setCommandView(null) }
      return session
    } finally { if (token === selection.current) setLoading(false) }
  }, [request, updateProjection])

  const connect = useCallback(async (workspace?: string, binary?: string) => {
    setError(''); setLoading(true); ++selection.current
    try {
      const state = unwrap(await window.bingoDesktop.connect({ workspace, ...(binary ? { binary } : {}) }))
      current.current = state; setConnection(state)
      projectionRef.current = {}; setProjections({}); buffered.current.clear(); setSessions([]); catalogRef.current = {}; setCatalogs({}); setActiveId(null); activeRef.current = null; setCommandView(null)
      initialThinking.current.clear(); preparing.current.clear()
      setPreferences(unwrap(await window.bingoDesktop.savePreferences({ workspace: workspace ?? null })))
      await request('gateway/subscribe', {})
      await refreshSessions()
      await Promise.all((['models', 'commands', 'providers'] as const).map((kind) => readCatalog(kind).catch(() => undefined)))
    } catch (error) { setError(errorMessage(error)) } finally { setLoading(false) }
  }, [refreshSessions, readCatalog, request])

  const handleEvent = useRef<(event: DesktopEvent) => void>(() => {})
  handleEvent.current = (event) => {
    if (event.type === 'menu') { menuHandler.current(event.action); return }
    if (event.type === 'connection') {
      current.current = event.connection; setConnection(event.connection)
      if (event.connection.status === 'failed' || event.connection.status === 'disconnected') {
        for (const item of pending.current.values()) { clearTimeout(item.timer); item.reject(new Error('Connection lost. The request may have been accepted; reconnect and check the session before resending.')) }
        pending.current.clear()
      }
      return
    }
    if (event.connectionId !== current.current.connectionId) return
    if (event.method === 'gateway/event') {
      if (event.params.type === 'sessionCreated') setSessions((items) => [event.params.type === 'sessionCreated' ? event.params.summary : items[0], ...items.filter((item) => event.params.type !== 'sessionCreated' || item.id !== event.params.summary.id)])
      if (event.params.type === 'sessionRemoved') { const removed = event.params.session; setSessions((items) => items.filter((item) => item.id !== removed)); if (activeRef.current === removed) { setActiveId(null); activeRef.current = null } }
      if (event.params.type === 'catalogChanged') void readCatalog(event.params.kind).catch(() => {})
      return
    }
    const frame = event.params
    const data = frame.event
    if (data.type === 'intentAck') {
      const waiting = pending.current.get(data.intent)
      if (waiting) {
        clearTimeout(waiting.timer); pending.current.delete(data.intent)
        if (data.outcome.kind === 'rejected') waiting.reject(new Error(data.outcome.error.message))
        else waiting.resolve(data.outcome)
      }
      if (data.outcome.kind === 'applied' && frame.session === activeRef.current) {
        const result = object(data.outcome.result)
        if (object(result.view).kind) setCommandView(result.view as View)
        if (typeof result.message === 'string') setNotice(result.message)
      }
    }
    if (data.type === 'notice') { if (data.level === 'error') setError(data.text); else setNotice(data.text) }
    if (data.type === 'itemCompleted' && data.item.body.kind === 'action' && ['login', 'logout'].includes(data.item.body.name)) void readCatalog('providers').catch(() => {})
    if (data.type === 'catalogChanged' && ['models', 'providers', 'tools', 'commands', 'skills', 'plugins'].includes(data.kind)) void readCatalog(data.kind as CatalogKind).catch(() => {})
    const existing = projectionRef.current[frame.session]
    if (!existing || opening.current.has(frame.session)) {
      const queue = buffered.current.get(frame.session) ?? []
      if (queue.length < 10000) buffered.current.set(frame.session, [...queue, frame])
      return
    }
    const next = projectFrame(existing, frame)
    updateProjection(frame.session, next)
    if (next.resync && !existing.resync) void openSession(frame.session, true).catch((error) => setError(errorMessage(error)))
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

  const intent = useCallback(async (method: 'session/submit' | 'session/interrupt' | 'session/answer', params: Record<string, unknown> & { session: string }) => {
    const id = crypto.randomUUID()
    const outcome = new Promise<unknown>((resolve, reject) => {
      const input = object(params.input)
      const timeout = object(input.action).name === 'login' ? 300000 : 30000
      const timer = setTimeout(() => { pending.current.delete(id); reject(new Error('bingo has not acknowledged this request. Check the session before sending it again.')) }, timeout)
      pending.current.set(id, { session: params.session, resolve, reject, timer })
    })
    try {
      const wire = request(method, { ...params, intent: id } as RpcMethods[typeof method]['params'])
      await Promise.all([wire, outcome])
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

  const submit = useCallback(async (input: Input, session?: string) => {
    const epoch = current.current.connectionId
    const id = session ?? activeRef.current ?? await openSession()
    if (epoch !== current.current.connectionId) throw new Error('Workspace changed before the message could be sent.')
    // Creation has no thinking field. Apply the draft through the canonical
    // command before the first text; failed setup must never start a turn.
    if (input.kind === 'text') await prepareSession(id)
    if (epoch !== current.current.connectionId) throw new Error('Workspace changed before the message could be sent.')
    await intent('session/submit', { session: id, input })
    if (input.kind === 'action' && input.action.name === 'think' && typeof input.action.args === 'string' && input.action.args.trim()) initialThinking.current.delete(id)
    return id
  }, [intent, openSession, prepareSession])

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
  const respond = useCallback((session: string, interaction: string, answer: Answer, activation: Activation) => intent('session/answer', { session, interaction, answer, activation }), [intent])
  const interrupt = useCallback(async () => { if (activeRef.current) await intent('session/interrupt', { session: activeRef.current, scope: { kind: 'head' } }) }, [intent])
  const newSession = useCallback(() => { ++selection.current; activeRef.current = null; setActiveId(null); setCommandView(null); setLoading(false) }, [])

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
  return { bootstrap, connection, preferences, sessions, active, activeId, catalogs, runtimeSelection, error, notice, commandView, loading, menuHandler, connect, openSession, newSession, send, runAction, respond, interrupt, loadHistory, readCatalog, chooseWorkspace, savePreferences, removeSession, signIn, report, setError, setNotice, setCommandView, request }
}
