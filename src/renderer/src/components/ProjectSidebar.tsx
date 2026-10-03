import { useState } from 'react'
import { Blocks, ChevronDown, ChevronRight, Clock3, Download, Folder, MoreHorizontal, PanelLeft, Pin, Plus, ReiMark, Search, Settings2, SquarePen, Trash2, X } from './icons'
import { ActionMenu } from './ActionMenu'
import { ariaKeys, keyLabel, SHORTCUTS } from '../shortcuts'
import type { SessionSummary } from '../../../shared/rpc'
import type { ConnectionState } from '../../../shared/desktop'
import { useI18n } from '../i18n'
import { basename, IconButton } from './primitives'

export type WorkspacePage = 'thread' | 'automations' | 'skills'

export function projectPaths(workspace: string | null, scratch: string | undefined, recent: string[]): string[] {
  return [...new Set([...(workspace ? [workspace] : []), ...recent.filter((path) => path !== scratch)])]
}

export function updatedTime(value: string, locale: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value))
  if (!Number.isFinite(elapsed)) return ''
  const minutes = Math.floor(elapsed / 60000)
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' })
  if (minutes < 60) return format.format(-minutes, 'minute')
  if (minutes < 1440) return format.format(-Math.floor(minutes / 60), 'hour')
  return format.format(-Math.floor(minutes / 1440), 'day')
}

export type SessionAction = 'rename' | 'pin' | 'export' | 'delete'
export type DateGroup = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older'
const DATE_GROUPS: DateGroup[] = ['Today', 'Yesterday', 'Previous 7 days', 'Older']
/** Local-calendar bucket for a session's last update (the same time the row displays). */
export function dateGroup(value: string, now = new Date()): DateGroup {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 'Older'
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (time >= startOfToday) return 'Today'
  if (time >= startOfToday - 86_400_000) return 'Yesterday'
  return time >= startOfToday - 7 * 86_400_000 ? 'Previous 7 days' : 'Older'
}
/** Newest first by creation: rows never jump when a thread is merely opened. The shown time matches the order. */
export function byCreated<T extends { summary: SessionSummary }>(rows: T[]): T[] {
  const stamp = (row: T) => { const time = Date.parse(row.summary.createdAt); return Number.isFinite(time) ? time : 0 }
  return [...rows].sort((a, b) => stamp(b) - stamp(a) || a.summary.id.localeCompare(b.summary.id))
}
/** Most recent activity first, for "recent conversations" lists that are not navigation. */
export function byUpdated<T extends { summary: SessionSummary }>(rows: T[]): T[] {
  const stamp = (row: T) => { const time = Date.parse(row.summary.updatedAt); return Number.isFinite(time) ? time : 0 }
  return [...rows].sort((a, b) => stamp(b) - stamp(a) || a.summary.id.localeCompare(b.summary.id))
}
export const pinKey = (hostId: string, sessionId: string): string => JSON.stringify([hostId, sessionId])

export type SidebarProject = { connection: ConnectionState; sessions: { summary: SessionSummary; status: string; unread: boolean; titleOmitted?: boolean }[] }
type Props = {
  projects?: SidebarProject[]; activeHostId?: string; onHostProject?: (hostId: string) => void; onHostSession?: (hostId: string, sessionId: string) => void; onCloseHost?: (hostId: string) => void;
  agentPages?: { key: string; name: string; title: string; open: () => void }[];
  pinned?: string[]; onSessionAction?: (hostId: string, sessionId: string, action: SessionAction) => void;
  visible: boolean; platform: string; page: WorkspacePage; workspace: string | null; scratchWorkspace?: string;
  recentWorkspaces: string[]; sessions: SessionSummary[]; activeId: string | null;
  ready: boolean; connecting: boolean; loading: boolean;
  onHide(): void; onSearch(): void; onNewThread(): void; onPage(page: WorkspacePage): void;
  onChooseProject(): void; onProject(path: string): void; onSession(id: string): void; onSettings(): void;
}

export function ProjectSidebar(p: Props): React.JSX.Element {
  const { t, locale } = useI18n()
  const [collapsed, setCollapsed] = useState<string[]>([])
  const paths = projectPaths(p.workspace, p.scratchWorkspace, p.recentWorkspaces)
  const label = (path: string) => path === p.scratchWorkspace ? t('Personal space') : basename(path)
  const [menu, setMenu] = useState<string | null>(null)
  const pins = new Set(p.pinned ?? [])
  type Row = SidebarProject['sessions'][number]
  const sessionRow = (hostId: string, current: boolean, { summary: session, status, unread, titleOmitted }: Row, projectName?: string) => {
    const key = pinKey(hostId, session.id), pinned = pins.has(key), selected = current && p.page === 'thread' && session.id === p.activeId
    const actions = p.onSessionAction ? [
      { key: 'rename', label: 'Rename', icon: <SquarePen size={14} />, onSelect: () => p.onSessionAction?.(hostId, session.id, 'rename') },
      { key: 'pin', label: pinned ? 'Unpin' : 'Pin', icon: <Pin size={14} />, onSelect: () => p.onSessionAction?.(hostId, session.id, 'pin') },
      { key: 'export', label: 'Export Markdown', icon: <Download size={14} />, onSelect: () => p.onSessionAction?.(hostId, session.id, 'export') },
      { key: 'delete', label: 'Delete session…', icon: <Trash2 size={14} />, danger: true, onSelect: () => p.onSessionAction?.(hostId, session.id, 'delete') }
    ] : null
    return <div key={key} className={`session-row-wrap ${menu === key ? 'menu-open' : ''}`} onContextMenu={actions ? (event) => { event.preventDefault(); setMenu(key) } : undefined}>
      <button className={`session-row ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} title={projectName} onClick={() => p.onHostSession?.(hostId, session.id)}><span className="session-row-title">{titleOmitted ? t('Title not loaded') : session.title || t('Untitled session')}</span><span className="session-row-state">{status === 'waiting' ? t('Needs attention') : status === 'failed' ? t('Failed') : ['working', 'retrying', 'resyncing'].includes(status) ? t('Running') : ''}{unread && <span className="session-unread">{t('Unread')}</span>}</span><time dateTime={session.createdAt}>{updatedTime(session.createdAt, locale)}</time></button>
      {actions && <ActionMenu label={t('More actions for {name}', { name: titleOmitted ? t('Title not loaded') : session.title || t('Untitled session') })} icon={<MoreHorizontal size={15} />} triggerClassName="session-row-more" open={menu === key} onOpenChange={(open) => setMenu(open ? key : null)} items={actions} />}
    </div>
  }
  const pinnedRows = (p.projects ?? []).flatMap(project => byCreated(project.sessions.filter(row => pins.has(pinKey(project.connection.hostId, row.summary.id)))).map(row => ({ project, row })))
  const toggle = (path: string) => setCollapsed((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path])

  return <aside className="sidebar" aria-label={t('Workspace navigation')} inert={!p.visible}>
    <div className="sidebar-titlebar">
      <span className="sidebar-window-space" aria-hidden="true" />
      <IconButton label="Hide sidebar" shortcut={keyLabel(p.platform, SHORTCUTS.sidebar)} aria-keyshortcuts={ariaKeys(p.platform, SHORTCUTS.sidebar)} onClick={p.onHide}><PanelLeft size={17} /></IconButton>
      <IconButton label="Search & commands" shortcut={keyLabel(p.platform, SHORTCUTS.search)} aria-keyshortcuts={ariaKeys(p.platform, SHORTCUTS.search)} onClick={p.onSearch}><Search size={17} /></IconButton>
    </div>
    <div className="sidebar-identity"><ReiMark size={25} /><span>Rei</span><span className="sidebar-identity-caption">{t('Workspace')}</span></div>
    <div className="sidebar-actions">
      <button className="new-thread-button" onClick={p.onNewThread}><SquarePen size={17} />{t('New thread')}<kbd aria-hidden="true">{keyLabel(p.platform, SHORTCUTS.newSession)}</kbd></button>
      <button aria-current={p.page === 'automations' ? 'page' : undefined} className={p.page === 'automations' ? 'selected' : ''} onClick={() => p.onPage('automations')}><Clock3 size={17} />{t('Automations')}</button>
      <button aria-current={p.page === 'skills' ? 'page' : undefined} className={p.page === 'skills' ? 'selected' : ''} onClick={() => p.onPage('skills')}><Blocks size={17} />{t('Skills')}</button>
    </div>
    <div className="session-heading"><span>{t('Threads')}</span><IconButton label="Add project" onClick={p.onChooseProject}><Plus size={15} /></IconButton></div>
    <div className="project-list">
      {pinnedRows.length > 0 && <section className="project-group pinned-group"><div className="pinned-heading"><Pin size={13} /><span>{t('Pinned')}</span></div><nav className="session-list" aria-label={t('Pinned')}>{pinnedRows.map(({ project, row }) => sessionRow(project.connection.hostId, project.connection.hostId === p.activeHostId, row, label(project.connection.workspace ?? '')))}</nav></section>}
      {p.projects?.map(project => {
        const connection = project.connection, id = connection.hostId, current = id === p.activeHostId
        const expanded = !collapsed.includes(id), name = label(connection.workspace ?? '')
        return <section className="project-group" key={id} data-host-id={id}>
          <div className="project-heading-row"><button className="project-heading" title={connection.workspace ?? name} aria-label={t(current ? expanded ? 'Collapse project {name}' : 'Expand project {name}' : 'Open project {name}', { name })} aria-expanded={expanded} onClick={() => current ? toggle(id) : p.onHostProject?.(id)}><Folder size={15} /><span>{name}</span>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>{p.onCloseHost && <IconButton label={t('Close idle project {name}', { name })} disabled={connection.busy} onClick={() => p.onCloseHost?.(id)}><X size={13} /></IconButton>}</div>
          {expanded && <nav className="session-list" aria-label={t('Sessions')}>
            {DATE_GROUPS.map(group => {
              const rows = byCreated(project.sessions.filter(row => !pins.has(pinKey(id, row.summary.id)) && dateGroup(row.summary.createdAt) === group))
              return rows.length > 0 && <div key={group} className="session-date-group" role="group" aria-label={t(group)}><div className="session-date-label" aria-hidden="true">{t(group)}</div>{rows.map(row => sessionRow(id, current, row))}</div>
            })}
            {!project.sessions.length && <p className="sidebar-empty">{t(connection.status === 'ready' ? 'No threads yet. Start something new.' : 'Preparing your workspace…')}</p>}
          </nav>}
        </section>
      })}
      {(p.projects ? paths.filter(path => !p.projects?.some(project => project.connection.workspace === path)) : paths).map((path) => {
        const current = path === p.workspace
        const expanded = current && !collapsed.includes(path)
        const name = label(path)
        return <section className="project-group" key={path}>
          <button className="project-heading" title={path === p.scratchWorkspace ? t('Personal space') : path} aria-label={t(current ? expanded ? 'Collapse project {name}' : 'Expand project {name}' : 'Open project {name}', { name })} aria-expanded={current ? expanded : undefined} onClick={() => current ? toggle(path) : p.onProject(path)}>
            <Folder size={15} /><span>{name}</span>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          {expanded && <nav className="session-list" aria-label={t('Sessions')}>
            {p.sessions.map((session) => <button key={session.id} aria-current={p.page === 'thread' && session.id === p.activeId ? 'page' : undefined} className={`session-row ${p.page === 'thread' && session.id === p.activeId ? 'selected' : ''}`} onClick={() => p.onSession(session.id)}>
              {session.busy && <span className="session-dot running" aria-label={t('Running')} />}<span className="session-row-title">{session.title || t('Untitled session')}</span><time dateTime={session.createdAt}>{updatedTime(session.createdAt, locale)}</time>
            </button>)}
            {!p.sessions.length && <p className="sidebar-empty">{t(p.ready ? 'No threads yet. Start something new.' : 'Preparing your workspace…')}</p>}
          </nav>}
        </section>
      })}
      {!paths.length && !p.projects?.length && <p className="sidebar-empty">{t('Preparing your workspace…')}</p>}
      {Boolean(p.agentPages?.length) && <section className="agent-page-notices" aria-label={t('Agent pages')}>{p.agentPages?.map(page => <button key={page.key} onClick={page.open} aria-label={t('Open page from {name}', { name: page.name })}><span>{page.title}</span><small>{page.name}</small></button>)}</section>}
    </div>
    <div className="sidebar-bottom">
      <div className="sidebar-settings-row"><button onClick={p.onSettings}><Settings2 size={16} />{t('Settings')}</button><span className="sidebar-wordmark">bingo</span></div>
      <div className="connection-indicator" role="status"><span className={`connection-dot ${p.ready ? 'connected' : p.connecting ? 'connecting' : ''}`} aria-hidden="true" /><span>{t(p.ready ? 'Connected locally' : p.connecting ? 'Connecting…' : 'Not connected')}</span></div>
    </div>
  </aside>
}
