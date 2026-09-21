// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BingoPanelsApi, PanelsEvent, TerminalState } from '../../../shared/panels'
import { TerminalPanel } from './TerminalPanel'

vi.mock('./terminal/terminal-view', () => ({ createTerminalView: vi.fn(() => ({ write: vi.fn(), activate: vi.fn(), focus: vi.fn(), dispose: vi.fn() })) }))
const shell = (id: string): TerminalState => ({ id, status: 'running', cwd: '/workspace', error: null, exitCode: null })
const browser = { url: '', title: '', canGoBack: false, canGoForward: false, loading: false, error: null }
function install(states: TerminalState[]) {
  let emit: (event: PanelsEvent) => void = () => {}
  const api = {
    snapshot: vi.fn(async () => ({ ok: true as const, value: { browser, terminals: states } })),
    onEvent: vi.fn((listener: typeof emit) => { emit = listener; return vi.fn() }),
    terminalStart: vi.fn(async () => { states = [...states, shell('new')]; emit({ type: 'terminals', states }); return { ok: true as const, value: shell('new') } }),
    terminalStop: vi.fn(async (id: string) => { states = states.filter((state) => state.id !== id); emit({ type: 'terminals', states }); return { ok: true as const, value: undefined } }),
    terminalResize: vi.fn(), terminalWrite: vi.fn(), terminalAck: vi.fn()
  }
  window.bingoPanels = api as unknown as BingoPanelsApi
  return { api, emit: (event: PanelsEvent) => emit(event) }
}
afterEach(() => { cleanup(); vi.clearAllMocks(); Reflect.deleteProperty(window, 'bingoPanels') })

it('renders real tabs, creates a second terminal and closes only its own tab', async () => {
  const { api } = install([shell('a')])
  const onClose = vi.fn()
  render(<TerminalPanel visible onClose={onClose} />)
  expect(await screen.findByRole('tab', { name: 'Terminal 1' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
  expect(await screen.findByRole('tab', { name: 'Terminal 2' })).toBeTruthy()
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Terminal 2' }).getAttribute('aria-selected')).toBe('true'))
  fireEvent.click(screen.getByRole('button', { name: 'Close terminal 2' }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'Terminal 2' })).toBeNull())
  expect(api.terminalStop).toHaveBeenCalledExactlyOnceWith('new')
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Close terminal 1' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})

it('keeps native terminals while hidden, and last shell exit does not respawn until reopening', async () => {
  const { api, emit } = install([shell('a')])
  const onClose = vi.fn()
  const view = render(<TerminalPanel visible onClose={onClose} />)
  await screen.findByRole('tab', { name: 'Terminal 1' })
  fireEvent.click(screen.getByRole('button', { name: 'Hide terminal area' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(api.terminalStop).not.toHaveBeenCalled()
  view.rerender(<TerminalPanel visible={false} onClose={onClose} />)
  view.rerender(<TerminalPanel visible onClose={onClose} />)
  expect(api.terminalStart).not.toHaveBeenCalled()
  act(() => emit({ type: 'terminals', states: [] }))
  expect(onClose).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('Terminal exited')).toBeNull()
  expect(api.terminalStart).not.toHaveBeenCalled()
  view.rerender(<TerminalPanel visible={false} onClose={onClose} />)
  view.rerender(<TerminalPanel visible onClose={onClose} />)
  await waitFor(() => expect(api.terminalStart).toHaveBeenCalledTimes(1))
  expect(api.onEvent).toHaveBeenCalledTimes(1)
})

it('supports roving keyboard tab selection and labels cwd as a tooltip', async () => {
  install([shell('a'), shell('b')])
  render(<TerminalPanel visible onClose={vi.fn()} />)
  const first = await screen.findByRole('tab', { name: 'Terminal 1' })
  expect(first.getAttribute('title')).toBe('/workspace')
  fireEvent.keyDown(first, { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: 'Terminal 2' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Terminal 2' }), { key: 'Home' })
  expect(first.getAttribute('aria-selected')).toBe('true')
})

it('shows failed launch recovery and retries only on explicit request', async () => {
  const { api } = install([])
  api.terminalStart.mockRejectedValue(new Error('Cannot start shell'))
  const onClose = vi.fn()
  render(<TerminalPanel visible onClose={onClose} />)
  expect((await screen.findByRole('alert')).textContent).toContain('Cannot start shell')
  expect(api.terminalStart).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(api.terminalStart).toHaveBeenCalledTimes(2))
  expect(onClose).not.toHaveBeenCalled()
})
