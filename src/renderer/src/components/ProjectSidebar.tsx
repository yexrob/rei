import { useState } from 'react'
import { Blocks, ChevronDown, ChevronRight, Clock3, Folder, PanelLeft, Plus, ReiMark, Search, Settings2, SquarePen, X } from './icons'
import type { SessionSummary } from '../../../shared/rpc'
import type { ConnectionState } from '../../../shared/desktop'
import { useI18n } from '../i18n'
import { basename, IconButton } from './primitives'

export type WorkspacePage = 'thread' | 'automations' | 'skills'

export function projectPaths(workspace: string | null, scratch: string | undefined, recent: string[]): string[] {
  return [...new Set([...(workspace ? [workspace] : []), ...recent.filter((path) => path !== scratch)])]
}

function updatedTime(value: string, locale: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value))
  if (!Number.isFinite(elapsed)) return ''
  const minutes = Math.floor(elapsed / 60000)
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' })
  if (minutes < 60) return format.format(-minutes, 'minute')
  if (minutes < 1440) return format.format(-Math.floor(minutes / 60), 'hour')
  return format.format(-Math.floor(minutes / 1440), 'day')
}

export type SidebarProject = { connection: ConnectionState; sessions: { summary: SessionSummary; status: string; unread: boolean; titleOmitted?: boolean }[] }
type Props = {
  projects?: SidebarProject[]; activeHostId?: string; onHostProject?: (hostId: string) => void; onHostSession?: (hostId: string, sessionId: string) => void; onCloseHost?: (hostId: string) => void;
  agentPages?: { key: string; name: string; title: string; open: () => void }[];
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
  const toggle = (path: string) => setCollapsed((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path])

  return <aside className="sidebar" aria-label={t('Workspace navigation')} inert={!p.visible}>
    <div className="sidebar-titlebar">
      <span className="sidebar-window-space" aria-hidden="true" />
      <IconButton label="Hide sidebar" onClick={p.onHide}><PanelLeft size={17} /></IconButton>
      <IconButton label="Search & commands" onClick={p.onSearch}><Search size={17} /></IconButton>
    </div>
    <div className="sidebar-identity"><ReiMark size={25} /><span>Rei</span><span className="sidebar-identity-caption">{t('Workspace')}</span></div>
    <div className="sidebar-actions">
      <button className="new-thread-button" onClick={p.onNewThread}><SquarePen size={17} />{t('New thread')}<kbd aria-hidden="true">{p.platform === 'darwin' ? '⌘N' : 'Ctrl N'}</kbd></button>
      <button aria-current={p.page === 'automations' ? 'page' : undefined} className={p.page === 'automations' ? 'selected' : ''} onClick={() => p.onPage('automations')}><Clock3 size={17} />{t('Automations')}</button>
      <button aria-current={p.page === 'skills' ? 'page' : undefined} className={p.page === 'skills' ? 'selected' : ''} onClick={() => p.onPage('skills')}><Blocks size={17} />{t('Skills')}</button>
    </div>
    <div className="session-heading"><span>{t('Threads')}</span><IconButton label="Add project" onClick={p.onChooseProject}><Plus size={15} /></IconButton></div>
    <div className="project-list">
      {p.projects?.map(project => {
        const connection = project.connection, id = connection.hostId, current = id === p.activeHostId
        const expanded = !collapsed.includes(id), name = label(connection.workspace ?? '')
        return <section className="project-group" key={id} data-host-id={id}>
          <div className="project-heading-row"><button className="project-heading" title={connection.workspace ?? name} aria-label={t(current ? expanded ? 'Collapse project {name}' : 'Expand project {name}' : 'Open project {name}', { name })} aria-expanded={expanded} onClick={() => current ? toggle(id) : p.onHostProject?.(id)}><Folder size={15} /><span>{name}</span>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>{p.onCloseHost && <IconButton label={t('Close idle project {name}', { name })} disabled={connection.busy} onClick={() => p.onCloseHost?.(id)}><X size={13} /></IconButton>}</div>
          {expanded && <nav className="session-list" aria-label={t('Sessions')}>
            {project.sessions.map(({ summary: session, status, unread, titleOmitted }) => <button key={session.id} className={`session-row ${current && p.page === 'thread' && session.id === p.activeId ? 'selected' : ''}`} aria-current={current && p.page === 'thread' && session.id === p.activeId ? 'page' : undefined} onClick={() => p.onHostSession?.(id, session.id)}><span className="session-row-title">{titleOmitted ? t('Title not loaded') : session.title || t('Untitled session')}</span><span className="session-row-state">{status === 'waiting' ? t('Needs attention') : status === 'failed' ? t('Failed') : ['working', 'retrying', 'resyncing'].includes(status) ? t('Running') : ''}{unread && <span className="session-unread">{t('Unread')}</span>}</span><time dateTime={session.updatedAt}>{updatedTime(session.updatedAt, locale)}</time></button>)}
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
              {session.busy && <span className="session-dot running" aria-label={t('Running')} />}<span className="session-row-title">{session.title || t('Untitled session')}</span><time dateTime={session.updatedAt}>{updatedTime(session.updatedAt, locale)}</time>
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
