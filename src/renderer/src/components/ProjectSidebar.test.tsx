// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { byUpdated, dateGroup, pinKey, ProjectSidebar, projectPaths } from './ProjectSidebar'
import { rustInitial } from '../state/fixtures'
import { hostA, hostB } from '../../../shared/desktop.fixtures'

afterEach(cleanup)

const props = () => ({
  visible: true, platform: 'linux', page: 'thread' as const, workspace: '/projects/bingo', scratchWorkspace: '/scratch',
  recentWorkspaces: ['/projects/site', '/projects/bingo'], sessions: [{ ...rustInitial.summary, id: 'search', cwd: '/projects/bingo', title: 'Add session search' }],
  activeId: 'search', ready: true, connecting: false, loading: false,
  onHide: vi.fn(), onSearch: vi.fn(), onNewThread: vi.fn(), onPage: vi.fn(), onChooseProject: vi.fn(), onProject: vi.fn(), onSession: vi.fn(), onSettings: vi.fn()
})

describe('project navigation', () => {
  it('keeps the current workspace first without duplicates or scratch aliases', () => {
    expect(projectPaths('/projects/bingo', '/scratch', ['/projects/site', '/projects/bingo', '/scratch', '/projects/site'])).toEqual(['/projects/bingo', '/projects/site'])
  })

  it('routes capabilities independently from project threads', () => {
    const p = props(); render(<ProjectSidebar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Automations' }))
    expect(p.onPage).toHaveBeenCalledWith('automations')
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }))
    expect(p.onPage).toHaveBeenCalledWith('skills')
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }))
    expect(p.onNewThread).toHaveBeenCalledOnce()
  })

  it('shows authoritative current-workspace threads and switches other projects explicitly', () => {
    const p = props(); render(<ProjectSidebar {...p} />)
    const thread = within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button', { name: /Add session search/ })
    expect(thread.getAttribute('aria-current')).toBe('page')
    fireEvent.click(thread)
    expect(p.onSession).toHaveBeenCalledWith('search')
    fireEvent.click(screen.getByRole('button', { name: 'Open project site' }))
    expect(p.onProject).toHaveBeenCalledWith('/projects/site')
  })

  it('omits project-level status chrome while retaining session statuses on expansion', () => {
    const a = { summary: { ...rustInitial.summary, id: 'session-a', cwd: hostA.workspace!, title: 'A background task' }, status: 'failed', unread: true }
    const waiting = { summary: { ...rustInitial.summary, id: 'session-waiting', cwd: hostA.workspace!, title: 'A pending task' }, status: 'waiting', unread: false }
    const working = { summary: { ...rustInitial.summary, id: 'session-working', cwd: hostA.workspace!, title: 'A running task' }, status: 'working', unread: false }
    const b = { summary: { ...rustInitial.summary, id: 'session-b', cwd: hostB.workspace!, title: 'B foreground task' }, status: 'ready', unread: false }
    const projects = [{ connection: { ...hostA, status: 'failed' as const }, error: 'A runtime error', sessions: [a, waiting, working] }, { connection: hostB, sessions: [b] }]
    const p = { ...props(), projects, activeHostId: hostA.hostId, workspace: hostA.workspace, onCloseHost: vi.fn(), onHostSession: vi.fn() }
    const view = render(<ProjectSidebar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse project project-a' }))
    view.rerender(<ProjectSidebar {...p} activeHostId={hostB.hostId} workspace={hostB.workspace} />)
    const projectA = document.querySelector(`[data-host-id="${hostA.hostId}"]`) as HTMLElement
    expect(within(projectA).queryByRole('button', { name: /A background task/ })).toBeNull()
    expect(projectA.querySelector('.project-status')).toBeNull()
    expect(within(projectA).queryByText('Connection failed')).toBeNull()
    expect(within(projectA).getByRole('button', { name: 'Open project project-a' })).toBeTruthy()
    expect(within(projectA).getByRole('button', { name: 'Close idle project project-a' })).toBeTruthy()
    view.rerender(<ProjectSidebar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand project project-a' }))
    const failed = within(projectA).getByRole('button', { name: /A background task/ })
    expect(within(failed).getByText('Failed')).toBeTruthy()
    expect(within(failed).getByText('Unread')).toBeTruthy()
    expect(within(within(projectA).getByRole('button', { name: /A pending task/ })).getByText('Needs attention')).toBeTruthy()
    expect(within(within(projectA).getByRole('button', { name: /A running task/ })).getByText('Running')).toBeTruthy()
    expect(projectA.querySelector('.project-status')).toBeNull()
    fireEvent.click(failed)
    expect(p.onHostSession).toHaveBeenCalledWith(hostA.hostId, 'session-a')
  })

  it('identifies a bounded missing title without pretending the session is untitled', () => {
    const p = { ...props(), projects: [{ connection: hostA, sessions: [{ summary: { ...rustInitial.summary, id: 'large-title', cwd: hostA.workspace!, title: undefined }, status: 'ready', unread: false, titleOmitted: true }] }], activeHostId: hostA.hostId, workspace: hostA.workspace }
    render(<ProjectSidebar {...p} />)
    expect(screen.getByRole('button', { name: /Title not loaded/ })).toBeTruthy()
    expect(screen.queryByText('Untitled session')).toBeNull()
  })

  it('collapses the active project without losing its thread selection', () => {
    render(<ProjectSidebar {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse project bingo' }))
    expect(screen.queryByRole('navigation', { name: 'Sessions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand project bingo' }))
    expect(screen.getByRole('button', { name: /Add session search/ }).getAttribute('aria-current')).toBe('page')
  })

  it('groups by local date and sorts by last update', () => {
    const now = new Date(2026, 9, 3, 15, 0)
    expect(dateGroup(new Date(2026, 9, 3, 1).toISOString(), now)).toBe('Today')
    expect(dateGroup(new Date(2026, 9, 2, 23).toISOString(), now)).toBe('Yesterday')
    expect(dateGroup(new Date(2026, 8, 28).toISOString(), now)).toBe('Previous 7 days')
    expect(dateGroup(new Date(2026, 8, 1).toISOString(), now)).toBe('Older')
    expect(dateGroup('not a date', now)).toBe('Older')
    const row = (id: string, updatedAt: string) => ({ summary: { ...rustInitial.summary, id, updatedAt } })
    expect(byUpdated([row('a', '2026-09-01T00:00:00Z'), row('b', '2026-09-03T00:00:00Z'), row('c', '2026-09-02T00:00:00Z')]).map(item => item.summary.id)).toEqual(['b', 'c', 'a'])
  })

  it('pins sessions into a Pinned section and offers row actions from a menu or right-click', async () => {
    const today = new Date().toISOString()
    const rows = [
      { summary: { ...rustInitial.summary, id: 'one', cwd: hostA.workspace!, title: 'Pinned work', updatedAt: today }, status: 'ready', unread: false },
      { summary: { ...rustInitial.summary, id: 'two', cwd: hostA.workspace!, title: 'Old work', updatedAt: '2020-01-01T00:00:00Z' }, status: 'ready', unread: false }
    ]
    const onSessionAction = vi.fn()
    render(<ProjectSidebar {...props()} projects={[{ connection: hostA, sessions: rows }]} activeHostId={hostA.hostId} workspace={hostA.workspace} onHostSession={vi.fn()} pinned={[pinKey(hostA.hostId, 'one')]} onSessionAction={onSessionAction} />)
    const pinned = screen.getByRole('navigation', { name: 'Pinned' })
    expect(within(pinned).getByRole('button', { name: /^Pinned work/ })).toBeTruthy()
    const sessions = screen.getByRole('navigation', { name: 'Sessions' })
    expect(within(sessions).queryByRole('button', { name: /^Pinned work/ })).toBeNull()
    expect(within(sessions).getByRole('group', { name: 'Older' })).toBeTruthy()
    fireEvent.contextMenu(within(sessions).getByRole('button', { name: /^Old work/ }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Rename', 'Pin', 'Export Markdown', 'Delete session…'])
    act(() => { fireEvent.click(within(menu).getByRole('menuitem', { name: 'Pin' })) })
    await waitFor(() => expect(onSessionAction).toHaveBeenCalledWith(hostA.hostId, 'two', 'pin'))
    const more = within(pinned).getByRole('button', { name: 'More actions for Pinned work' })
    act(() => more.focus()); fireEvent.keyDown(more, { key: 'Enter' })
    expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Unpin' })).toBeTruthy()
  })
})
