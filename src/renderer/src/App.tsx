import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import type { PromptResponse, CliEvent } from '../../shared/contracts/cli'
import type { EditableSettings, GuiError, RendererSessionEvent, RuntimeInfo, RuntimeSettings, SessionSummary, SettingsSnapshot } from '../../shared/contracts/ipc'
import { chatReducer, initialChatState } from './state/chatReducer'

type Connection = { id: string; sequence: number }

/** F6-1: a busy indicator that appears only after the 200 ms feedback threshold. */
function DelayedThinking(): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 200)
    return () => clearTimeout(timer)
  }, [])
  return visible ? <p className="thinking" role="status" aria-live="polite">Working…</p> : null
}

export default function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(chatReducer, initialChatState)
  const [draft, setDraft] = useState('')
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionListError, setSessionListError] = useState<GuiError | null>(null)
  const [activeSession, setActiveSession] = useState<SessionSummary | null>(null)
  const [sessionMenu, setSessionMenu] = useState<string | null>(null)
  const [renameSession, setRenameSession] = useState<SessionSummary | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteSession, setDeleteSession] = useState<SessionSummary | null>(null)
  const [sessionMutationError, setSessionMutationError] = useState<GuiError | null>(null)
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [thinkingLevel, setThinkingLevel] = useState<RuntimeSettings['thinkingLevel']>('off')
  const [settingsError, setSettingsError] = useState<GuiError | null>(null)
  const [savingRuntime, setSavingRuntime] = useState(false)
  const [view, setView] = useState<'chat' | 'settings'>('chat')
  const [settingsSnapshot, setSettingsSnapshot] = useState<SettingsSnapshot | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<EditableSettings | null>(null)
  const [settingsPageError, setSettingsPageError] = useState<GuiError | null>(null)
  const [themeSetting, setThemeSetting] = useState<'auto' | 'dark' | 'light'>('auto')
  const [toast, setToast] = useState<string | null>(null)
  const [flowError, setFlowError] = useState<GuiError | null>(null)
  const [connected, setConnected] = useState(false)
  const connection = useRef<Connection | null>(null)
  const activeTurnId = useRef<string | null>(null)
  const connectInFlight = useRef(false)
  const errorRef = useRef<HTMLDivElement | null>(null)
  const prompt = state.prompts[0]

  useEffect(() => {
    activeTurnId.current = state.turnId
  }, [state.turnId])

  // F6-6: focus the inline error region (asynchronously, after render) so
  // assistive tech and keyboard users land on what failed.
  useEffect(() => {
    if (!state.error) return
    const frame = requestAnimationFrame(() => errorRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [state.error])

  const connect = useCallback(async () => {
    if (connectInFlight.current) return
    connectInFlight.current = true
    setFlowError(null)
    setSessionListError(null)
    const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms))])
    try {
      const probe = await withTimeout(window.bingoGui.probeRuntime(), 12_000)
      if (!probe.ok) { setFlowError(probe.error); return }
      setRuntime(probe.value)
      const listed = await withTimeout(window.bingoGui.listSessions(), 12_000)
      if (listed.ok) setSessions(listed.value.sessions)
      else setSessionListError(listed.error)
      const opened = await withTimeout(window.bingoGui.openSession({ sessionId: null }), 12_000)
      if (!opened.ok) { setFlowError(opened.error); return }
      connection.current = { id: opened.value.connectionId, sequence: 0 }
      setActiveSession({ id: opened.value.metadata.sessionId, name: opened.value.metadata.displayName, preview: '', updatedAt: new Date().toISOString(), messageCount: 0 })
      setThemeSetting(opened.value.metadata.theme)
      dispatch({ type: 'restore', history: opened.value.history })
      const loadedSettings = await withTimeout(window.bingoGui.readRuntimeSettings({ workspacePath: probe.value.workspacePath }), 12_000)
      if (loadedSettings.ok) {
        setRuntimeSettings(loadedSettings.value)
        setSelectedProvider(loadedSettings.value.provider)
        setSelectedModel(loadedSettings.value.model)
        setThinkingLevel(loadedSettings.value.thinkingLevel)
        const listedModels = await withTimeout(window.bingoGui.listModels({ workspacePath: probe.value.workspacePath, provider: loadedSettings.value.provider }), 12_000)
        if (listedModels.ok) setModels(listedModels.value.models)
        // Background model-list probe failures stay quiet: the picker shows
        // "Select model" and the settings page surfaces save-time errors.
      } else setSettingsError(loadedSettings.error)
      setConnected(true)
    } catch {
      setFlowError({ code: 'CONNECTION_TIMEOUT', msg: 'Could not connect to bingo within 12 seconds. Retry.', level: 'flow', recoverable: true, action: 'retry' })
    } finally {
      connectInFlight.current = false
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.bingoGui.onSessionEvent((event: RendererSessionEvent) => {
      const current = connection.current
      if (!current || event.connectionId !== current.id || event.sequence !== current.sequence + 1) return
      if ('turnId' in event.payload && event.payload.turnId && activeTurnId.current && event.payload.turnId !== activeTurnId.current) return
      current.sequence = event.sequence
      if (event.payload.type === 'transport.error') dispatch({ type: 'transport-error', code: event.payload.error.code, msg: event.payload.error.msg })
      else dispatch({ type: 'event', event: event.payload as CliEvent })
    })
    void connect()
    return unsubscribe
  }, [connect])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3_000)
    return () => clearTimeout(timer)
  }, [toast])

  const openSettings = async (): Promise<void> => {
    if (!runtime) return
    setView('settings')
    setSettingsPageError(null)
    const result = await window.bingoGui.readSettings({ workspacePath: runtime.workspacePath })
    if (!result.ok) { setSettingsPageError(result.error); return }
    setSettingsSnapshot(result.value)
    setSettingsDraft(result.value.values)
  }

  const saveSettings = async (): Promise<void> => {
    if (!runtime || !settingsSnapshot || !settingsDraft) return
    setSettingsPageError(null)
    const result = await window.bingoGui.saveSettings({ workspacePath: runtime.workspacePath, baseRevision: settingsSnapshot.revision, values: settingsDraft })
    if (!result.ok) { setSettingsPageError(result.error); return }
    setSettingsSnapshot(result.value.snapshot)
    setSettingsDraft(result.value.snapshot.values)
    setThemeSetting(result.value.snapshot.values.theme)
    setRuntimeSettings({ providers: result.value.snapshot.providers, provider: result.value.snapshot.values.provider, model: result.value.snapshot.values.model, thinkingLevel: result.value.snapshot.values.thinkingLevel, theme: result.value.snapshot.values.theme })
    if (result.value.connectionId) connection.current = { id: result.value.connectionId, sequence: 0 }
    setToast('Saved')
  }

  const newConversation = async (): Promise<void> => {
    connection.current = null
    activeTurnId.current = null
    setConnected(false)
    dispatch({ type: 'reset' })
    const opened = await window.bingoGui.openSession({ sessionId: null })
    if (!opened.ok) { setFlowError(opened.error); return }
    connection.current = { id: opened.value.connectionId, sequence: 0 }
    setActiveSession({ id: opened.value.metadata.sessionId, name: opened.value.metadata.displayName, preview: '', updatedAt: new Date().toISOString(), messageCount: 0 })
    setConnected(true)
  }

  const openSession = async (session: SessionSummary): Promise<void> => {
    if (state.turnId || activeSession?.id === session.id) return
    connection.current = null
    activeTurnId.current = null
    setConnected(false)
    setFlowError(null)
    const opened = await window.bingoGui.openSession({ sessionId: session.id })
    if (!opened.ok) { setFlowError(opened.error); return }
    connection.current = { id: opened.value.connectionId, sequence: 0 }
    setActiveSession(session)
    dispatch({ type: 'restore', history: opened.value.history })
    setConnected(true)
  }

  const submitRename = async (): Promise<void> => {
    if (!renameSession || !renameDraft.trim()) return
    setSessionMutationError(null)
    const result = await window.bingoGui.renameSession({ sessionId: renameSession.id, name: renameDraft })
    if (!result.ok) { setSessionMutationError(result.error); return }
    setSessions((current) => current.map((item) => item.id === result.value.previousId ? result.value.session : item))
    if (activeSession?.id === result.value.previousId) setActiveSession(result.value.session)
    setRenameSession(null)
    setSessionMenu(null)
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteSession) return
    setSessionMutationError(null)
    const result = await window.bingoGui.deleteSession({ sessionId: deleteSession.id })
    if (!result.ok) { setSessionMutationError(result.error); return }
    setSessions((current) => current.filter((item) => item.id !== result.value.deletedId))
    if (activeSession?.id === result.value.deletedId) {
      connection.current = null
      activeTurnId.current = null
      setActiveSession(null)
      setConnected(false)
      dispatch({ type: 'reset' })
    }
    setDeleteSession(null)
    setSessionMenu(null)
  }

  const changeProvider = async (provider: string): Promise<void> => {
    if (!runtime) return
    setSelectedProvider(provider)
    setSelectedModel('')
    setModels([])
    setSettingsError(null)
    const result = await window.bingoGui.listModels({ workspacePath: runtime.workspacePath, provider })
    if (!result.ok) { setSettingsError(result.error); return }
    setModels(result.value.models)
    setSelectedModel(result.value.models[0] ?? '')
  }

  const saveRuntime = async (): Promise<void> => {
    if (!runtime || !selectedProvider || !selectedModel) return
    setSavingRuntime(true)
    setSettingsError(null)
    const result = await window.bingoGui.saveRuntimeSettings({ workspacePath: runtime.workspacePath, provider: selectedProvider, model: selectedModel, thinkingLevel })
    setSavingRuntime(false)
    if (!result.ok) { setSettingsError(result.error); return }
    setRuntimeSettings(result.value.settings)
    if (result.value.connectionId) connection.current = { id: result.value.connectionId, sequence: 0 }
  }

  const submit = async (): Promise<void> => {
    const active = connection.current
    if (!draft.trim() || state.turnId || !active) return
    const turnId = crypto.randomUUID()
    const promptText = draft
    activeTurnId.current = turnId
    dispatch({ type: 'submit', turnId, prompt: promptText })
    setDraft('')
    const result = await window.bingoGui.sendTurn({ connectionId: active.id, turnId, prompt: promptText })
    if (!result.ok) dispatch({ type: 'transport-error', code: result.error.code, msg: result.error.msg })
  }

  const cancel = async (): Promise<void> => {
    const active = connection.current
    if (!active || !state.turnId) return
    const result = await window.bingoGui.cancelTurn({ connectionId: active.id, turnId: state.turnId })
    if (!result.ok) dispatch({ type: 'transport-error', code: result.error.code, msg: result.error.msg })
  }

  const respond = async (response: PromptResponse): Promise<void> => {
    const active = connection.current
    if (!active || !prompt) return
    const result = await window.bingoGui.respondToPrompt({ connectionId: active.id, turnId: prompt.turnId, promptId: prompt.promptId, response })
    if (!result.ok) dispatch({ type: 'transport-error', code: result.error.code, msg: result.error.msg })
  }

  // F6-7: effective theme follows the bingo setting (auto = system preference).
  // The attribute goes on <html> so :root's color/background and inheritance
  // resolve against the active theme (a div-scoped attribute would leave the
  // root scope on the light values and break dark mode text contrast).
  const effectiveTheme = themeSetting === 'auto'
    ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : themeSetting
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme
  }, [effectiveTheme])

  if (flowError) return <FlowError error={flowError} retry={connect} />

  return (
    <div className="app-shell" data-qa-state="chat">
      <nav className="sidebar" aria-label="Primary navigation">
        <strong>bingo</strong>
        <button type="button" className={`nav-action${view === 'chat' ? ' active' : ''}`} aria-current={view === 'chat' ? 'page' : undefined} onClick={() => { setView('chat'); void newConversation() }}>New conversation</button>
        <button type="button" className={`nav-action${view === 'settings' ? ' active' : ''}`} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => void openSettings()}>Settings</button>
        <div className="session-heading"><span>Conversations</span><small>{sessions.length}</small></div>
        <div className="session-list">
          {sessionListError && <p className="sidebar-error" role="alert">{sessionListError.msg}</p>}
          {sessions.length === 0 && !sessionListError && <p className="sidebar-empty">No saved conversations yet.</p>}
          {sessions.map((session) => (
            <div className={`session-row${activeSession?.id === session.id ? ' active' : ''}`} key={session.id}>
              <button type="button" className="session-item" aria-current={activeSession?.id === session.id ? 'page' : undefined} onClick={() => void openSession(session)}>
                <span>{session.name}</span>
                <small>{session.preview || 'Empty conversation'}</small>
                <time dateTime={session.updatedAt}>{formatSessionTime(session.updatedAt)}</time>
              </button>
              <button type="button" className="session-more" aria-label={`Actions for ${session.name}`} onClick={() => setSessionMenu((current) => current === session.id ? null : session.id)}>•••</button>
              {sessionMenu === session.id && <div className="session-menu">
                <button type="button" onClick={() => { setRenameSession(session); setRenameDraft(session.name); setSessionMutationError(null) }}>Rename</button>
                <button type="button" onClick={() => { setDeleteSession(session); setSessionMutationError(null) }}>Delete</button>
              </div>}
            </div>
          ))}
        </div>
        <span className="runtime-version">{runtime ? `bingo ${runtime.bingoVersion} · protocol ${runtime.protocolVersion}` : 'Connecting…'}</span>
      </nav>
      {view === 'chat' ? <main className="chat">
        <header className="chat-header"><div><p className="eyebrow">Local conversation</p><h1>{activeSession?.name ?? 'New conversation'}</h1></div>{runtimeSettings && <div className="runtime-picker" aria-label="Runtime settings">
          <label>Provider<select aria-label="Provider" value={selectedProvider} onChange={(event) => void changeProvider(event.target.value)}>{runtimeSettings.providers.map((provider) => <option value={provider.name} key={provider.name}>{provider.name}{provider.builtin ? ' · built-in' : ''}{provider.credentialConfigured ? '' : ' · not configured'}</option>)}</select></label>
          <label>Model<select aria-label="Model" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}><option value="" disabled>Select model</option>{models.map((model) => <option value={model} key={model}>{model}</option>)}</select></label>
          <label>Thinking<select aria-label="Thinking level" value={thinkingLevel} onChange={(event) => setThinkingLevel(event.target.value as RuntimeSettings['thinkingLevel'])}>{['off', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => <option value={level} key={level}>{level}</option>)}</select></label>
          <button type="button" disabled={savingRuntime || !selectedModel || Boolean(state.turnId)} onClick={() => void saveRuntime()}>{savingRuntime ? 'Saving…' : 'Apply'}</button>
        </div>}</header>
        {settingsError && <div className="settings-error" role="alert"><strong>{settingsError.code}</strong><span>{settingsError.msg}</span></div>}
        <section className="timeline" aria-live="polite">
          {state.messages.length === 0 && <p className="chat-hint">Send a prompt to start working with bingo.</p>}
          {state.turnId && !state.messages.some((m) => m.role === 'assistant' && m.markdown) && <DelayedThinking />}
          {state.messages.map((message) => <article className={`message ${message.role}`} key={message.id}><span>{message.role === 'user' ? 'You' : 'bingo'}</span><Markdown skipHtml>{message.markdown}</Markdown>{message.status === 'interrupted' && <small>Interrupted</small>}</article>)}
          {state.tools.map((tool) => <article className="tool-row" key={tool.id}><strong>{tool.name}</strong><span>{tool.summary}</span><small>{tool.status}</small></article>)}
          {state.error && <div ref={errorRef} tabIndex={-1} className="inline-error" role="alert"><strong>{state.error.code}</strong><span>{state.error.msg}</span></div>}
        </section>
        <footer className="composer"><textarea aria-label="Message" value={draft} disabled={Boolean(state.turnId) || !connected} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} placeholder="Ask bingo…" />{state.turnId ? <button type="button" onClick={() => void cancel()}>Cancel</button> : <button type="button" onClick={() => void submit()}>Send</button>}</footer>
      </main> : <SettingsScreen snapshot={settingsSnapshot} draft={settingsDraft} error={settingsPageError} onChange={setSettingsDraft} onSave={saveSettings} />}
      {toast && <div className="toast" role="status" aria-live="polite" onMouseEnter={(event) => { event.currentTarget.dataset.paused = 'true' }}>{toast}</div>}
      {prompt && <div className="modal-backdrop" role="presentation"><section className="prompt-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title"><p className="eyebrow">{prompt.kind}</p><h2 id="prompt-title">{prompt.title}</h2><p>{prompt.question}</p><div className="prompt-actions">{prompt.options.map((option) => <button type="button" key={option.id} onClick={() => void respond({ kind: 'option', optionId: option.id })}>{option.label}</button>)}<button type="button" onClick={() => void respond({ kind: 'cancel' })}>Cancel</button></div></section></div>}
      {renameSession && <div className="modal-backdrop" role="presentation"><section className="prompt-modal" role="dialog" aria-modal="true" aria-labelledby="rename-title"><p className="eyebrow">Conversation</p><h2 id="rename-title">Rename conversation</h2><label className="field-label">Name<input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} /></label>{sessionMutationError && <p className="dialog-error" role="alert">{sessionMutationError.msg}</p>}<div className="prompt-actions"><button type="button" onClick={() => void submitRename()}>Save</button><button type="button" className="secondary-action" onClick={() => setRenameSession(null)}>Cancel</button></div></section></div>}
      {deleteSession && <div className="modal-backdrop" role="presentation"><section className="prompt-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><p className="eyebrow">Permanent action</p><h2 id="delete-title">Delete “{deleteSession.name}”?</h2><p>This removes the conversation transcript. This action cannot be undone.</p>{sessionMutationError && <p className="dialog-error" role="alert">{sessionMutationError.msg}</p>}<div className="prompt-actions"><button type="button" className="danger-action" onClick={() => void confirmDelete()}>Delete conversation</button><button type="button" className="secondary-action" onClick={() => setDeleteSession(null)}>Cancel</button></div></section></div>}
    </div>
  )
}

function SettingsScreen({ snapshot, draft, error, onChange, onSave }: { snapshot: SettingsSnapshot | null; draft: EditableSettings | null; error: GuiError | null; onChange: (value: EditableSettings) => void; onSave: () => Promise<void> }): React.JSX.Element {
  if (error && !snapshot) return <main className="settings-page"><section className="settings-panel" role="alert"><p className="eyebrow">Settings unavailable</p><h1>{error.code}</h1><p>{error.msg}</p></section></main>
  if (!snapshot || !draft) return <main className="settings-page"><p>Loading settings…</p></main>
  const update = <K extends keyof EditableSettings>(key: K, value: EditableSettings[K]): void => onChange({ ...draft, [key]: value })
  const shadowed = (key: keyof EditableSettings): boolean => snapshot.shadowed.includes(key)
  const clean = JSON.stringify(draft) === JSON.stringify(snapshot.values)
  return <main className="settings-page">
    <header><div><p className="eyebrow">User configuration</p><h1>Settings</h1><p className="settings-path">{snapshot.path}</p></div><button type="button" disabled={clean} onClick={() => void onSave()}>Save changes</button></header>
    {error && <div className="settings-page-error" role="alert"><strong>{error.code}</strong><span>{error.msg}</span></div>}
    <section className="settings-panel">
      <h2>Runtime</h2><p>Changes write only to the user layer. Workspace overrides remain read-only.</p>
      <div className="settings-grid">
        <label>Provider<select value={draft.provider} disabled={shadowed('provider')} onChange={(event) => update('provider', event.target.value)}>{snapshot.providers.map((provider) => <option key={provider.name} value={provider.name}>{provider.name}{provider.credentialConfigured ? '' : ' · not configured'}</option>)}</select>{shadowed('provider') && <small>Managed by {snapshot.sources.provider}</small>}</label>
        <label>Model<input value={draft.model} disabled={shadowed('model')} onChange={(event) => update('model', event.target.value)} /></label>
        <label>Thinking level<select value={draft.thinkingLevel} disabled={shadowed('thinkingLevel')} onChange={(event) => update('thinkingLevel', event.target.value as EditableSettings['thinkingLevel'])}>{['off', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => <option key={level}>{level}</option>)}</select></label>
        <label>Permission mode<input value={draft.permissionMode} disabled={shadowed('permissionMode')} onChange={(event) => update('permissionMode', event.target.value)} /></label>
        <label>Theme<select value={draft.theme} disabled={shadowed('theme')} onChange={(event) => update('theme', event.target.value as EditableSettings['theme'])}><option>auto</option><option>dark</option><option>light</option></select></label>
        <label>API endpoint<input value={draft.apiBaseUrl} disabled={shadowed('apiBaseUrl')} onChange={(event) => update('apiBaseUrl', event.target.value)} /></label>
        <label className="checkbox-field"><input type="checkbox" checked={draft.sendImages} disabled={shadowed('sendImages')} onChange={(event) => update('sendImages', event.target.checked)} />Send images</label>
      </div>
      <div className="provider-summary">{snapshot.providers.map((provider) => <article key={provider.name}><strong>{provider.name}</strong><span>{provider.apiBaseUrl}</span><small>{provider.protocol} · {provider.supportsImages ? 'images' : 'text only'} · {provider.credentialConfigured ? 'credential configured' : 'credential not configured'}</small></article>)}</div>
      <div className="layer-summary"><h2>Configuration layers</h2>{Object.entries(snapshot.layers).map(([name, layer]) => <p key={name}><strong>{name}</strong><span>{layer.path}</span><small>{layer.exists ? `${layer.keys.length} keys` : 'not present'}</small></p>)}</div>
    </section>
  </main>
}

function formatSessionTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function FlowError({ error, retry }: { error: GuiError; retry: () => Promise<void> }): React.JSX.Element {
  return <main className="content" data-qa-state="error"><section className="flow-error" role="alert"><p className="eyebrow">Connection required</p><h1>Unable to connect bingo</h1><p className="error-code">{error.code}</p><p>{error.msg}</p><button type="button" onClick={() => void retry()}>Retry</button></section></main>
}
