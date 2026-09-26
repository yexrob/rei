// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item, TurnStatus } from '../../../shared/rpc'
import { rustInitial } from '../state/fixtures'
import { createSessionProjection } from '../state/session'
import { Timeline } from './Timeline'

vi.mock('./Content', async (original) => ({
  ...await original<typeof import('./Content')>(),
  RichText: ({ text, final }: { text: string; final?: boolean }) => <div data-testid="markdown" data-final={String(final)}>{text}</div>
}))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function projection(status: Item['status'], kind: 'assistant' | 'reasoning' = 'assistant') {
  return createSessionProjection({ ...rustInitial, items: [{ id: 'reply', round: 0, startedAt: '2026-09-17T00:00:00Z', status, body: { kind, text: 'Hello' } }] })
}

const actions = { openLink: vi.fn(), runAction: vi.fn(), loadHistory: vi.fn(), loading: false }

describe('streaming transcript presentation', () => {
  it('keeps response actions out of the live tail until its turn ends', () => {
    const state = projection('completed')
    state.snapshot.items[0].turn = 'live'
    state.snapshot.turn = { id: 'live', origin: 'submit', startedAt: '2026-09-17T00:00:00Z' }
    const { rerender } = render(<Timeline projection={state} {...actions} />)
    expect(screen.queryByRole('button', { name: 'Copy response' })).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Working…')
    rerender(<Timeline projection={{ ...state, snapshot: { ...state.snapshot, turn: null } }} {...actions} />)
    expect(screen.getByRole('button', { name: 'Copy response' })).toBeTruthy()
  })

  it('labels deferred events and oversized history as incomplete instead of inventing a full message', () => {
    const previewReference = vi.fn(), saveReference = vi.fn()
    const state = createSessionProjection({ ...rustInitial, seq: 2, items: [] }, { before: null, hasMore: true, generation: 0 })
    state.unloaded = [{ session: rustInitial.summary.id, seq: 1, messageId: 'large-event', eventType: 'itemCompleted', item: 'large-item', generation: 0, stateUncertain: false, availability: { kind: 'available', token: 'event-token' }, totalBytes: 17_000_000, checksum: 'a6a4eddc16724d5c' }]
    state.unloadedHistory = [{ id: 'older-item', generation: 0, availability: { kind: 'unavailable', reason: 'pinBudgetExceeded' }, totalBytes: 100_000_000, checksum: 'a6a4eddc16724d5c' }]
    const { container, rerender } = render(<Timeline projection={state} {...actions} previewReference={previewReference} saveReference={saveReference} />)
    expect(container.querySelector('.unloaded-content')?.textContent).toContain('not loaded')
    expect(container.querySelector('.unloaded-content')?.textContent).toContain('Earlier history is not loaded.')
    expect(container.querySelector('.unloaded-content')?.textContent).toContain('large-item')
    expect(screen.getByRole('button', { name: 'Preview raw event large-item' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Preview raw item older-item' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save full raw JSON for older-item…' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save full raw JSON for large-item…' }))
    expect(saveReference).toHaveBeenCalledWith('event', 'large-event')
    expect(screen.getByRole('button', { name: 'Load earlier messages' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview raw event large-item' }))
    expect(previewReference).toHaveBeenCalledWith('event', 'large-event')
    expect(screen.queryByRole('button', { name: 'Copy response' })).toBeNull()
    rerender(<Timeline projection={{ ...state, rawPreview: { id: 'large-event', text: '{"session":"ses_1"', totalBytes: 17_000_000, nextOffset: 20 } }} {...actions} previewReference={previewReference} saveReference={saveReference} />)
    expect(container.querySelector('.unloaded-content')?.textContent).toContain('not loaded')
    expect(container.querySelector('.unloaded-preview')?.textContent).toContain('{"session":"ses_1"')
  })

  it('does not treat a progress event as a completed raw JSON export', () => {
    const state = createSessionProjection(rustInitial)
    state.unloadedHistory = [{ id: 'huge', generation: 0, totalBytes: 17_000_000, checksum: 'a6a4eddc16724d5c', availability: { kind: 'available', token: 'pin' } }]
    const cancelExport = vi.fn(), progress = { type: 'export-progress' as const, transferId: 'save-1', hostId: 'host', connectionId: 'epoch', session: rustInitial.summary.id, doneBytes: 17_000_000, totalBytes: 17_000_000, status: 'running' as const }
    const { rerender } = render(<Timeline projection={state} {...actions} exportProgress={progress} cancelExport={cancelExport} />)
    expect(screen.getByText('Saving raw JSON… 17000000/17000000 bytes')).toBeTruthy()
    expect(screen.queryByText('Full raw JSON was saved.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel save' }))
    expect(cancelExport).toHaveBeenCalledOnce()
    rerender(<Timeline projection={state} {...actions} exportProgress={{ ...progress, status: 'completed' }} cancelExport={cancelExport} />)
    expect(screen.getByText('Full raw JSON was saved.')).toBeTruthy()
  })

  it('exposes paged child IDs for deliberate direct opening without marking the tree complete', () => {
    const onSelectSession = vi.fn()
    const state = createSessionProjection(rustInitial)
    state.tree = { backfill: 'liveOnly', descendantsComplete: false }
    const { container } = render(<Timeline projection={state} {...actions} childIds={['child-1', 'child-2']} childScanComplete onSelectSession={onSelectSession} />)
    expect(container.querySelector('.unloaded-content')?.textContent).toContain('not loaded')
    fireEvent.click(screen.getByText('2 child sessions discovered; older branches may still be incomplete.'))
    fireEvent.click(screen.getByRole('button', { name: 'Open discovered child child-1' }))
    expect(onSelectSession).toHaveBeenCalledWith('child-1')
  })

  it('places processing immediately after the stream, not in a pinned footer', () => {
    const state = projection('running')
    state.snapshot.turn = { id: 'live', origin: 'submit', startedAt: '2026-09-17T00:00:00Z' }
    const { container, rerender } = render(<Timeline projection={state} {...actions} />)
    const stream = container.querySelector('.transcript')!
    expect(stream.getAttribute('data-working')).toBe('true')
    expect(stream.lastElementChild).toBe(screen.getByRole('status'))
    expect(stream.lastElementChild?.previousElementSibling?.textContent).toContain('Hello')
    rerender(<Timeline projection={{ ...state, snapshot: { ...state.snapshot, turn: null } }} {...actions} />)
    expect(container.querySelector('.live-working')).toBeNull()
  })

  it('follows asynchronous content growth only while the reader is following the stream', () => {
    let resize = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = () => callback([], this as unknown as ResizeObserver) }
      observe() {} disconnect() {}
    })
    const { container } = render(<Timeline projection={projection('running')} {...actions} />)
    const scroll = container.querySelector('.timeline') as HTMLDivElement
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 400 })
    act(resize)
    expect(scroll.scrollTop).toBe(1000)
    scroll.scrollTop = 120
    fireEvent.scroll(scroll)
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy()
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1600 })
    act(resize)
    expect(scroll.scrollTop).toBe(120)
  })

  it.each(['click', 'focus', 'pointerDown'] as const)('holds %s inspection through content growth until the reader explicitly jumps to latest', (interaction) => {
    let resize = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = () => callback([], this as unknown as ResizeObserver) }
      observe() {} disconnect() {}
    })
    const item: Item = { id: 'read', turn: 'live', startedAt: '2026-09-17T00:00:00Z', status: 'completed', body: { kind: 'toolCall', name: 'Read', callId: 'read', input: { file_path: '/work/note.txt' }, output: { parts: [{ type: 'text', text: '1 recorded text' }] } } }
    const state = createSessionProjection({ ...rustInitial, items: [item] })
    const { container, rerender } = render(<Timeline projection={state} {...actions} />)
    const scroll = container.querySelector('.timeline') as HTMLDivElement
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 400 })
    scroll.scrollTo = vi.fn((options?: ScrollToOptions | number, y?: number) => { scroll.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? 0 })
    scroll.scrollTop = 600
    fireEvent.scroll(scroll)
    fireEvent[interaction](screen.getByRole('button', { name: /^Show tool details: Read/ }))
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1400 })
    act(resize)
    expect(scroll.scrollTop).toBe(600)
    // Even a scroll event at the former bottom does not silently resume inspection.
    scroll.scrollTop = 1000
    fireEvent.scroll(scroll)
    rerender(<Timeline projection={{ ...state, snapshot: { ...state.snapshot, items: [...state.snapshot.items, { ...item, id: 'read-two' }] } }} {...actions} />)
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1800 })
    act(resize)
    expect(scroll.scrollTop).toBe(1000)
    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }))
    expect(scroll.scrollTo).toHaveBeenCalledWith({ top: 1800 })
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 2200 })
    act(resize)
    expect(scroll.scrollTop).toBe(2200)
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull()
  })

  it('keeps singleton tool inspection mounted when another call joins the same run', () => {
    const item: Item = { id: 'read', turn: 'live', startedAt: '2026-09-17T00:00:00Z', status: 'completed', body: { kind: 'toolCall', name: 'Read', callId: 'read', input: { file_path: '/work/note.txt' }, output: { parts: [{ type: 'text', text: '1 recorded text' }] } } }
    const state = createSessionProjection({ ...rustInitial, items: [item] })
    const { rerender } = render(<Timeline projection={state} {...actions} />)
    expect(screen.queryByRole('button', { name: /tool activity/ })).toBeNull()
    const toggle = screen.getByRole('button', { name: /^Show tool details: Read/ })
    fireEvent.click(toggle)
    const body = document.querySelector('.tool-card-body')
    rerender(<Timeline projection={{ ...state, snapshot: { ...state.snapshot, items: [item, { ...item, id: 'second' }] } }} {...actions} />)
    expect(document.querySelector('.tool-card-body')).toBe(body)
    expect(screen.getByRole('button', { name: /^Hide tool details: Read/ })).toBe(toggle)
    expect(screen.getByRole('button', { name: 'Hide tool activity' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('passes disconnection into tool runs without turning historical pending calls into success', () => {
    const state = createSessionProjection({ ...rustInitial, items: [{ id: 'pending', turn: 'live', startedAt: '2026-09-17T00:00:00Z', status: 'pending', body: { kind: 'toolCall', name: 'Read', callId: 'pending', input: { file_path: '/work/note.txt' } } }] })
    const { container, rerender } = render(<Timeline projection={state} {...actions} />)
    expect(container.querySelector('.tool-state-spin')).toBeTruthy()
    rerender(<Timeline projection={state} {...actions} connected={false} />)
    expect(screen.getByText('Disconnected')).toBeTruthy()
    expect(container.querySelector('.tool-state-spin')).toBeNull()
    expect(container.querySelector('.tool-card--pending')).toBeTruthy()
    expect(container.querySelector('.tool-activity')?.getAttribute('data-connected')).toBe('false')
  })

  it('keeps legacy shell expansion native without a decorative trailing chevron', () => {
    const state = createSessionProjection({ ...rustInitial, items: [{ id: 'shell', startedAt: '2026-09-17T00:00:00Z', status: 'completed', body: { kind: 'shell', command: 'echo hello', output: 'hello', cwd: '/work', exit: 0 } }] })
    const { container } = render(<Timeline projection={state} {...actions} />)
    expect(container.querySelector('details.tool-call > summary')).toBeTruthy()
    expect(container.querySelector('details.tool-call .disclosure')).toBeNull()
    expect(container.querySelector('details.tool-call > summary [data-icon="terminal"]')).toBeTruthy()
  })

  it.each(['kernel', 'contributor:tasks', 'contributor:experience:index', 'contributor:bingo.rooms', 'hook:beforeTurn'])('keeps %s context in the journal but out of the conversation', (surface) => {
    const state = createSessionProjection({ ...rustInitial, items: [{
      id: 'context', startedAt: '2026-09-17T00:00:00Z', status: 'completed',
      body: { kind: 'user', parts: [{ type: 'text', text: 'Internal room reading instructions.' }], origin: { surface } }
    }, ...projection('completed', 'reasoning').snapshot.items] })
    const journal = structuredClone(state.snapshot.items)
    const { container } = render(<Timeline projection={state} {...actions} />)
    expect(container.querySelector('.context-contribution')).toBeNull()
    expect(screen.queryByText('Context update')).toBeNull()
    expect(screen.queryByText('Internal room reading instructions.')).toBeNull()
    expect(container.querySelector('.user-message')).toBeNull()
    expect(screen.queryByText('You')).toBeNull()
    expect(screen.getByText('Thinking')).toBeTruthy()
    expect(state.snapshot.items).toEqual(journal)
  })

  it('identifies the active child response without labelling it as Bingo', () => {
    render(<Timeline projection={projection('completed')} assistantName="Reviewer" {...actions} />)
    expect(screen.getByText('Reviewer').className).toBe('sr-only')
    expect(screen.queryByText('Bingo')).toBeNull()
  })

  it('attributes delegated input to its signed origin rather than the person', () => {
    const state = createSessionProjection({ ...rustInitial, items: [{
      id: 'assignment', startedAt: '2026-09-17T00:00:00Z', status: 'completed',
      body: { kind: 'user', parts: [{ type: 'text', text: 'Check the edge cases.' }], origin: { surface: 'agent', principal: 'Planner' } }
    }] })
    const { container } = render(<Timeline projection={state} {...actions} />)
    expect(screen.getByText('From Planner')).toBeTruthy()
    expect(screen.queryByText('You')).toBeNull()
    expect(container.querySelector('.delegated-message')).toBeTruthy()
  })

  it.each(['assistant', 'reasoning'] as const)('uses actual %s item status to finish Markdown', (kind) => {
    const { rerender } = render(<Timeline projection={projection('running', kind)} {...actions} />)
    expect(screen.getByTestId('markdown').getAttribute('data-final')).toBe('false')
    for (const status of ['pending', 'completed', 'interrupted', 'failed'] as const) {
      rerender(<Timeline projection={projection(status, kind)} {...actions} />)
      expect(screen.getByTestId('markdown').getAttribute('data-final')).toBe(String(status !== 'pending'))
    }
  })

  it.each([
    { status: { kind: 'failed', error: { code: 'PROVIDER_UNAVAILABLE', message: 'Provider is unavailable.' } }, text: 'Provider is unavailable.' },
    { status: { kind: 'interrupted', reason: 'userCancel' }, text: 'Turn interrupted. Completed changes have not been undone.' }
  ] satisfies { status: TurnStatus; text: string }[])('shows a resumed $status.kind turn from its canonical completed record', ({ status, text }) => {
    const state = createSessionProjection({ ...rustInitial, turn: null, lastTurn: {
      id: 'finished', status, startedAt: '2026-09-17T00:00:00Z', endedAt: '2026-09-17T00:00:01Z'
    } })
    const { rerender } = render(<Timeline projection={state} {...actions} />)
    expect(screen.getByText(text)).toBeTruthy()
    rerender(<Timeline projection={{ ...state, snapshot: { ...state.snapshot, turn: {
      id: 'next', origin: 'submit', round: 0, startedAt: '2026-09-17T00:00:02Z'
    } } }} {...actions} />)
    expect(screen.queryByText(text)).toBeNull()
  })

  it('keeps author labels accessible without redundant visible badges', () => {
    const { container } = render(<Timeline projection={projection('completed')} {...actions} />)
    expect(screen.getByText('Bingo').className).toBe('sr-only')
    expect(container.querySelector('.message-label, .bingo-mark')).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy response' })).toBeTruthy()
  })
})
