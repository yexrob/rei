// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectSidebar, projectPaths } from './ProjectSidebar'
import { rustInitial } from '../state/fixtures'

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

  it('collapses the active project without losing its thread selection', () => {
    render(<ProjectSidebar {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse project bingo' }))
    expect(screen.queryByRole('navigation', { name: 'Sessions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand project bingo' }))
    expect(screen.getByRole('button', { name: /Add session search/ }).getAttribute('aria-current')).toBe('page')
  })
})
