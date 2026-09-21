// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Collaborator } from '../state/collaboration'
import { CollaborationDock } from './CollaborationDock'
import { CollaborationAvatar } from './CollaborationAvatar'

const entries: Collaborator[] = [
  { id: 'root', kind: 'agent', name: 'Bingo', main: true, status: 'working', activity: { kind: 'tool', text: 'Edit', detail: 'src/search.rs' } },
  { id: 'planner', kind: 'agent', name: 'Planner', main: false, status: 'ready', activity: { kind: 'message', text: 'Plan ready.' } },
  { id: 'reviewer', kind: 'agent', name: 'Reviewer', main: false, status: 'failed', activity: { kind: 'tool', text: 'Bash', detail: 'cargo test' } },
  { id: 'room', kind: 'room', name: 'search-review', main: false, status: 'closed', activity: null }
]
const select = vi.fn()
function dock(data = entries) { return render(<CollaborationDock entries={data} activeId="root" onSelect={select} />) }
function advance(ms: number) { act(() => vi.advanceTimersByTime(ms)) }

beforeEach(() => { vi.useFakeTimers(); select.mockClear() })
afterEach(() => { cleanup(); vi.useRealTimers() })

it('opens after 120ms and keeps the stack, gap, and rows in one delayed-close region', () => {
  const { container } = dock()
  const region = container.querySelector('.collaboration-dock')!
  fireEvent.pointerEnter(region)
  advance(119)
  expect(screen.queryByRole('navigation', { name: 'Collaborators' })).toBeNull()
  advance(1)
  const panel = screen.getByRole('navigation', { name: 'Collaborators' })
  fireEvent.pointerLeave(region)
  advance(249)
  expect(panel.isConnected).toBe(true)
  fireEvent.pointerEnter(panel)
  advance(1)
  expect(panel.isConnected).toBe(true)
  fireEvent.pointerLeave(region)
  advance(250)
  expect(screen.queryByRole('navigation', { name: 'Collaborators' })).toBeNull()
})

it('supports keyboard focus, Escape focus return, and touch/click toggle', () => {
  dock()
  const trigger = screen.getByRole('button', { name: 'Collaborators' })
  act(() => trigger.focus())
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  const first = screen.getByRole('button', { name: 'Bingo · Main · Working' })
  act(() => first.focus())
  fireEvent.keyDown(first, { key: 'Escape' })
  expect(document.activeElement).toBe(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

it('keeps keyboard focus inside the list through pointer leave and closes after focus leaves', () => {
  const { container } = dock()
  const trigger = screen.getByRole('button', { name: 'Collaborators' })
  act(() => trigger.focus())
  const reviewer = screen.getByRole('button', { name: 'Reviewer · Agent · Failed' })
  act(() => reviewer.focus())
  fireEvent.pointerLeave(container.querySelector('.collaboration-dock')!)
  advance(250)
  expect(screen.getByRole('navigation')).toBeTruthy()
  act(() => reviewer.blur())
  advance(250)
  expect(screen.queryByRole('navigation')).toBeNull()
})

it('cancels hover intent when leaving early and clears pending timers on unmount', () => {
  const view = dock()
  const region = view.container.querySelector('.collaboration-dock')!
  fireEvent.pointerEnter(region)
  advance(100)
  fireEvent.pointerLeave(region)
  advance(120)
  expect(screen.queryByRole('navigation')).toBeNull()
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('routes full rows by session id including closed rooms without mutable activity in accessible names', () => {
  dock()
  fireEvent.click(screen.getByRole('button', { name: 'Collaborators' }))
  const root = screen.getByRole('button', { name: 'Bingo · Main · Working' })
  expect(root.getAttribute('aria-current')).toBe('page')
  expect(within(root).getByText('Edit')).toBeTruthy()
  expect(within(root).getByText('src/search.rs')).toBeTruthy()
  const reviewer = screen.getByRole('button', { name: 'Reviewer · Agent · Failed' })
  expect(reviewer.getAttribute('aria-current')).toBeNull()
  fireEvent.click(reviewer)
  expect(select).toHaveBeenLastCalledWith('reviewer')
  fireEvent.click(screen.getByRole('button', { name: 'Collaborators' }))
  fireEvent.click(screen.getByRole('button', { name: 'search-review · Room · Closed' }))
  expect(select).toHaveBeenLastCalledWith('room')
})

it('opens the separate collapsed room button directly and retains other rooms in the roster', () => {
  const { container } = dock([...entries, { ...entries[3], id: 'second-room', name: 'planning' }])
  const room = screen.getByRole('button', { name: 'Open room search-review' })
  expect(room.parentElement).toBe(screen.getByRole('button', { name: 'Collaborators' }).parentElement)
  expect(container.querySelector('button button')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Open room planning' })).toBeNull()
  fireEvent.click(room)
  expect(select).toHaveBeenCalledWith('room')
  expect(screen.queryByRole('navigation')).toBeNull()
  act(() => room.focus())
  expect(screen.getByRole('navigation')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'planning · Room · Closed' }))
  expect(select).toHaveBeenLastCalledWith('second-room')
})

it('updates journal text in place without replacing or reordering rows or adding live announcements', () => {
  const view = dock()
  fireEvent.click(screen.getByRole('button', { name: 'Collaborators' }))
  const rows = within(screen.getByRole('navigation')).getAllByRole('button')
  view.rerender(<CollaborationDock entries={entries.map((entry) => entry.id === 'reviewer' ? { ...entry, activity: { kind: 'message', text: 'New streaming text'.repeat(100) } } : entry)} activeId="root" onSelect={select} />)
  const updated = within(screen.getByRole('navigation')).getAllByRole('button')
  expect(updated).toEqual(rows)
  expect(updated.map((row) => row.dataset.sessionId)).toEqual(entries.map((entry) => entry.id))
  expect(view.container.querySelector('[aria-live]')).toBeNull()
})

it('presents the main agent as Bingo while retaining its canonical thread title in a tooltip', () => {
  const data = entries.map((entry) => entry.main ? { ...entry, name: 'Add search to the session picker' } : entry)
  dock(data)
  expect(within(screen.getByRole('button', { name: 'Collaborators' })).getByText('B')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Collaborators' }))
  const root = screen.getByRole('button', { name: 'Bingo · Main · Working' })
  expect(within(root).getByText('Bingo').getAttribute('title')).toBe('Add search to the session picker')
  expect(within(root).getByText('B')).toBeTruthy()
  expect(data[0].name).toBe('Add search to the session picker')
})

it('keeps every entry reachable while limiting the collapsed avatar preview', () => {
  const many = Array.from({ length: 20 }, (_, index): Collaborator => ({ ...entries[1], id: `agent-${index}`, name: `Agent ${index}` }))
  const { container } = dock(many)
  expect(container.querySelectorAll('.collaboration-stack .collaboration-avatar').length).toBeLessThan(many.length)
  fireEvent.click(screen.getByRole('button', { name: 'Collaborators' }))
  expect(within(screen.getByRole('navigation')).getAllByRole('button')).toHaveLength(20)
  fireEvent.click(screen.getByRole('button', { name: 'Agent 19 · Agent · Ready' }))
  expect(select).toHaveBeenCalledWith('agent-19')
})

it('closes on outside press and disables selection when requested', () => {
  const view = dock()
  fireEvent.click(screen.getByRole('button', { name: 'Collaborators' }))
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('navigation')).toBeNull()
  view.rerender(<CollaborationDock entries={entries} activeId="root" onSelect={select} disabled />)
  expect(screen.getByRole('button', { name: 'Collaborators' }).hasAttribute('disabled')).toBe(true)
  expect(select).not.toHaveBeenCalled()
})

it('uses decorative initials and a separate square room avatar without external assets', () => {
  const { container } = render(<><CollaborationAvatar name="审查" /><CollaborationAvatar name="review" kind="room" /><CollaborationAvatar name=" " /></>)
  expect(screen.getByText('审')).toBeTruthy()
  expect(screen.getByText('#').classList.contains('collaboration-avatar-room')).toBe(true)
  expect(screen.getByText('?')).toBeTruthy()
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3)
})
