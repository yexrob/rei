// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item, Origin, SessionSummary } from '../../../shared/rpc'
import { rustInitial } from '../state/fixtures'
import { createSessionProjection } from '../state/session'
import { RoomConversation } from './RoomConversation'

vi.mock('./Content', async (original) => ({
  ...await original<typeof import('./Content')>(),
  RichText: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>
}))
afterEach(cleanup)

const root: SessionSummary = { ...rustInitial.summary, id: 'root', title: 'Project conversation' }
const planner: SessionSummary = { ...root, id: 'planner', title: 'Planner', parent: { session: 'root' }, key: 'agent/root/Planner' }
const room: SessionSummary = { ...root, id: 'room', title: '#review', driver: 'log', key: 'rooms/root/review', parent: { session: 'root' } }
function post(id: string, origin: Origin, text: string): Item {
  return { id, startedAt: '2026-09-17T10:42:00Z', status: 'completed', body: { kind: 'user', origin, parts: [{ type: 'text', text }] } }
}
function projection(items: Item[] = []) {
  return createSessionProjection({ ...rustInitial, summary: room, items, extensions: { 'bingo.rooms': {
    opened: { purpose: 'Coordinate the review', by: 'parent' }, members: { members: ['parent', 'Planner', 'Missing'] }
  } } })
}
const actions = { onSelectAgent: vi.fn(), openLink: vi.fn(), runAction: vi.fn(), loadHistory: vi.fn(), loading: false }

describe('room journal presentation', () => {
  it('renders journal order and origin attribution, never names parsed out of post text', () => {
    const items = [post('human', { surface: 'desktop' }, 'Planner: not the author'), post('agent', { surface: 'agent', principal: 'Planner' }, 'Plan ready'), post('unknown', { surface: 'unrecognized' }, 'Unknown source'), post('room-note', { surface: 'room', principal: 'parent' }, 'Members changed')]
    const { container } = render(<RoomConversation projection={projection(items)} sessions={[root, planner, room]} {...actions} />)
    const posts = [...container.querySelectorAll('.room-post')]
    expect(posts.map((node) => node.getAttribute('data-item-id'))).toEqual(['human', 'agent', 'unknown', 'room-note'])
    expect(within(posts[0] as HTMLElement).getByText('You')).toBeTruthy()
    expect(within(posts[1] as HTMLElement).getByText('Planner', { selector: '.room-author' })).toBeTruthy()
    expect(within(posts[2] as HTMLElement).getByText('Unknown author')).toBeTruthy()
    expect(within(posts[3] as HTMLElement).getByText('parent', { selector: '.room-author' })).toBeTruthy()
    expect(container.querySelector('.user-message')).toBeNull()
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2026-09-17T10:42:00.000Z')
  })

  it('keeps missing members visible and maps parent to the room holder, not arbitrary title matches', () => {
    const wrong = { ...planner, id: 'wrong-tree', parent: { session: 'another-root' } }
    render(<RoomConversation projection={projection()} sessions={[wrong, root, planner, room]} {...actions} />)
    const pane = screen.getByRole('complementary', { name: 'Room details' })
    expect(within(pane).getByText('Coordinate the review')).toBeTruthy()
    fireEvent.click(within(pane).getByRole('button', { name: /parent/ }))
    expect(actions.onSelectAgent).toHaveBeenLastCalledWith('root')
    fireEvent.click(within(pane).getByRole('button', { name: /Planner/ }))
    expect(actions.onSelectAgent).toHaveBeenLastCalledWith('planner')
    expect(within(pane).getByRole('button', { name: /Missing/ }).hasAttribute('disabled')).toBe(true)
    expect(within(pane).getByText('Unavailable')).toBeTruthy()
  })

  it('retains non-message journal items, handles invalid dates and preserves history paging', () => {
    const state = projection([{ ...post('bad-date', { surface: 'agent', principal: 'Planner' }, 'Timestamp unavailable'), startedAt: 'not-a-date' }, { id: 'notice', startedAt: '2026-09-17T10:43:00Z', status: 'completed', body: { kind: 'notice', level: 'info', code: 'ROOM_NOTE', text: 'Room closed by parent' } }])
    render(<RoomConversation projection={{ ...state, history: { ...state.history, complete: false } }} sessions={[root, room]} {...actions} />)
    expect(screen.getByText('Unknown time')).toBeTruthy()
    expect(screen.getByText('Room closed by parent')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }))
    expect(actions.loadHistory).toHaveBeenCalled()
  })

  it('does not call a bounded empty room complete while an older oversized item remains unread', () => {
    const state = projection()
    state.history = { before: undefined, complete: false }
    state.unloadedHistory = [{ id: 'room-huge', generation: 0, totalBytes: 17_000_000, checksum: 'a6a4eddc16724d5c', availability: { kind: 'unavailable', reason: 'pinBudgetExceeded' } }]
    const { container } = render(<RoomConversation projection={state} sessions={[root, room]} {...actions} />)
    expect(screen.queryByText('No messages yet')).toBeNull()
    expect(screen.getByRole('button', { name: 'Load earlier messages' })).toBeTruthy()
    expect(container.querySelector('.unloaded-history-item')?.textContent).toContain('room-huge')
    expect(container.querySelector('.unloaded-content')?.textContent).toContain('pinBudgetExceeded')
  })

  it('renders supported local images and no remote image URLs', () => {
    const item = post('picture', { surface: 'desktop' }, 'Image attached')
    if (item.body.kind === 'user') item.body.parts.push({ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' }, { type: 'image', mediaType: 'image/svg+xml', data: 'unsafe' })
    render(<RoomConversation projection={projection([item])} sessions={[root, room]} {...actions} />)
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=')
  })

  it('collapses room context and displays canonical closed metadata', () => {
    const state = projection()
    state.snapshot.extensions!['bingo.rooms'] = { ...state.snapshot.extensions!['bingo.rooms'] as object, closed: { by: 'parent' } }
    render(<RoomConversation projection={state} sessions={[root, room]} {...actions} />)
    expect(screen.getByText('Closed')).toBeTruthy()
    const toggle = screen.getByRole('button', { name: 'Room details' })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})
