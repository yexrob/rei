import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Download, GitCompareArrows, Globe2, Info, MoreHorizontal, PanelLeft, Settings2, SquarePen, SquareTerminal, Sun, Trash2, X } from './components/icons'
import { WelcomeHero, WelcomeSuggestions } from './components/Welcome'
import { SessionMetrics } from './components/SessionMetrics'
import { SessionStatus } from './components/SessionStatus'
import { DESKTOP_IMAGE_LIMITS } from '../../shared/desktop'
import { conversationKey, useWorkspace, unwrap } from './state/useWorkspace'
import { itemText, selectSessionTitle, selectStatus, selectUsage, selectWorkspaceThreads } from './state/session'
import { Composer, emptyDraft, type Draft } from './components/Composer'
import { Timeline } from './components/Timeline'
import { byUpdated, pinKey, ProjectSidebar, updatedTime, type SessionAction, type WorkspacePage } from './components/ProjectSidebar'
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
import { configurePaths, useDisplayPath } from './paths'
import { useAttentionNotifications } from './attention'
import { ImageAttachmentError, readImageFiles } from './images'
import { localizeNotice, Toast } from './components/Toast'
import { ariaKeys, keyLabel, matches, SHORTCUTS, type ShortcutId } from './shortcuts'
import { ActionMenu, type MenuAction } from './components/ActionMenu'
import { CommandPalette } from './components/CommandPalette'
import { Splitter, useStoredSize } from './components/Splitter'
import { InteractionPanel } from './components/InteractionPanel'
import { Settings, Onboarding } from './components/Settings'
import { StructuredView, type RunAction } from './components/Content'
import { basename, ErrorBanner, IconButton, Modal, object } from './components/primitives'

const TerminalPanel = lazy(() => import('./components/TerminalPanel').then((module) => ({ default: module.TerminalPanel })))

function loadPins(): string[] {
  try { const saved: unknown = JSON.parse(localStorage.getItem('rei.pins.v1') ?? '[]'); return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string').slice(0, 200) : [] } catch { return [] }
}

function loadDrafts(): Record<string, Draft> {
  try {
    const saved = object(JSON.parse(localStorage.getItem('rei.drafts.v1') ?? '{}'))
    return Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'string').map(([key, text]) => [key, { text: String(text), images: [] }]))
  } catch { return {} }
}

export default function App(): React.JSX.Element { return <I18nProvider><WorkspaceApp /></I18nProvider> }

function WorkspaceApp(): React.JSX.Element {
  const { t, locale } = useI18n()
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
  const [pins, setPins] = useState(loadPins)
  const [pendingAction, setPendingAction] = useState<{ hostId: string; id: string; action: SessionAction } | null>(null)
  const [operations, setOperations] = useState<Record<string, { sending: number; commands: number }>>({})
  const sendLocks = useRef(new Set<string>())
  const panelToggles = useRef({ terminal: () => {}, browser: () => {}, review: () => {} })
  const [reviewCount, setReviewCount] = useState<number | null>(null)
  const [browserWidth, setBrowserWidth] = useStoredSize('rei.browser-width.v1')
  const [reviewWidth, setReviewWidth] = useStoredSize('rei.review-width.v1')
  const [terminalHeight, setTerminalHeight] = useStoredSize('rei.terminal-height.v1')
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
  configurePaths({ scratch: w.bootstrap?.scratchWorkspace })
  const formatPath = useDisplayPath()
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
  const attentionSessions = useMemo(() => sidebarProjects.flatMap(project => project.sessions.map(({ summary, status, titleOmitted }) => ({ hostId: project.connection.hostId, sessionId: summary.id, title: (!titleOmitted && summary.title) || t('Untitled session'), status }))), [sidebarProjects, t])
  useAttentionNotifications(attentionSessions, w.preferences?.notifications !== false, t)
  const pageLinks = w.agentPages.filter(agentPage => agentPage.status !== 'invalidated' && !(agentPage.status === 'opened' && agentPage.hostId === w.target?.hostId && agentPage.connectionId === w.target.connectionId && agentPage.sessionId === w.target.sessionId)).map(agentPage => {
    const host = w.hosts[agentPage.hostId], summary = host?.sessions.find(session => session.id === agentPage.sessionId)
    const name = `${basename(host?.connection.workspace ?? agentPage.hostId)} · ${summary?.title || agentPage.sessionId}`
    return { key: JSON.stringify([agentPage.hostId, agentPage.connectionId, agentPage.sessionId, agentPage.itemId]), name, title: agentPage.title, open: () => { ++presentationGeneration.current; setPage('thread'); void w.openAgentPage(agentPage).catch(() => {}) } }
  })
  const setDraft = (draft: Draft) => setDrafts((current) => ({ ...current, [key]: draft }))
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
    setPage('thread'); setPalette(false); setMenu(false); setPendingAction(null)
    if (window.innerWidth < 760) setSidebar(false)
    void (hostId ? w.viewHost(hostId, id) : w.openSession(id)).then(() => { if (isCurrent()) input.current?.focus() }).catch(() => { /* Destination reports its own error. */ })
  }
  const openSessionRef = useRef(openSession); openSessionRef.current = openSession
  useEffect(() => window.bingoDesktop.onNotificationActivated?.(({ hostId, sessionId }) => openSessionRef.current(sessionId, hostId)), [])
  const selectCollaborator = (id: string) => {
    setBrowserOpen(false); setReviewOpen(false)
    if (id === w.activeId) { input.current?.focus(); return }
    openSession(id)
  }
  const compose = (text: string) => {
    setDrafts((current) => { const previous = current[key] ?? emptyDraft; return { ...current, [key]: { ...previous, text: previous.text ? text.startsWith('/') ? `${text}${previous.text}` : `${previous.text}\n\n${text}` : text } } })
    setPage('thread'); if (window.innerWidth < 900) setReviewOpen(false)
    requestAnimationFrame(() => input.current?.focus())
  }
  // Suggestions fill (never send) the draft, keeping anything already typed.
  const fillDraft = (text: string) => {
    const next = draft.text.trim() ? `${draft.text.trimEnd()}\n\n${text}` : text
    setDraft({ ...draft, text: next })
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.length, next.length) })
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
  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem('rei.drafts.v1', JSON.stringify(Object.fromEntries(Object.entries(drafts).filter(([, draft]) => draft.text).slice(-100).map(([key, draft]) => [key, draft.text])))); setDraftError('') }
      catch { setDraftError(t('Drafts cannot be saved on this device. Keep the window open to preserve unsent text.')) }
    }, 350)
    return () => clearTimeout(timer)
  }, [drafts, t])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const run = (id: ShortcutId, action: () => void) => { if (matches(event, SHORTCUTS[id])) { event.preventDefault(); action() } }
      run('newSession', newSession)
      run('search', () => { setPalette(true); setQuery('') })
      run('settings', () => setSettings(true))
      run('sidebar', () => setSidebar((value) => !value))
      run('focusMessage', () => input.current?.focus())
      run('terminal', () => panelToggles.current.terminal())
      run('browser', () => panelToggles.current.browser())
      run('review', () => panelToggles.current.review())
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [newSession])
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
  // Pasted/dropped files are read here with the picker's formats and limits.
  const attachFiles = (files: File[]) => {
    const draftKey = key, owner = w.preview
    const finish = beginOperation(operationKey, 'commands')
    void readImageFiles(files, (draftRef.current[draftKey] ?? emptyDraft).images.length).then(images => {
      if (!owner || !w.isCurrentEpoch(owner)) return
      if ((draftRef.current[draftKey] ?? emptyDraft).images.length + images.length > DESKTOP_IMAGE_LIMITS.count) throw new ImageAttachmentError('count')
      setDrafts(current => { const previous = current[draftKey] ?? emptyDraft; return { ...current, [draftKey]: { ...previous, images: [...previous.images, ...images] } } })
    }).catch(error => w.report(error instanceof ImageAttachmentError ? new Error(t(error.message)) : error)).finally(finish)
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
      // Only from the composer, the page itself or the conversation's non-editable
      // content: Escape in the review form, browser address or terminal never stops work.
      const target = event.target instanceof HTMLElement ? event.target : null
      const neutral = !target || target === document.body || target === document.documentElement
      const conversational = target?.id === 'message-input' || Boolean(target?.closest('.conversation') && !target.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]'))
      if (!neutral && !conversational) return
      event.preventDefault(); stopCurrent()
    }
    window.addEventListener('keydown', stop)
    return () => window.removeEventListener('keydown', stop)
  }, [settings, palette, environmentOpen, rename, bypass, menu, ready, state?.turn, stopCurrent])
  const editable = !room && !childAgent
  const platform = w.bootstrap?.platform ?? 'unknown'
  const keys = (id: ShortcutId) => ({ shortcut: keyLabel(platform, SHORTCUTS[id]), 'aria-keyshortcuts': ariaKeys(platform, SHORTCUTS[id]) })
  const canReview = ready && !scratch && !room
  const reviewUnavailable = room ? 'Review is unavailable in rooms.' : scratch ? 'Review needs a project folder. Personal space is not a Git workspace.' : !ready ? 'Connect to review changes.' : ''
  const toggleTerminal = () => { setPage('thread'); setTerminalMounted(true); setTerminalOpen(value => !value) }
  const toggleBrowser = () => { if (browserOpen && page === 'thread') setBrowserOpen(false); else showBrowser() }
  const toggleReview = () => { if (reviewOpen && page === 'thread') { setReviewOpen(false); return } if (!canReview) return; setPage('thread'); setBrowserOpen(false); setReviewOpen(true) }
  panelToggles.current = { terminal: toggleTerminal, browser: toggleBrowser, review: toggleReview }
  // Splitter bounds come from the live layout; CSS also caps sizes for narrow windows.
  const measure = (selector: string, axis: 'width' | 'height', fallback: number) => document.querySelector(selector)?.getBoundingClientRect()[axis] || fallback
  const contentWidth = () => measure('.workspace-content', 'width', window.innerWidth)
  const sessionMenuItems: MenuAction[] = [
    ...(editable ? [{ key: 'rename', label: 'Rename session', onSelect: () => setRename({ name: title, apply: (name: string) => w.runAction('rename', name), report: w.report }) }] : []),
    { key: 'export', label: 'Export Markdown', icon: <Download size={14} />, onSelect: exportSession },
    ...(editable ? [{ key: 'delete', label: 'Delete session…', icon: <Trash2 size={14} />, danger: true, onSelect: () => { void w.removeSession().catch(w.report) } }] : [])
  ]
  const runSessionAction = (action: SessionAction) => {
    if (action === 'export') exportSession()
    else if (action === 'rename' && editable) setRename({ name: title, apply: (name: string) => w.runAction('rename', name), report: w.report })
    else if (action === 'delete' && editable) void w.removeSession().catch(w.report)
  }
  // Sidebar rows act through the same flows as the header menu: open the row's
  // session first, then run the action once it is the ready foreground session.
  const sessionAction = (hostId: string, id: string, action: SessionAction) => {
    if (action === 'pin') {
      const key = pinKey(hostId, id)
      setPins(current => { const next = current.includes(key) ? current.filter(item => item !== key) : [key, ...current].slice(0, 200); try { localStorage.setItem('rei.pins.v1', JSON.stringify(next)) } catch { /* Pins stay for this window. */ } return next })
      return
    }
    if (ready && state && w.connection.hostId === hostId && w.activeId === id && page === 'thread') { runSessionAction(action); return }
    openSession(id, hostId); setPendingAction({ hostId, id, action })
  }
  useEffect(() => {
    if (!pendingAction || !ready || !state || w.connection.hostId !== pendingAction.hostId || w.activeId !== pendingAction.id) return
    setPendingAction(null); runSessionAction(pendingAction.action)
  })
  const currentError = w.error || w.connection.error?.message || draftError
  const browserOccluded = settings || palette || environmentOpen || rename !== null || Boolean(bypass) || Boolean(state?.interactions?.length)

  return <StartupTransition ready={Boolean(w.bootstrap) || Boolean(w.error)}><div className={`app-shell ${sidebar ? 'sidebar-visible' : 'sidebar-hidden'}`} data-platform={w.bootstrap?.platform ?? 'unknown'}>
    <a className="skip-link" href={page === 'thread' ? '#message-input' : '#workspace-main'}>{t(page === 'thread' ? 'Skip to message' : 'Skip to content')}</a>
    <ProjectSidebar projects={sidebarProjects} activeHostId={w.preview?.hostId} onHostSession={(hostId, id) => openSession(id, hostId)} onHostProject={hostId => { ++presentationGeneration.current; setPage('thread'); void w.viewHost(hostId).catch(() => {}) }} onCloseHost={hostId => { void w.closeHost(hostId).catch(() => {}) }} agentPages={pageLinks} pinned={pins} onSessionAction={sessionAction} visible={sidebar} platform={w.bootstrap?.platform ?? 'unknown'} page={page} workspace={w.connection.workspace} scratchWorkspace={w.bootstrap?.scratchWorkspace} recentWorkspaces={w.preferences?.recentWorkspaces ?? []} sessions={visibleSessions} activeId={w.collaboration.rootId ?? w.activeId} ready={ready} connecting={w.connection.status === 'connecting'} loading={w.loading} onHide={() => setSidebar(false)} onSearch={() => { setPalette(true); setQuery('') }} onNewThread={newSession} onPage={navigate} onChooseProject={chooseProject} onProject={changeProject} onSession={openSession} onSettings={() => setSettings(true)} />
    {sidebar && <button className="sidebar-scrim" aria-label={t('Close navigation')} onClick={() => setSidebar(false)} />}
    <main className="workspace-main" id="workspace-main" tabIndex={-1}><header className="workspace-header"><div className="header-location">{!sidebar && <IconButton label="Show sidebar" {...keys('sidebar')} onClick={() => setSidebar(true)}><PanelLeft size={18} /></IconButton>}<h1 title={page === 'thread' ? title : undefined}>{page === 'thread' ? title : t(page === 'skills' ? 'Skills' : 'Automations')}</h1>{page === 'thread' && (room || childAgent) && <span className="conversation-kind">{t(room ? 'Room' : 'Sub-agent')}</span>}{page === 'thread' && state && <span className="breadcrumb" title={formatPath(w.connection.workspace) || workspaceLabel}>{workspaceLabel}</span>}</div><div className="header-actions">{page === 'thread' && state && <><SessionStatus status={status} /><IconButton label="Session details" aria-pressed={details} onClick={() => setDetails(!details)}><Info size={17} /></IconButton><ActionMenu label="Session actions" icon={<MoreHorizontal size={19} />} open={menu} onOpenChange={setMenu} items={sessionMenuItems} /></>}{page === 'thread' && <div className="header-panel-toggles"><EnvironmentPanel open={environmentOpen} onOpenChange={setEnvironmentOpen} entries={w.collaboration.entries} activeId={w.activeId} onSelect={selectCollaborator} onReview={() => { setBrowserOpen(false); setReviewOpen(true) }} workspaceName={workspaceLabel} workspacePath={scratch ? null : w.connection.workspace} ready={ready} canReview={canReview} disabled={w.loading} /><button type="button" className={`icon-button tool-toggle review-header-toggle ${reviewOpen ? 'active' : ''}`} aria-label={t('Review changes')} aria-pressed={reviewOpen} aria-disabled={!canReview && !reviewOpen ? true : undefined} title={reviewUnavailable && !reviewOpen ? t(reviewUnavailable) : `${t('Review changes')} (${keyLabel(platform, SHORTCUTS.review)})`} aria-keyshortcuts={ariaKeys(platform, SHORTCUTS.review)} onClick={toggleReview}><GitCompareArrows size={17} />{canReview && reviewCount !== null && reviewCount > 0 && <span className="toggle-count" aria-hidden="true">{reviewCount > 99 ? '99+' : reviewCount}</span>}</button><IconButton label="Browser" {...keys('browser')} aria-pressed={browserOpen} className={`icon-button tool-toggle ${browserOpen ? 'active' : ''}`} onClick={toggleBrowser}><Globe2 size={17} /></IconButton><IconButton label="Terminal" {...keys('terminal')} aria-pressed={terminalOpen} className={`icon-button tool-toggle ${terminalOpen ? 'active' : ''}`} onClick={toggleTerminal}><SquareTerminal size={18} /></IconButton></div>}</div></header>
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
      {details && state && <section className="session-details" aria-label={t('Session details')}><div><span>{t('Working directory')}</span><strong title={state.summary.cwd}>{formatPath(state.summary.cwd, 80)}</strong></div>{!room && <div><span>{t('Runtime')}</span><strong>{state.summary.provider} / {state.summary.model}</strong></div>}{!room && <SessionMetrics {...selectUsage(w.active!)} context={state.context} />}</section>}
      {!ready && !state ? <Onboarding workspace={w} openLink={openLink} /> : room && w.active ? <>
        {ready && currentError && <ErrorBanner message={currentError} onDismiss={() => { w.setError(''); setDraftError('') }} />}
        <RoomConversation key={operationKey} projection={w.active} sessions={w.sessions} onSelectAgent={selectCollaborator} previewReference={(kind, id) => { void w.previewReference(kind, id).catch(w.report) }} saveReference={(kind, id) => { void w.exportReference(kind, id).catch(w.report) }} exportProgress={w.exportProgress} cancelExport={() => { void w.cancelExport().catch(w.report) }} openLink={openLink} runAction={runAction} loadHistory={() => { void w.loadHistory().catch(w.report) }} loading={w.loading} composer={<>
          {state?.interactions?.map((interaction) => <InteractionPanel key={`${operationKey}:${interaction.id}`} interaction={interaction} disabled={!ready || identityOmitted || uncertainRuntime} openLink={interaction.kind.kind === 'login' ? openSignIn : openLink} respond={(answer, activation) => w.respond(interaction.session, interaction.id, answer, activation)} />)}
          <RoomComposer key={operationKey} draft={draft} setDraft={setDraft} send={() => void send()} attach={attach} ready={ready && !w.active.resync && !uncertainRuntime && !identityOmitted} sending={sending || commandBusy || w.loading} roomName={title} closed={room.closed} members={room.members} inputRef={input} />
        </>} />
      </> : <div className={`conversation ${showWelcome ? 'empty-conversation' : ''}`}>
        {showWelcome && <WelcomeHero workspaceName={workspaceLabel} workspacePath={scratch ? undefined : w.connection.workspace ?? undefined} chooseProject={chooseProject} />}
        {w.active && !showWelcome && <Timeline key={operationKey} connected={ready} projection={w.active} childIds={w.hosts[w.connection.hostId]?.childIds[w.activeId ?? ''] ?? []} childScanComplete={w.hosts[w.connection.hostId]?.childScanComplete[w.activeId ?? ''] ?? false} previewReference={(kind, id) => { void w.previewReference(kind, id).catch(w.report) }} saveReference={(kind, id) => { void w.exportReference(kind, id).catch(w.report) }} exportProgress={w.exportProgress} cancelExport={() => { void w.cancelExport().catch(w.report) }} assistantName={agentName} openLink={openLink} runAction={runAction} sessions={w.sessions} onSelectSession={selectCollaborator} loadHistory={() => { void w.loadHistory().catch(w.report) }} loading={w.loading} />}
        {w.commandView && !settings && <div className="command-result"><IconButton label="Dismiss command result" onClick={() => w.setCommandView(null)}><X size={15} /></IconButton><StructuredView view={w.commandView} runAction={runAction} openLink={openLink} /></div>}
        {state?.interactions?.map((interaction) => <InteractionPanel key={`${operationKey}:${interaction.id}`} interaction={interaction} disabled={!ready || identityOmitted || uncertainRuntime} openLink={interaction.kind.kind === 'login' ? openSignIn : openLink} respond={(answer, activation) => w.respond(interaction.session, interaction.id, answer, activation)} />)}
        {ready && currentError && <div className="composer-error"><ErrorBanner message={currentError} onDismiss={() => { w.setError(''); setDraftError('') }} onRetry={w.active?.resync && w.activeId ? () => { void w.openSession(w.activeId!, true).catch(w.report) } : undefined} /></div>}
        <Composer draft={draft} setDraft={setDraft} send={() => void send()} stop={stopCurrent} attach={attach} attachFiles={attachFiles} ready={ready && !w.active?.resync} submitReady={ready && !w.active?.resync && !identityOmitted && !uncertainRuntime} busy={ready && Boolean(state?.turn)} sending={sending || commandBusy || w.loading} model={model} thinking={thinking} permission={permission} models={w.catalogs.models?.entries ?? []} commands={w.catalogs.commands?.entries ?? []} command={command} inputRef={input} queue={state?.queue} workspaceName={workspaceLabel} chooseProject={chooseProject} recipient={hasCollaboration || childAgent ? { name: agentName, role: childAgent ? 'agent' : 'main' } : undefined} />
        {showWelcome && <WelcomeSuggestions onSuggestion={fillDraft} recent={byUpdated(visibleSessions.filter(session => session.id !== w.activeId).map(summary => ({ summary }))).slice(0, 3).map(({ summary }) => ({ key: summary.id, title: summary.title || t('Untitled session'), when: updatedTime(summary.updatedAt, locale), open: () => openSession(summary.id) }))} />}
      </div>}
      </div>{reviewOpen && page === 'thread' && <Splitter label="Resize review panel" orientation="vertical" value={reviewWidth ?? measure('.review-panel', 'width', 520)} min={320} max={contentWidth() - 320} onChange={setReviewWidth} onReset={() => setReviewWidth(null)} />}<ReviewPanel visible={reviewOpen && page === 'thread'} workspace={w.connection.workspace} onClose={() => setReviewOpen(false)} onCompose={compose} onCount={setReviewCount} width={reviewWidth} />{browserOpen && page === 'thread' && <Splitter label="Resize browser panel" orientation="vertical" value={browserWidth ?? measure('.browser-panel', 'width', 480)} min={310} max={contentWidth() - 300} onChange={setBrowserWidth} onReset={() => setBrowserWidth(null)} />}<BrowserPanel visible={browserOpen && page === 'thread'} occluded={browserOccluded} onClose={() => setBrowserOpen(false)} width={browserWidth} /></div>{terminalMounted && terminalOpen && page === 'thread' && <Splitter label="Resize terminal" orientation="horizontal" value={terminalHeight ?? measure('.terminal-panel', 'height', 260)} min={140} max={measure('.workspace-body', 'height', window.innerHeight) - 160} onChange={setTerminalHeight} onReset={() => setTerminalHeight(null)} />}{terminalMounted && <Suspense fallback={<section className="terminal-panel"><p className="terminal-status">{t('Starting terminal…')}</p></section>}><TerminalPanel visible={terminalOpen && page === 'thread'} onClose={() => setTerminalOpen(false)} height={terminalHeight} /></Suspense>}</div>
    </main>
    {w.notice && <Toast key={w.notice} message={localizeNotice(w.notice, t)} onDismiss={() => w.setNotice('')} />}
    {settings && <Settings key={`${w.connection.hostId}:${w.connection.connectionId}`} workspace={w} initialPage={settingsPage} onClose={() => { setSettings(false); setSettingsPage('general') }} openLink={openLink} clearDrafts={() => { setDrafts({}); localStorage.removeItem('rei.drafts.v1') }} />}
    {palette && <CommandPalette onClose={() => setPalette(false)}
      sessions={sidebarProjects.flatMap(project => byUpdated(project.sessions).map(({ summary, titleOmitted }) => ({ hostId: project.connection.hostId, id: summary.id, title: titleOmitted ? t('Title not loaded') : summary.title || t('Untitled session'), caption: formatPath(summary.cwd, 56), path: summary.cwd, project: formatPath(project.connection.workspace) })))}
      commands={(w.catalogs.commands?.entries ?? []).map(entry => ({ id: entry.id, label: entry.label }))}
      onSession={(hostId, id) => openSession(id, hostId)}
      onCommand={(id) => { setDraft({ ...draft, text: `/${id} ` }); setPalette(false); requestAnimationFrame(() => input.current?.focus()) }}
      actions={[
        { id: 'new', label: 'New conversation', icon: <SquarePen size={16} />, shortcut: keyLabel(platform, SHORTCUTS.newSession), run: () => { setPalette(false); newSession() } },
        { id: 'theme', label: 'Toggle theme', icon: <Sun size={16} />, run: () => { setPalette(false); void w.savePreferences({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }).catch(w.report) } },
        { id: 'terminal', label: 'Toggle terminal', icon: <SquareTerminal size={16} />, shortcut: keyLabel(platform, SHORTCUTS.terminal), run: () => { setPalette(false); toggleTerminal() } },
        { id: 'browser', label: 'Toggle browser', icon: <Globe2 size={16} />, shortcut: keyLabel(platform, SHORTCUTS.browser), run: () => { setPalette(false); toggleBrowser() } },
        { id: 'review', label: 'Review changes', icon: <GitCompareArrows size={16} />, shortcut: keyLabel(platform, SHORTCUTS.review), disabled: !canReview, hint: reviewUnavailable, run: () => { setPalette(false); toggleReview() } },
        { id: 'settings', label: 'Settings', icon: <Settings2 size={16} />, shortcut: keyLabel(platform, SHORTCUTS.settings), run: () => { setPalette(false); setSettings(true) } },
        { id: 'sidebar', label: 'Toggle sidebar', icon: <PanelLeft size={16} />, shortcut: keyLabel(platform, SHORTCUTS.sidebar), run: () => { setPalette(false); setSidebar(value => !value) } }
      ]} />}
    {rename !== null && <Modal title={t('Rename session')} onClose={() => setRename(null)}><form onSubmit={event => { event.preventDefault(); const request = rename, finish = beginOperation(operationKey, 'commands'); void request.apply(request.name.trim()).then(() => setRename(current => current === request ? null : current)).catch(request.report).finally(finish) }}><label className="field-label">{t('Session name')}<input autoFocus maxLength={80} value={rename.name} onChange={event => setRename({ ...rename, name: event.target.value })} /></label><div className="button-row"><button type="button" onClick={() => setRename(null)}>{t('Cancel')}</button><button className="primary" disabled={commandBusy || !rename.name.trim()} type="submit">{t('Save name')}</button></div></form></Modal>}
    {bypass && <Modal title={t('Bypass permission prompts?')} onClose={() => setBypass(null)}><p>{t('bingo will run tools without asking, except actions reserved for a person. This can change files, execute commands and contact external services. Explicit deny rules still apply.')}</p><div className="button-row"><button onClick={() => setBypass(null)}>{t('Keep asking')}</button><button className="danger-button" onClick={() => { const request = bypass; setBypass(null); request.apply() }}>{t('Bypass for this session')}</button></div></Modal>}
  </div></StartupTransition>
}
