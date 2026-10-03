import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Download, Globe2, Info, MessageSquare, MoreHorizontal, PanelLeft, SquareTerminal, Terminal, Trash2, X } from './components/icons'
import { WelcomeHeading } from './components/Welcome'
import { SessionMetrics } from './components/SessionMetrics'
import { SessionStatus } from './components/SessionStatus'
import { DESKTOP_IMAGE_LIMITS } from '../../shared/desktop'
import { conversationKey, useWorkspace, unwrap } from './state/useWorkspace'
import { useStableCallback } from './state/useStableCallback'
import { useDraftPersistence, withDraft } from './state/drafts'
import { itemText, selectSessionTitle, selectStatus, selectUsage, selectWorkspaceThreads } from './state/session'
import { Composer, emptyDraft, type Draft } from './components/Composer'
import { Timeline } from './components/Timeline'
import { ProjectSidebar, type WorkspacePage } from './components/ProjectSidebar'
import { SkillsPage } from './components/SkillsPage'
import { AutomationsPage } from './components/AutomationsPage'
import { ReviewPanel } from './components/ReviewPanel'
import { EnvironmentPanel } from './components/EnvironmentPanel'
import { RoomConversation } from './components/RoomConversation'
import { RoomComposer } from './components/RoomComposer'
import { isAgentSession, isRoomSession, roomMetadata } from './state/collaboration'
import { StartupTransition } from './components/StartupTransition'
import { BrowserPanel } from './components/BrowserPanel'
import { I18nProvider, useI18n } from './i18n'
import { InteractionPanel } from './components/InteractionPanel'
import { Settings, Onboarding } from './components/Settings'
import { StructuredView, type RunAction } from './components/Content'
import { basename, ErrorBanner, IconButton, Modal, object } from './components/primitives'

const TerminalPanel = lazy(() => import('./components/TerminalPanel').then((module) => ({ default: module.TerminalPanel })))

function loadDrafts(): Record<string, Draft> {
  try {
    const saved = object(JSON.parse(localStorage.getItem('rei.drafts.v1') ?? '{}'))
    return Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'string').map(([key, text]) => [key, { text: String(text), images: [] }]))
  } catch { return {} }
}

export default function App(): React.JSX.Element { return <I18nProvider><WorkspaceApp /></I18nProvider> }

function WorkspaceApp(): React.JSX.Element {
  const { t } = useI18n()
  const w = useWorkspace()
  const [sidebar, setSidebar] = useState(() => window.innerWidth >= 760)
  const [page, setPage] = useState<WorkspacePage>('thread')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [environmentOpen, setEnvironmentOpen] = useState(false)
  const [settings, setSettings] = useState(false)
  const [settingsPage, setSettingsPage] = useState('general')
  const [palette, setPalette] = useState(false)
  const [query, setQuery] = useState('')
  const [details, setDetails] = useState(false)
  const [menu, setMenu] = useState(false)
  const [rename, setRename] = useState<{ name: string; apply: (name: string) => Promise<unknown>; report: (error: unknown) => void } | null>(null)
  const [bypass, setBypass] = useState<{ apply: () => void } | null>(null)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalMounted, setTerminalMounted] = useState(false)
  const [drafts, setDrafts] = useState(loadDrafts)
  const [operations, setOperations] = useState<Record<string, { sending: number; commands: number }>>({})
  const sendLocks = useRef(new Set<string>())
  const presentationGeneration = useRef(0)
  const connectionId = useRef(w.connection.connectionId)
  connectionId.current = w.connection.connectionId
  const [draftError, setDraftError] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const key = conversationKey(w.connection.hostId || 'welcome', w.activeId)
  const legacyKey = `${w.connection.workspace ?? 'welcome'}:${w.activeId ?? 'new'}`
  const operationKey = JSON.stringify([key, w.preview?.connectionId])
  const sending = Boolean(operations[operationKey]?.sending)
  const commandBusy = Boolean(operations[operationKey]?.commands)
  const beginOperation = (owner: string, kind: 'sending' | 'commands') => {
    setOperations(current => { const old = current[owner] ?? { sending: 0, commands: 0 }; return { ...current, [owner]: { ...old, [kind]: old[kind] + 1 } } })
    return () => setOperations(current => { const old = current[owner]; if (!old) return current; const next = { ...old, [kind]: Math.max(0, old[kind] - 1) }; if (!next.sending && !next.commands) { const { [owner]: _, ...rest } = current; return rest } return { ...current, [owner]: next } })
  }
  const draft = drafts[key] ?? drafts[legacyKey] ?? emptyDraft
  const draftRef = useRef(drafts); draftRef.current = drafts
  const ready = w.ready
  useEffect(() => {
    if (!w.connection.hostId || key === legacyKey) return
    setDrafts(current => { if (!current[legacyKey]) return current; const { [legacyKey]: legacy, ...rest } = current; return { ...rest, [key]: current[key] ?? legacy } })
  }, [key, legacyKey, w.connection.hostId])
  const state = w.active?.snapshot
  const identityOmitted = Boolean(state?.summary.parent && w.active?.omittedFields?.some(field => field.path.join('.') === 'summary.key'))
  const uncertainRuntime = Boolean(w.active?.unloaded?.some(ref => ref.stateUncertain))
  const title = w.active?.omittedFields?.some(field => field.path.join('.') === 'summary.title') ? t('Title not loaded') : w.active ? selectSessionTitle(w.active) : t('New thread')
  const room = state && isRoomSession(state.summary) ? roomMetadata(state) : null
  const childAgent = state ? isAgentSession(state.summary) : false
  const agentName = identityOmitted ? t('Session type not loaded') : childAgent ? state?.summary.title || t('Agent') : 'Bingo'
  const hasCollaboration = w.collaboration.entries.length > 1
  const status = !ready ? w.connection.status === 'connecting' ? 'connecting' : 'disconnected' : room?.closed ? 'closed' : w.active ? selectStatus(w.active) : 'ready'
  const showWelcome = !state?.items.length && !w.active?.unloaded?.length && !w.active?.unloadedHistory?.length && !w.active?.omittedFields?.length && !w.hosts[w.connection.hostId]?.childIds[w.activeId ?? '']?.length && w.active?.tree?.descendantsComplete !== false && (w.active?.history.complete ?? true) && !childAgent && !state?.turn
  const scratch = w.connection.workspace === w.bootstrap?.scratchWorkspace
  const workspaceLabel = scratch ? t('Personal space') : w.connection.workspace ? basename(w.connection.workspace) : t('Personal space')
  const model = w.runtimeSelection.model ?? ''
  const thinking = w.runtimeSelection.thinking ?? '__default'
  const permission = state ? String(object(state.config?.plugins?.['bingo.permissions']).mode ?? 'default') : '__default'
  const visibleSessions = useMemo(() => selectWorkspaceThreads(w.sessions, w.connection.workspace), [w.sessions, w.connection.workspace])
  const sidebarProjects = useMemo(() => Object.values(w.hosts).map(host => ({
    connection: host.connection,
    sessions: selectWorkspaceThreads(host.sessions, host.connection.workspace).map(summary => {
      const projection = host.projections[summary.id], currentEpoch = host.projectionEpochs[summary.id] === host.connection.connectionId
      const status = host.connection.status !== 'ready' ? 'disconnected' : currentEpoch && projection ? selectStatus(projection) : summary.busy ? 'working' : 'ready'
      const error = host.contexts[JSON.stringify(summary.id)]?.error
      return { summary, status: error && !['working', 'retrying', 'waiting'].includes(status) ? 'failed' : status, titleOmitted: currentEpoch && projection ? Boolean(projection.omittedFields?.some(field => field.path.join('.') === 'summary.title')) : Boolean(host.headOmissions[summary.id]?.some(field => field.field === 'title')), unread: Boolean(projection && ((projection.transportSeq ?? projection.snapshot.seq) > (w.watermarks[conversationKey(host.connection.hostId, summary.id)] ?? 0) || projection.unloaded?.length || projection.unloadedHistory?.length)) }
    })
  })), [w.hosts, w.watermarks])
  const pageLinks = w.agentPages.filter(agentPage => agentPage.status !== 'invalidated' && !(agentPage.status === 'opened' && agentPage.hostId === w.target?.hostId && agentPage.connectionId === w.target.connectionId && agentPage.sessionId === w.target.sessionId)).map(agentPage => {
    const host = w.hosts[agentPage.hostId], summary = host?.sessions.find(session => session.id === agentPage.sessionId)
    const name = `${basename(host?.connection.workspace ?? agentPage.hostId)} · ${summary?.title || agentPage.sessionId}`
    return { key: JSON.stringify([agentPage.hostId, agentPage.connectionId, agentPage.sessionId, agentPage.itemId]), name, title: agentPage.title, open: () => { ++presentationGeneration.current; setPage('thread'); void w.openAgentPage(agentPage).catch(() => {}) } }
  })
  const setDraft = (draft: Draft) => setDrafts((current) => withDraft(current, key, draft))
  const showBrowser = useCallback(() => { setPage('thread'); setReviewOpen(false); setBrowserOpen(true); if (window.innerWidth < 1050) setSidebar(false) }, [])
  const openLink = useCallback((url: string) => {
    if (!window.bingoPanels) { w.report(new Error('Browser unavailable')); return }
    showBrowser(); void window.bingoPanels.browserNavigate(url).then(unwrap).catch(w.report)
  }, [w.report, showBrowser])
  const openSignIn = useCallback((url: string) => { void window.bingoDesktop.openExternal(url).then(unwrap).catch(w.report) }, [w.report])
  const handledPage = useRef(0)
  useEffect(() => {
    const event = w.agentPageEvent
    if (!event || event.sequence === handledPage.current) return
    handledPage.current = event.sequence
    const source = event.page, selected = w.target
    if (ready && selected?.hostId === source.hostId && selected.connectionId === source.connectionId && selected.sessionId === source.sessionId) showBrowser()
  }, [w.agentPageEvent, w.target, ready, showBrowser])
  useEffect(() => {
    if (page !== 'thread' || settings || !ready || !w.target || !state) return
    const owner = w.target, seq = state.seq
    const markVisible = () => { if (document.visibilityState === 'visible' && document.hasFocus()) w.markRead(owner, seq) }
    markVisible()
    document.addEventListener('visibilitychange', markVisible)
    window.addEventListener('focus', markVisible)
    return () => { document.removeEventListener('visibilitychange', markVisible); window.removeEventListener('focus', markVisible) }
  }, [page, settings, ready, w.target, state, w.markRead])
  useEffect(() => { setRename(null); setBypass(null); setMenu(false); setDetails(false) }, [operationKey])
  const retainPresentation = useCallback(() => {
    const generation = presentationGeneration.current, connection = connectionId.current
    return () => generation === presentationGeneration.current && connection === connectionId.current
  }, [])
  const runAction: RunAction = useCallback((action) => {
    void w.runAction(action.name, action.args).catch(() => {})
  }, [w.runAction, w.report])
  const stopCurrent = useCallback(() => {
    if (state?.turn) void w.interrupt(state.turn.id).catch(w.report)
  }, [w.interrupt, w.report, state?.turn])
  const newSession = useCallback(() => { ++presentationGeneration.current; setPage('thread'); void w.newSession().catch(w.report); if (window.innerWidth < 760) setSidebar(false); requestAnimationFrame(() => input.current?.focus()) }, [w.newSession])
  const openSession = (id: string, hostId?: string) => {
    ++presentationGeneration.current
    const isCurrent = retainPresentation()
    setPage('thread'); setPalette(false); setMenu(false)
    if (window.innerWidth < 760) setSidebar(false)
    void (hostId ? w.viewHost(hostId, id) : w.openSession(id)).then(() => { if (isCurrent()) input.current?.focus() }).catch(() => { /* Destination reports its own error. */ })
  }
  // Stable for memoized transcript rows (onSelectSession) and room agents.
  const selectCollaborator = useStableCallback((id: string) => {
    setBrowserOpen(false); setReviewOpen(false)
    if (id === w.activeId) { input.current?.focus(); return }
    openSession(id)
  })
  const compose = (text: string) => {
    setDrafts((current) => { const previous = current[key] ?? emptyDraft; return withDraft(current, key, { ...previous, text: previous.text ? text.startsWith('/') ? `${text}${previous.text}` : `${previous.text}\n\n${text}` : text }) })
    setPage('thread'); if (window.innerWidth < 900) setReviewOpen(false)
    requestAnimationFrame(() => input.current?.focus())
  }
  const navigate = (next: WorkspacePage) => { ++presentationGeneration.current; setPage(next); if (window.innerWidth < 760) setSidebar(false) }
  const chooseProject = () => { ++presentationGeneration.current; void w.chooseWorkspace().then(() => setPage('thread')).catch(w.report) }
  const changeProject = (path: string) => { ++presentationGeneration.current; setReviewOpen(false); void w.connect(path).then(() => setPage('thread')).catch(w.report) }

  useEffect(() => {
    const theme = w.preferences?.theme ?? 'system'
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? media.matches ? 'dark' : 'light' : theme }
    apply(); media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [w.preferences?.theme])
  useDraftPersistence(drafts, saved => setDraftError(saved ? '' : t('Drafts cannot be saved on this device. Keep the window open to preserve unsent text.')))
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); newSession() }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette(true); setQuery('') }
      if (event.key === ',') { event.preventDefault(); setSettings(true) }
      if (event.key.toLowerCase() === 'b') { event.preventDefault(); setSidebar((value) => !value) }
      if (event.key.toLowerCase() === 'l') { event.preventDefault(); input.current?.focus() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [newSession])
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element).closest('.session-options')) setMenu(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(false) }
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [menu])
  useEffect(() => { if (!w.notice) return; const timer = setTimeout(() => w.setNotice(''), 7000); return () => clearTimeout(timer) }, [w.notice, w.setNotice])
  w.menuHandler.current = (action) => { if (action === 'new-session') newSession(); if (action === 'preferences') setSettings(true); if (action === 'choose-workspace') void w.chooseWorkspace().catch(w.report) }

  const send = async () => {
    if (sendLocks.current.has(operationKey) || !ready || room?.closed) return
    const submitted = draft, draftKey = key, hostId = w.connection.hostId, epoch = w.preview?.connectionId
    const isCurrent = retainPresentation()
    let lock = operationKey, finish = beginOperation(lock, 'sending')
    sendLocks.current.add(lock); w.clearContextError()
    try {
      const session = w.activeId ?? await w.openSession()
      const targetKey = conversationKey(hostId, session), targetOperation = JSON.stringify([targetKey, epoch])
      if (targetOperation !== lock) {
        finish(); sendLocks.current.delete(lock); lock = targetOperation
        sendLocks.current.add(lock); finish = beginOperation(lock, 'sending')
      }
      if (targetKey !== draftKey) setDrafts(current => ({ ...current, [targetKey]: submitted, ...(current[draftKey] === submitted ? { [draftKey]: emptyDraft } : {}) }))
      await w.send(submitted.text, submitted.images, session)
      setDrafts(current => current[targetKey] === submitted ? { ...current, [targetKey]: emptyDraft } : current)
    } catch { /* The captured create/submit operation records errors on its own destination. */ }
    finally { sendLocks.current.delete(lock); finish(); if (isCurrent()) input.current?.focus() }
  }
  const applyCommand = (name: string, value: string) => {
    const finish = beginOperation(operationKey, 'commands')
    void w.runAction(name, value).then(() => w.clearContextError()).catch(() => {}).finally(finish)
  }
  const command = (name: string, value: string) => {
    if (name === 'permission' && value === 'bypassPermissions') { setBypass({ apply: () => applyCommand(name, value) }); return }
    applyCommand(name, value)
  }
  const attach = () => {
    const draftKey = key, owner = w.preview
    const finish = beginOperation(operationKey, 'commands')
    void window.bingoDesktop.chooseImages().then(unwrap).then(images => {
      if (!owner || !w.isCurrentEpoch(owner)) return
      const previous = draftRef.current[draftKey] ?? emptyDraft
      if (previous.images.length + images.length > DESKTOP_IMAGE_LIMITS.count) { w.report(new Error(t('Attach at most two images per message. Remove an image before adding another.'))); return }
      setDrafts(current => ({ ...current, [draftKey]: { ...(current[draftKey] ?? emptyDraft), images: [...previous.images, ...images] } }))
    }).catch(w.report).finally(finish)
  }
  const retry = () => { void w.reconnect().catch(w.report) }
  const exportSession = () => {
    if (!state) return
    void window.bingoDesktop.exportText({ suggestedName: `${title.replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 60) || 'conversation'}.md`, text: `# ${title}\n\n${state.items.map(itemText).filter(Boolean).join('\n\n---\n\n')}` }).then(unwrap).then((saved) => { if (saved) w.setNotice(t('Conversation exported. Only currently loaded history was included.')) }).catch(w.report)
    setMenu(false)
  }
  useEffect(() => {
    const stop = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]') || settings || palette || environmentOpen || rename !== null || bypass || menu || !ready || !state?.turn) return
      event.preventDefault(); stopCurrent()
    }
    window.addEventListener('keydown', stop)
    return () => window.removeEventListener('keydown', stop)
  }, [settings, palette, environmentOpen, rename, bypass, menu, ready, state?.turn, stopCurrent])
  const currentError = w.error || w.connection.error?.message || draftError
  const browserOccluded = settings || palette || environmentOpen || rename !== null || Boolean(bypass) || Boolean(state?.interactions?.length)

  return <StartupTransition ready={Boolean(w.bootstrap) || Boolean(w.error)}><div className={`app-shell ${sidebar ? 'sidebar-visible' : 'sidebar-hidden'}`} data-platform={w.bootstrap?.platform ?? 'unknown'}>
    <a className="skip-link" href={page === 'thread' ? '#message-input' : '#workspace-main'}>{t(page === 'thread' ? 'Skip to message' : 'Skip to content')}</a>
    <ProjectSidebar projects={sidebarProjects} activeHostId={w.preview?.hostId} onHostSession={(hostId, id) => openSession(id, hostId)} onHostProject={hostId => { ++presentationGeneration.current; setPage('thread'); void w.viewHost(hostId).catch(() => {}) }} onCloseHost={hostId => { void w.closeHost(hostId).catch(() => {}) }} agentPages={pageLinks} visible={sidebar} platform={w.bootstrap?.platform ?? 'unknown'} page={page} workspace={w.connection.workspace} scratchWorkspace={w.bootstrap?.scratchWorkspace} recentWorkspaces={w.preferences?.recentWorkspaces ?? []} sessions={visibleSessions} activeId={w.collaboration.rootId ?? w.activeId} ready={ready} connecting={w.connection.status === 'connecting'} loading={w.loading} onHide={() => setSidebar(false)} onSearch={() => { setPalette(true); setQuery('') }} onNewThread={newSession} onPage={navigate} onChooseProject={chooseProject} onProject={changeProject} onSession={openSession} onSettings={() => setSettings(true)} />
    {sidebar && <button className="sidebar-scrim" aria-label={t('Close navigation')} onClick={() => setSidebar(false)} />}
    <main className="workspace-main" id="workspace-main" tabIndex={-1}><header className="workspace-header"><div className="header-location">{!sidebar && <IconButton label="Show sidebar" onClick={() => setSidebar(true)}><PanelLeft size={18} /></IconButton>}<h1>{page === 'thread' ? title : t(page === 'skills' ? 'Skills' : 'Automations')}</h1>{page === 'thread' && (room || childAgent) && <span className="conversation-kind">{t(room ? 'Room' : 'Sub-agent')}</span>}{page === 'thread' && state && <span className="breadcrumb">{workspaceLabel}</span>}</div><div className="header-actions">{page === 'thread' && state && <><SessionStatus status={status} /><IconButton label="Session details" aria-pressed={details} onClick={() => setDetails(!details)}><Info size={17} /></IconButton><div className="session-options"><IconButton label="Session actions" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={19} /></IconButton>{menu && <div className="options-popover">{!room && !childAgent && <button onClick={() => { setRename({ name: title, apply: (name) => w.runAction('rename', name), report: w.report }); setMenu(false) }}>{t('Rename session')}</button>}<button onClick={exportSession}><Download size={14} />{t('Export Markdown')}</button>{!room && !childAgent && <button className="danger-text" onClick={() => { setMenu(false); void w.removeSession().catch(w.report) }}><Trash2 size={14} />{t('Delete session…')}</button>}</div>}</div></>}{page === 'thread' && <div className="header-panel-toggles"><EnvironmentPanel open={environmentOpen} onOpenChange={setEnvironmentOpen} entries={w.collaboration.entries} activeId={w.activeId} onSelect={selectCollaborator} onReview={() => { setBrowserOpen(false); setReviewOpen(true) }} workspaceName={workspaceLabel} workspacePath={scratch ? null : w.connection.workspace} ready={ready} canReview={ready && !scratch && !room} disabled={w.loading} /><IconButton label="Browser" aria-pressed={browserOpen} className={`icon-button tool-toggle ${browserOpen ? 'active' : ''}`} onClick={() => browserOpen ? setBrowserOpen(false) : showBrowser()}><Globe2 size={17} /></IconButton><IconButton label="Terminal" aria-pressed={terminalOpen} className={`icon-button tool-toggle ${terminalOpen ? 'active' : ''}`} onClick={() => { setTerminalMounted(true); setTerminalOpen(!terminalOpen) }}><SquareTerminal size={18} /></IconButton></div>}</div></header>
      {page === 'skills' && <SkillsPage key={`${w.connection.hostId}:${w.connection.connectionId}`} workspace={w} openLink={openLink} onCompose={compose} />}
      {page === 'automations' && <AutomationsPage key={`${w.connection.hostId}:${w.connection.connectionId}`} workspace={w} openLink={openLink} onCompose={compose} />}
      <div className="workspace-body" hidden={page !== 'thread'}><div className={`workspace-content ${browserOpen ? 'with-browser' : ''} ${reviewOpen ? 'with-review' : ''}`}><div className="conversation-column">
      {w.collaboration.rootId && w.activeId !== w.collaboration.rootId && <div className="collaboration-toolbar"><button className="back-to-main" onClick={() => selectCollaborator(w.collaboration.rootId!)} disabled={!ready || w.loading}><ArrowLeft size={15} />{t('Back to Bingo')}</button></div>}
      {!ready && currentError && <ErrorBanner message={currentError} onDismiss={() => { w.setError(''); setDraftError('') }} onRetry={w.active?.resync && w.activeId ? () => { void w.openSession(w.activeId!, true).catch(w.report) } : !ready ? retry : undefined} />}
      {identityOmitted && <ErrorBanner message={t('This session type is not loaded. Sending and permission actions are paused until its identity is verified.')} />}
      {w.active?.provisional && <p className="secondary" role="status">{t('Verifying the bounded session preview…')}</p>}
      {!ready && state && !w.active?.provisional && <div className="reconnect-banner"><span>{t('Your conversation is still here. Reconnect to continue.')}</span><button onClick={retry}>{t('Reconnect')}</button><button onClick={() => setSettings(true)}>{t('Settings')}</button></div>}
      {ready && !room && w.catalogs.providers && !w.catalogs.providers.entries.some((entry) => ['ready', 'notApplicable'].includes(String(object(object(entry.meta).auth).kind))) && <div className="reconnect-banner"><span>{t('Connect a model provider before starting your first task.')}</span><button onClick={() => { setSettingsPage('models'); setSettings(true) }}>{t('Set up provider')}</button></div>}
      {!room && state?.summary.driver === 'log' && !state.interactions?.length && <div className="reconnect-banner"><span>{t('This session is for provider setup. Start a new session when sign-in is complete.')}</span><button onClick={newSession}>{t('New session')}</button></div>}
      {details && state && <section className="session-details" aria-label={t('Session details')}><div><span>{t('Working directory')}</span><strong>{state.summary.cwd}</strong></div>{!room && <div><span>{t('Runtime')}</span><strong>{state.summary.provider} / {state.summary.model}</strong></div>}{!room && <SessionMetrics {...selectUsage(w.active!)} context={state.context} />}</section>}
      {!ready && !state ? <Onboarding workspace={w} openLink={openLink} /> : room && w.active ? <>
        {ready && currentError && <ErrorBanner message={currentError} onDismiss={() => { w.setError(''); setDraftError('') }} />}
        <RoomConversation key={operationKey} projection={w.active} sessions={w.sessions} onSelectAgent={selectCollaborator} previewReference={(kind, id) => { void w.previewReference(kind, id).catch(w.report) }} saveReference={(kind, id) => { void w.exportReference(kind, id).catch(w.report) }} exportProgress={w.exportProgress} cancelExport={() => { void w.cancelExport().catch(w.report) }} openLink={openLink} runAction={runAction} loadHistory={() => { void w.loadHistory().catch(w.report) }} loading={w.loading} composer={<>
          {state?.interactions?.map((interaction) => <InteractionPanel key={`${operationKey}:${interaction.id}`} interaction={interaction} disabled={!ready || identityOmitted || uncertainRuntime} openLink={interaction.kind.kind === 'login' ? openSignIn : openLink} respond={(answer, activation) => w.respond(interaction.session, interaction.id, answer, activation)} />)}
          <RoomComposer key={operationKey} draft={draft} setDraft={setDraft} send={() => void send()} attach={attach} ready={ready && !w.active.resync && !uncertainRuntime && !identityOmitted} sending={sending || commandBusy || w.loading} roomName={title} closed={room.closed} members={room.members} inputRef={input} />
        </>} />
      </> : <div className={`conversation ${showWelcome ? 'empty-conversation' : ''}`}>
        {showWelcome && <WelcomeHeading />}
        {w.active && !showWelcome && <Timeline key={operationKey} connected={ready} projection={w.active} childIds={w.hosts[w.connection.hostId]?.childIds[w.activeId ?? ''] ?? []} childScanComplete={w.hosts[w.connection.hostId]?.childScanComplete[w.activeId ?? ''] ?? false} previewReference={(kind, id) => { void w.previewReference(kind, id).catch(w.report) }} saveReference={(kind, id) => { void w.exportReference(kind, id).catch(w.report) }} exportProgress={w.exportProgress} cancelExport={() => { void w.cancelExport().catch(w.report) }} assistantName={agentName} openLink={openLink} runAction={runAction} sessions={w.sessions} onSelectSession={selectCollaborator} loadHistory={() => { void w.loadHistory().catch(w.report) }} loading={w.loading} />}
        {w.commandView && !settings && <div className="command-result"><IconButton label="Dismiss command result" onClick={() => w.setCommandView(null)}><X size={15} /></IconButton><StructuredView view={w.commandView} runAction={runAction} openLink={openLink} /></div>}
        {state?.interactions?.map((interaction) => <InteractionPanel key={`${operationKey}:${interaction.id}`} interaction={interaction} disabled={!ready || identityOmitted || uncertainRuntime} openLink={interaction.kind.kind === 'login' ? openSignIn : openLink} respond={(answer, activation) => w.respond(interaction.session, interaction.id, answer, activation)} />)}
        {ready && currentError && <div className="composer-error"><ErrorBanner message={currentError} onDismiss={() => { w.setError(''); setDraftError('') }} onRetry={w.active?.resync && w.activeId ? () => { void w.openSession(w.activeId!, true).catch(w.report) } : undefined} /></div>}
        <Composer draft={draft} setDraft={setDraft} send={() => void send()} stop={stopCurrent} attach={attach} ready={ready && !w.active?.resync} submitReady={ready && !w.active?.resync && !identityOmitted && !uncertainRuntime} busy={ready && Boolean(state?.turn)} sending={sending || commandBusy || w.loading} model={model} thinking={thinking} permission={permission} models={w.catalogs.models?.entries ?? []} commands={w.catalogs.commands?.entries ?? []} command={command} inputRef={input} queue={state?.queue} workspaceName={workspaceLabel} chooseProject={chooseProject} recipient={hasCollaboration || childAgent ? { name: agentName, role: childAgent ? 'agent' : 'main' } : undefined} />
      </div>}
      </div><ReviewPanel visible={reviewOpen && page === 'thread'} workspace={w.connection.workspace} onClose={() => setReviewOpen(false)} onCompose={compose} /><BrowserPanel visible={browserOpen && page === 'thread'} occluded={browserOccluded} onClose={() => setBrowserOpen(false)} /></div>{terminalMounted && <Suspense fallback={<section className="terminal-panel"><p className="terminal-status">{t('Starting terminal…')}</p></section>}><TerminalPanel visible={terminalOpen && page === 'thread'} onClose={() => setTerminalOpen(false)} /></Suspense>}</div>
    </main>
    {w.notice && <div className="toast" role="status"><span>{w.notice}</span><IconButton label="Dismiss notification" onClick={() => w.setNotice('')}><X size={14} /></IconButton></div>}
    {settings && <Settings key={`${w.connection.hostId}:${w.connection.connectionId}`} workspace={w} initialPage={settingsPage} onClose={() => { setSettings(false); setSettingsPage('general') }} openLink={openLink} clearDrafts={() => { setDrafts({}); localStorage.removeItem('rei.drafts.v1') }} />}
    {palette && <Modal title={t('Search & commands')} onClose={() => setPalette(false)}><input className="palette-input" autoFocus aria-label={t('Search sessions and commands')} placeholder={t('Find a session or type a command…')} value={query} onChange={(event) => setQuery(event.target.value)} /><div className="palette-results">{visibleSessions.filter((session) => `${session.title} ${session.cwd}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12).map((session) => <button key={session.id} onClick={() => openSession(session.id)}><MessageSquare size={16} /><span>{session.title || t('Untitled session')}<small>{basename(session.cwd)}</small></span><ArrowUpRight size={14} /></button>)}{w.catalogs.commands?.entries.filter((entry) => entry.id.includes(query.replace(/^\//, '').toLowerCase())).slice(0, 8).map((entry) => <button key={entry.id} onClick={() => { setDraft({ ...draft, text: `/${entry.id} ` }); setPalette(false); requestAnimationFrame(() => input.current?.focus()) }}><Terminal size={16} /><span>/{entry.id}<small>{entry.label}</small></span></button>)}{!visibleSessions.some((session) => `${session.title} ${session.cwd}`.toLowerCase().includes(query.toLowerCase())) && !w.catalogs.commands?.entries.some((entry) => entry.id.includes(query.replace(/^\//, '').toLowerCase())) && <p className="secondary">{t('No matching sessions or commands.')}</p>}</div></Modal>}
    {rename !== null && <Modal title={t('Rename session')} onClose={() => setRename(null)}><form onSubmit={event => { event.preventDefault(); const request = rename, finish = beginOperation(operationKey, 'commands'); void request.apply(request.name.trim()).then(() => setRename(current => current === request ? null : current)).catch(request.report).finally(finish) }}><label className="field-label">{t('Session name')}<input autoFocus maxLength={80} value={rename.name} onChange={event => setRename({ ...rename, name: event.target.value })} /></label><div className="button-row"><button type="button" onClick={() => setRename(null)}>{t('Cancel')}</button><button className="primary" disabled={commandBusy || !rename.name.trim()} type="submit">{t('Save name')}</button></div></form></Modal>}
    {bypass && <Modal title={t('Bypass permission prompts?')} onClose={() => setBypass(null)}><p>{t('bingo will run tools without asking, except actions reserved for a person. This can change files, execute commands and contact external services. Explicit deny rules still apply.')}</p><div className="button-row"><button onClick={() => setBypass(null)}>{t('Keep asking')}</button><button className="danger-button" onClick={() => { const request = bypass; setBypass(null); request.apply() }}>{t('Bypass for this session')}</button></div></Modal>}
  </div></StartupTransition>
}
