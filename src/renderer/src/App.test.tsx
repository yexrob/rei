// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BingoDesktopApi, BoundedDelivery, DesktopEvent, DesktopRequest, Result } from '../../shared/desktop'
import { hostA, hostB, multiHostBootstrap, restartedHostA } from '../../shared/desktop.fixtures'
import type { Event, RpcMethods, SessionState } from '../../shared/rpc'
import App from './App'
import { rustInitial } from './state/fixtures'
import { InteractionPanel } from './components/InteractionPanel'

const time = '2026-09-05T10:00:00Z'
function desktop({ welcome = false, reject = false } = {}) {
  let listener: (event: DesktopEvent) => void = () => {}
  let bounded: ((delivery: BoundedDelivery) => Promise<void>) | undefined
  const server = { protocol: 1, name: 'fixture', version: 'test', capabilities: { methods: ['session/listHeads', 'session/open', 'session/history', 'session/children', 'session/itemPart', 'session/fieldPart', 'session/eventPart'], notifications: ['eventRef', 'gateway/sessionHead'] } }
  let seq = 0
  let connectionId = 'connection'
  let preferences = { theme: 'light' as 'light' | 'dark' | 'system', workspace: welcome ? null : '/work', binaryPath: '/bin/bingo', recentWorkspaces: [] as string[] }
  const summary = { ...rustInitial.summary, id: 'session-one', title: 'Review the workspace', cwd: '/work', provider: 'custom', model: 'same-model', createdAt: time, updatedAt: time }
  const state: SessionState = { ...rustInitial, seq: 0, summary, items: [], config: { kernel: { thinking: 'xHigh' }, plugins: { 'bingo.permissions': { mode: 'plan' } } } }
  const emit = (event: Event) => listener({ type: 'rpc', connectionId, method: 'event', params: { session: summary.id, ts: time, seq: ++seq, event } })
  const api: BingoDesktopApi = {
    bootstrap: vi.fn(async () => ({ ok: true as const, value: { version: '0.1.0', platform: 'linux', scratchWorkspace: '/scratch', preferences, binary: { path: '/bin/bingo', source: 'test' }, connections: [], selection: null, agentPages: [] } })),
    connect: vi.fn(async ({ workspace = '/scratch' }) => ({ ok: true as const, value: { hostId: 'host', busy: false, status: 'ready' as const, connectionId: 'connection', workspace, binary: '/bin/bingo', server } })),
    reconnect: vi.fn(async () => { connectionId = 'connection-next'; return { ok: true as const, value: { hostId: 'host', busy: false, status: 'ready' as const, connectionId, workspace: '/work', binary: '/bin/bingo', server } } }),
    selectConversation: vi.fn(async () => ({ ok: true as const, value: undefined })),
    closeHost: vi.fn(async () => ({ ok: true as const, value: undefined })),
    openAgentPage: vi.fn(async () => ({ ok: true as const, value: undefined })),
    request: vi.fn(async (input: DesktopRequest) => {
      if (input.method === 'session/list') return { ok: true as const, value: { sessions: [summary] } }
      if (input.method === 'session/open') return { ok: true as const, value: { session: summary.id, snapshot: { ...state, seq } } }
      if (input.method === 'catalog/read') {
        const { kind } = input.params as RpcMethods['catalog/read']['params']
        return { ok: true as const, value: { kind, entries: kind === 'models' ? [{ id: 'other/same-model', label: 'same-model' }, { id: 'custom/same-model', label: 'same-model' }] : kind === 'commands' ? [{ id: 'status', label: 'Show runtime status' }] : kind === 'providers' ? [{ id: 'custom', label: 'custom', meta: { auth: { kind: 'ready' } } }] : [] } }
      }
      if (input.method === 'session/submit') {
        const { intent, input: payload } = input.params as RpcMethods['session/submit']['params']
        if (reject) emit({ type: 'intentAck', intent, outcome: { kind: 'rejected', error: { code: 'INVALID_INPUT', message: 'The runtime rejected this message.' } } })
        else if (payload.kind === 'text') {
          emit({ type: 'itemCompleted', item: { id: 'user-message', status: 'completed', startedAt: time, body: { kind: 'user', parts: [{ type: 'text', text: payload.text }], origin: { surface: 'desktop' } } } })
          emit({ type: 'intentAck', intent, outcome: { kind: 'turnStarted', turn: 'turn' } })
          emit({ type: 'itemCompleted', item: { id: 'assistant-message', status: 'completed', startedAt: time, body: { kind: 'assistant', text: '## Answer\n\nThe workspace is ready.' } } })
        } else emit({ type: 'intentAck', intent, outcome: { kind: 'applied', result: { view: { kind: 'text', text: 'Status from the runtime' } } } })
      }
      return { ok: true as const, value: {} }
    }) as BingoDesktopApi['request'],
    requestBounded: vi.fn(async ({ transferId, request: input }) => {
      if (!bounded) return { ok: false as const, error: { code: 'NO_CONSUMER', message: 'No bounded consumer.' } }
      const raw = input.method === 'session/listHeads' ? await (api.request as (input: DesktopRequest) => Promise<Result<unknown>>)({ connectionId: input.connectionId, method: 'session/list', params: { filter: { cwd: (input.params as RpcMethods['session/listHeads']['params']).filter?.cwd, limit: 500 } } }) : input.method === 'session/children' ? { ok: true as const, value: { children: [], next: null } } : await (api.request as (input: DesktopRequest) => Promise<Result<unknown>>)(input)
      if (!raw.ok) return raw
      const value = input.method === 'session/listHeads' ? { heads: (raw.value as RpcMethods['session/list']['result']).sessions.filter(summary => summary.cwd === (input.params as RpcMethods['session/listHeads']['params']).filter?.cwd).map(({ id, cwd, parent, driver, createdAt, updatedAt, busy, title }) => ({ id, cwd, parent, driver: driver ?? 'model', createdAt, updatedAt, busy: busy ?? false, title })).sort((a, b) => a.id.localeCompare(b.id)), next: null } : raw.value
      const session = input.method === 'session/open' ? (value as RpcMethods['session/open']['result']).session : input.method === 'session/history' ? (input.params as RpcMethods['session/history']['params']).session : input.method === 'session/children' ? (input.params as RpcMethods['session/children']['params']).parent : null
      const hostId = input.connectionId === 'epoch-a-other' ? 'host-a-other-binary' : input.connectionId.startsWith('epoch-a') ? hostA.hostId : input.connectionId.startsWith('epoch-b') ? hostB.hostId : 'host'
      await bounded({ kind: 'response', transferId, hostId, connectionId: input.connectionId, session, method: input.method, result: value } as BoundedDelivery)
      return { ok: true as const, value: { kind: 'response' as const, transferId, hostId, connectionId: input.connectionId, session, method: input.method, acceptedBytes: 512 } }
    }) as BingoDesktopApi['requestBounded'],
    cancelBounded: vi.fn(async () => ({ ok: true as const, value: undefined })),
    readPart: vi.fn(async () => ({ ok: false as const, error: { code: 'UNSUPPORTED', message: 'Part fixture not configured.' } })),
    cancelPart: vi.fn(async () => ({ ok: true as const, value: undefined })),
    exportReference: vi.fn(async () => ({ ok: true as const, value: false })), cancelExport: vi.fn(async () => ({ ok: true as const, value: undefined })),
    onBounded: vi.fn((next) => { bounded = next; return () => { bounded = undefined } }),
    onEvent: vi.fn((next) => { listener = next; return () => { listener = () => {} } }),
    chooseWorkspace: vi.fn(async () => ({ ok: true as const, value: '/work' })),
    chooseBinary: vi.fn(async () => ({ ok: true as const, value: '/bin/bingo' })),
    chooseImages: vi.fn(async () => ({ ok: true as const, value: [] })),
    savePreferences: vi.fn(async (patch) => { preferences = { ...preferences, ...patch }; return { ok: true as const, value: preferences } }),
    openExternal: vi.fn(async () => ({ ok: true as const, value: undefined })),
    exportText: vi.fn(async () => ({ ok: true as const, value: true })),
    deleteSession: vi.fn(async () => ({ ok: true as const, value: false })),
    configureProvider: vi.fn(async () => ({ ok: true as const, value: undefined }))
  }
  window.bingoDesktop = api
  return { api, emit, state, server, emitDesktop: (event: DesktopEvent) => listener(event) }
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn((query: string) => ({ matches: query.includes('prefers-reduced-motion'), addEventListener: vi.fn(), removeEventListener: vi.fn() })) })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function ready() { await screen.findByText('Connected locally'); await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true)) }

describe('desktop user journeys', () => {
  it('keeps sidebar rows in creation order when a thread is opened or updated', async () => {
    const { api, state, emit } = desktop()
    const oldest = { ...state.summary, createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z' }
    const newest = { ...state.summary, id: 'session-two', title: 'Newer thread', createdAt: time, updatedAt: time }
    const request = vi.mocked(api.request).getMockImplementation()!
    vi.mocked(api.request).mockImplementation(async (input) => {
      if (input.method === 'session/list') return { ok: true, value: { sessions: [newest, oldest] } }
      if (input.method === 'session/open') return { ok: true, value: { session: oldest.id, snapshot: { ...state, summary: { ...oldest, updatedAt: '2026-09-17T11:00:00Z' } } } }
      return request(input)
    })
    render(<App />); await ready()
    const rows = () => [...document.querySelectorAll('.session-row-title')].map((row) => row.textContent)
    const order = [newest.title, oldest.title]
    expect(rows()).toEqual(order)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button', { name: /^Review the workspace/ }))
    await screen.findByRole('heading', { name: 'Review the workspace' })
    // Opening refreshes the older thread's updatedAt; navigation must not jump under the pointer.
    expect(rows()).toEqual(order)
    await act(async () => emit({ type: 'sessionUpdated', summary: { ...oldest, updatedAt: '2026-09-17T12:00:00Z', busy: true } }))
    expect(rows()).toEqual(order)
    expect(document.querySelector('.session-row[aria-current="page"] .session-row-title')?.textContent).toBe(oldest.title)
  })

  it('starts in personal space without requiring a folder or creating an empty session', async () => {
    const { api } = desktop({ welcome: true }); render(<App />)
    await screen.findByText('Connected locally')
    expect(screen.queryByRole('heading', { name: "Let's build" })).toBeNull()
    expect(document.querySelector('.welcome-project, .empty-state')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Message bingo' }).closest('.empty-conversation')).toBeTruthy()
    expect(api.chooseWorkspace).not.toHaveBeenCalled()
    expect(api.connect).toHaveBeenCalledWith({ binary: '/bin/bingo' })
    expect(vi.mocked(api.request).mock.calls.some(([call]) => call.method === 'session/open')).toBe(false)
    expect(screen.getByRole('button', { name: 'Personal space' })).toBeTruthy()
  })
  it('leaves the starting area on first send and restores it only for a new thread', async () => {
    desktop(); render(<App />); await ready()
    expect(screen.getByRole('heading', { name: 'What would you like to work on?' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message bingo' }), { target: { value: 'Plan a small change' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByRole('heading', { name: 'Answer' })
    expect(screen.queryByRole('heading', { name: 'What would you like to work on?' })).toBeNull()
    expect(document.querySelector('.empty-conversation')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }))
    expect(await screen.findByRole('heading', { name: 'What would you like to work on?' })).toBeTruthy()
  })
  it('restarts a failed draft host through the onboarding Reconnect button without resending an intent', async () => {
    const { api, emitDesktop } = desktop()
    render(<App />); await ready()
    expect(vi.mocked(api.request).mock.calls.some(([call]) => call.method === 'session/open')).toBe(false)
    const failed = { hostId: 'host', busy: false, status: 'failed' as const, connectionId: 'connection', workspace: '/work', binary: '/bin/bingo', error: { code: 'EXITED', message: 'Runtime stopped.' } }
    await act(async () => emitDesktop({ type: 'connection', connection: failed }))
    const onboarding = document.querySelector('.onboarding') as HTMLElement
    expect(onboarding).toBeTruthy()
    vi.mocked(api.connect).mockResolvedValueOnce({ ok: true, value: failed }) // Ensure cannot restart an existing failed epoch.
    fireEvent.click(within(onboarding).getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(api.reconnect).toHaveBeenCalledWith({ hostId: 'host', connectionId: 'connection' }))
    expect(api.connect).toHaveBeenCalledTimes(1)
    const input = await screen.findByRole('textbox', { name: 'Message bingo' })
    fireEvent.change(input, { target: { value: 'A new unsent message' } })
    expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(false)
    expect(vi.mocked(api.request).mock.calls.some(([call]) => call.method === 'session/submit')).toBe(false)
  })
  it('ensures a closed draft host without an epoch from the onboarding Reconnect button', async () => {
    const { api, emitDesktop, server } = desktop()
    render(<App />); await ready()
    await act(async () => emitDesktop({ type: 'connection', connection: { hostId: 'host', busy: false, status: 'disconnected', connectionId: null, workspace: '/work', binary: '/bin/bingo' } }))
    const onboarding = document.querySelector('.onboarding') as HTMLElement
    expect(onboarding).toBeTruthy()
    vi.mocked(api.connect).mockResolvedValueOnce({ ok: true, value: { hostId: 'host', busy: false, status: 'ready', connectionId: 'connection-next', workspace: '/work', binary: '/bin/bingo', server } })
    fireEvent.click(within(onboarding).getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(api.connect).toHaveBeenCalledTimes(2))
    expect(api.reconnect).not.toHaveBeenCalled()
    expect(await screen.findByRole('textbox', { name: 'Message bingo' })).toBeTruthy()
    expect(vi.mocked(api.request).mock.calls.some(([call]) => call.method === 'session/submit')).toBe(false)
  })
  it.each(['failed', 'disconnected'] as const)('routes onboarding Reconnect to previewed A, not saved B, when A is %s', async status => {
    const { api, emitDesktop, server } = desktop()
    const a = status === 'failed' ? { ...hostA, status, error: { code: 'EXITED', message: 'A stopped' }, server } : { ...hostA, server }
    vi.mocked(api.bootstrap).mockResolvedValueOnce({ ok: true, value: { ...multiHostBootstrap, connections: [a, { ...hostB, server }], selection: { hostId: status === 'failed' ? hostB.hostId : hostA.hostId, connectionId: status === 'failed' ? hostB.connectionId : hostA.connectionId, sessionId: null } } })
    vi.mocked(api.reconnect).mockResolvedValueOnce({ ok: true, value: { ...restartedHostA, server } })
    vi.mocked(api.connect).mockResolvedValueOnce({ ok: true, value: { ...restartedHostA, server } })
    render(<App />)
    await screen.findByText('Connected locally')
    if (status === 'failed') fireEvent.click(screen.getByRole('button', { name: 'Open project project-a' }))
    else await act(async () => emitDesktop({ type: 'connection', connection: { ...hostA, status: 'disconnected', connectionId: null } }))
    await waitFor(() => expect(document.querySelector('.onboarding')).toBeTruthy())
    fireEvent.click(within(document.querySelector('.onboarding') as HTMLElement).getByRole('button', { name: 'Reconnect' }))
    if (status === 'failed') {
      await waitFor(() => expect(api.reconnect).toHaveBeenCalledWith({ hostId: hostA.hostId, connectionId: hostA.connectionId }))
      expect(api.connect).not.toHaveBeenCalled()
    } else {
      await waitFor(() => expect(api.connect).toHaveBeenCalledWith({ workspace: hostA.workspace, binary: hostA.binary }))
      expect(api.reconnect).not.toHaveBeenCalled()
    }
    expect(await screen.findByRole('textbox', { name: 'Message bingo' })).toBeTruthy()
    expect(vi.mocked(api.request).mock.calls.some(([call]) => call.method === 'session/submit')).toBe(false)
  })
  it('uses previewed A workspace when choosing another executable while B is the saved project', async () => {
    const { api, server } = desktop()
    vi.mocked(api.bootstrap).mockResolvedValueOnce({ ok: true, value: { ...multiHostBootstrap, connections: [{ ...hostA, status: 'failed', error: { code: 'EXITED', message: 'A stopped' }, server }, { ...hostB, server }], selection: { hostId: hostB.hostId, connectionId: hostB.connectionId, sessionId: null } } })
    vi.mocked(api.chooseBinary).mockResolvedValueOnce({ ok: true, value: '/approved/other-bingo' })
    vi.mocked(api.connect).mockResolvedValueOnce({ ok: true, value: { ...hostA, hostId: 'host-a-other-binary', connectionId: 'epoch-a-other', binary: '/approved/other-bingo', server } })
    render(<App />)
    await screen.findByText('Connected locally')
    fireEvent.click(screen.getByRole('button', { name: 'Open project project-a' }))
    await waitFor(() => expect(document.querySelector('.onboarding')).toBeTruthy())
    fireEvent.click(within(document.querySelector('.onboarding') as HTMLElement).getByRole('button', { name: 'Choose executable' }))
    await waitFor(() => expect(api.connect).toHaveBeenCalledWith({ workspace: hostA.workspace, binary: '/approved/other-bingo' }))
    expect(api.savePreferences).toHaveBeenCalledWith({ binaryPath: '/approved/other-bingo' })
    expect(api.reconnect).not.toHaveBeenCalled()
  })
  it('retains unread activity while the OS window is hidden and marks read only after visible focus or explicit selection', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const { emit } = desktop()
    render(<App />); await ready()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button', { name: /^Review the workspace/ }))
    await screen.findByRole('heading', { name: 'Review the workspace' })
    const saved = () => JSON.parse(localStorage.getItem('rei.read.v1') ?? '{}')[JSON.stringify(['host', 'session-one'])]
    await waitFor(() => expect(saved()).toBe(0))
    visibility.mockReturnValue('hidden')
    await act(async () => emit({ type: 'notice', level: 'info', code: 'BACKGROUND', text: 'Finished while away' }))
    expect(saved()).toBe(0)
    expect(document.querySelector('.session-unread')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button', { name: /^Review the workspace/ }))
    expect(saved()).toBe(0) // Synthetic click does not prove the OS window became visible.
    visibility.mockReturnValue('visible'); focus.mockReturnValue(false)
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(saved()).toBe(0)
    focus.mockReturnValue(true)
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(saved()).toBe(1))
    expect(document.querySelector('.session-unread')).toBeNull()
    visibility.mockReturnValue('hidden')
    await act(async () => emit({ type: 'notice', level: 'info', code: 'BACKGROUND_2', text: 'Another background update' }))
    visibility.mockReturnValue('visible')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button', { name: /^Review the workspace/ }))
    await waitFor(() => expect(saved()).toBe(2))
  })
  it('pauses stale retry presentation on disconnect while retaining history, error and editable drafts', async () => {
    const { api, emit, emitDesktop, state } = desktop(); render(<App />); await ready()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button', { name: /^Review the workspace/ }))
    await screen.findByRole('heading', { name: 'Review the workspace' })
    await act(async () => {
      emit({ type: 'itemCompleted', item: { id: 'history', status: 'completed', startedAt: time, body: { kind: 'assistant', text: 'Saved history remains readable.' } } })
      emit({ type: 'turnStarted', turn: 'turn', inputs: [], origin: 'submit' })
      emit({ type: 'turnRetrying', turn: 'turn', attempt: 1, max: 3, delayMs: 1000, dropped: [], reason: 'Provider connection was reset.' })
    })
    expect(document.querySelector('.session-status.retrying')).toBeTruthy()
    expect(document.querySelector('.live-working')?.textContent).toBe('Retrying · attempt 1 of 3')
    expect(screen.getByRole('button', { name: 'Stop generation' })).toBeTruthy()
    const input = screen.getByRole('textbox', { name: 'Message bingo' })
    fireEvent.change(input, { target: { value: 'Unsent direction' } })
    await act(async () => emitDesktop({ type: 'connection', connection: { hostId: 'host', busy: false, status: 'failed', connectionId: 'connection', workspace: '/work', binary: '/bin/bingo', error: { code: 'TRANSPORT_CLOSED', message: 'Runtime disconnected.' } } }))
    expect(document.querySelector('.session-status.disconnected')?.textContent).toBe('Not connected')
    expect(document.querySelector('.live-working')).toBeNull()
    expect(screen.queryByText('Retrying · attempt 1 of 3')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop generation' })).toBeNull()
    expect(screen.getByText('Saved history remains readable.')).toBeTruthy()
    expect(screen.getByText('Runtime disconnected.')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'Still editable offline' } })
    expect((input as HTMLTextAreaElement).value).toBe('Still editable offline')
    expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy()
    // Only a fresh authoritative open after reconnect may present a live turn again.
    state.turn = { id: 'fresh-turn', startedAt: time, origin: 'submit' }
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(api.reconnect).toHaveBeenCalledOnce())
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button', { name: /^Review the workspace/ }))
    await waitFor(() => expect(document.querySelector('.session-status.working')).toBeTruthy())
    expect(document.querySelector('.live-working')?.textContent).toBe('Working…')
    expect(screen.getByRole('button', { name: 'Stop generation' }).hasAttribute('disabled')).toBe(false)
  })
  it('submits through the real protocol contract, renders response, and clears only accepted drafts', async () => {
    desktop(); render(<App />); await ready()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message bingo' }), { target: { value: 'Explain the project' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('heading', { name: 'Answer' })).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Message bingo' }) as HTMLTextAreaElement).value).toBe(''))
  })
  it('does not copy a created session rejection back into the next blank draft', async () => {
    desktop({ reject: true }); render(<App />); await ready()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message bingo' }), { target: { value: 'A rejected draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByText('The runtime rejected this message.')
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }))
    await screen.findByRole('heading', { name: 'What would you like to work on?' })
    expect(screen.queryByText('The runtime rejected this message.')).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Message bingo' }) as HTMLTextAreaElement).value).toBe('')
  })
  it('keeps a rejected first draft visible in its newly created session', async () => {
    desktop({ reject: true }); render(<App />); await ready()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message bingo' }), { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByText('The runtime rejected this message.')
    expect((screen.getByRole('textbox', { name: 'Message bingo' }) as HTMLTextAreaElement).value).toBe('Keep this draft')
  })
  it('does not submit while a Chinese input method is composing', async () => {
    const { api } = desktop(); render(<App />); await ready()
    const input = screen.getByRole('textbox', { name: 'Message bingo' })
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '编写测试' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(vi.mocked(api.request).mock.calls.some(([call]) => call.method === 'session/submit')).toBe(false)
    fireEvent.compositionEnd(input)
  })
  it('preserves drafts across new-session navigation and existing session selection', async () => {
    desktop(); render(<App />); await ready()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message bingo' }), { target: { value: 'Unsent new draft' } })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button', { name: /^Review the workspace/ }))
    await screen.findByRole('heading', { name: 'Review the workspace' })
    expect((screen.getByRole('textbox', { name: 'Message bingo' }) as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Message bingo' }) as HTMLTextAreaElement).value).toBe('Unsent new draft'))
  })
  it('shows provider-qualified model identity and authoritative live permission mode', async () => {
    desktop(); render(<App />); await ready()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button', { name: /^Review the workspace/ }))
    await screen.findByRole('heading', { name: 'Review the workspace' })
    expect(screen.getByRole('button', { name: 'Model' }).getAttribute('title')).toBe('custom/same-model')
    expect(screen.getByRole('combobox', { name: 'Permission mode' }).textContent).toContain('Plan · read only')
  })
  it('requires explicit confirmation before enabling permission bypass', async () => {
    const { api } = desktop(); render(<App />); await ready()
    const trigger = screen.getByRole('combobox', { name: 'Permission mode' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const bypass = await screen.findByRole('option', { name: /^Bypass permissions/ })
    act(() => bypass.focus())
    fireEvent.keyDown(bypass, { key: 'Enter' })
    expect(await screen.findByRole('dialog', { name: 'Bypass permission prompts?' })).toBeTruthy()
    expect(vi.mocked(api.request).mock.calls.some(([call]) => call.method === 'session/submit')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Keep asking' }))
  })
  it('stops the running turn with Escape only from the composer or page, not other inputs', async () => {
    const { api, emit } = desktop(); render(<App />); await ready()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button', { name: /^Review the workspace/ }))
    await screen.findByRole('heading', { name: 'Review the workspace' })
    await act(async () => emit({ type: 'turnStarted', turn: 'turn', inputs: [], origin: 'submit' }))
    const interrupts = () => vi.mocked(api.request).mock.calls.filter(([call]) => call.method === 'session/interrupt').length
    const other = document.createElement('textarea'); document.body.append(other)
    fireEvent.keyDown(other, { key: 'Escape' })
    expect(interrupts()).toBe(0)
    other.remove()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message bingo' }), { key: 'Escape' })
    await waitFor(() => expect(interrupts()).toBe(1))
  })
  it('offers session actions as an accessible menu that returns focus on Escape', async () => {
    desktop(); render(<App />); await ready()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button', { name: /^Review the workspace/ }))
    await screen.findByRole('heading', { name: 'Review the workspace' })
    const trigger = screen.getByRole('button', { name: 'Session actions' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Rename session', 'Export Markdown', 'Delete session…'])
    await waitFor(() => expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
  it('runs sidebar row actions through the existing flows and persists pins', async () => {
    desktop(); render(<App />); await ready()
    const sessions = screen.getByRole('navigation', { name: 'Sessions' })
    const row = within(sessions).getByRole('button', { name: /^Review the workspace/ })
    // jsdom blurs the window when focus first leaves the document; real right-clicks focus the row.
    act(() => row.focus())
    fireEvent.contextMenu(row)
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Pin' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('rei.pins.v1') ?? '[]')).toEqual([JSON.stringify(['host', 'session-one'])]))
    const pinned = screen.getByRole('navigation', { name: 'Pinned' })
    fireEvent.contextMenu(within(pinned).getByRole('button', { name: /^Review the workspace/ }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Rename' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rename session' })
    expect((within(dialog).getByRole('textbox', { name: 'Session name' }) as HTMLInputElement).value).toBe('Review the workspace')
  })
  it('toggles panels from the header and shortcuts, explaining why review is unavailable in personal space', async () => {
    desktop({ welcome: true }); render(<App />); await screen.findByText('Connected locally')
    const review = screen.getByRole('button', { name: 'Review changes' })
    expect(review.getAttribute('aria-disabled')).toBe('true')
    expect(review.getAttribute('title')).toBe('Review needs a project folder. Personal space is not a Git workspace.')
    fireEvent.click(review)
    expect(review.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Browser' }).getAttribute('title')).toBe('Browser (Ctrl+Shift+B)')
    fireEvent.keyDown(window, { key: 'B', ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('button', { name: 'Browser' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(window, { key: '`', code: 'Backquote', ctrlKey: true })
    expect(screen.getByRole('button', { name: 'Terminal' }).getAttribute('aria-pressed')).toBe('true')
  })
  it('searches sessions and actions in the palette with keyboard navigation', async () => {
    desktop(); render(<App />); await ready()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const palette = screen.getByRole('dialog', { name: 'Search & commands' })
    const search = within(palette).getByRole('combobox')
    expect(within(palette).getByRole('option', { name: /Review the workspace/ })).toBeTruthy()
    expect(within(palette).getByRole('option', { name: /New conversation/ })).toBeTruthy()
    fireEvent.change(search, { target: { value: 'settings' } })
    await waitFor(() => expect(within(palette).queryByRole('option', { name: /Review the workspace/ })).toBeNull())
    expect(within(palette).getByRole('option', { name: /Settings/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Search & commands' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const again = within(screen.getByRole('dialog', { name: 'Search & commands' })).getByRole('combobox')
    fireEvent.change(again, { target: { value: 'review workspace' } })
    await waitFor(() => expect(screen.getByRole('option', { name: /Review the workspace/ }).getAttribute('aria-selected')).toBe('true'))
    fireEvent.keyDown(again, { key: 'Enter' })
    await screen.findByRole('heading', { name: 'Review the workspace' })
  })
  it('fills, never sends, a suggested prompt from the new-conversation hero', async () => {
    const { api } = desktop(); render(<App />); await ready()
    expect(within(screen.getByRole('navigation', { name: 'Recent conversations' })).getByRole('button', { name: /Review the workspace/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Explain this project' }))
    expect((screen.getByRole('textbox', { name: 'Message bingo' }) as HTMLTextAreaElement).value).toBe('Explain how this project is organized and where I should start reading.')
    expect(vi.mocked(api.request).mock.calls.some(([call]) => call.method === 'session/submit')).toBe(false)
  })
  it('exposes complete settings and persists theme through the native preferences API', async () => {
    const { api } = desktop(); render(<App />); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    expect(api.savePreferences).toHaveBeenCalledWith({ theme: 'dark' })
    fireEvent.click(screen.getByRole('button', { name: 'Models & providers' }))
    expect(screen.getByRole('button', { name: 'Add API provider' })).toBeTruthy()
    expect(screen.getByText('Ready')).toBeTruthy()
  })
  it('clears in-memory drafts as well as persisted drafts', async () => {
    desktop(); render(<App />); await ready()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message bingo' }), { target: { value: 'Remove this draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved drafts' }))
    const confirm = screen.getByRole('dialog', { name: 'Clear saved drafts?' })
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(confirm).getByRole('button', { name: 'Clear drafts' }))
    expect(screen.queryByRole('dialog', { name: 'Clear saved drafts?' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByText('Saved text drafts cleared.')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Message bingo' }) as HTMLTextAreaElement).value).toBe('')
    await waitFor(() => expect(localStorage.getItem('rei.drafts.v1')).toBe('{}'))
  })
  it('routes API keys only through the native provider setup boundary', async () => {
    const { api } = desktop(); render(<App />); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Models & providers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add API provider' }))
    fireEvent.change(screen.getByLabelText('Provider name'), { target: { value: 'local-test' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'test-only-placeholder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }))
    await waitFor(() => expect(api.configureProvider).toHaveBeenCalledWith({ name: 'local-test', protocol: 'openai', baseUrl: '', apiKey: 'test-only-placeholder' }))
    expect(vi.mocked(api.request).mock.calls.some(([call]) => JSON.stringify(call).includes('test-only-placeholder'))).toBe(false)
    expect(localStorage.getItem('rei.drafts.v1') ?? '').not.toContain('test-only-placeholder')
  })
})

describe('interaction safety', () => {
  it('never offers a credential field for journaled paste login', () => {
    const respond = vi.fn()
    render(<InteractionPanel interaction={{ id: 'login', session: 's', openedAt: time, kind: { kind: 'login', provider: 'custom', flow: { kind: 'paste' } }, answers: ['text', 'cancel'] }} respond={respond} openLink={vi.fn()} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText('Send answer')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(respond).toHaveBeenCalledWith({ kind: 'cancel' }, 'keyboard')
  })
  it('isolates simultaneous question radio groups', () => {
    const question = { kind: 'question' as const, question: 'Choose one', options: [{ id: 'a', label: 'Option A' }, { id: 'b', label: 'Option B' }], multi: false }
    const respond = vi.fn(async () => {})
    render(<>{['one', 'two'].map((id) => <InteractionPanel key={id} interaction={{ id, session: 's', openedAt: time, kind: question, answers: ['choice', 'cancel'] }} respond={respond} openLink={vi.fn()} />)}</>)
    const radios = screen.getAllByRole('radio', { name: 'Option A' })
    fireEvent.click(radios[0]); fireEvent.click(radios[1])
    expect((radios[0] as HTMLInputElement).checked).toBe(true)
    expect((radios[1] as HTMLInputElement).checked).toBe(true)
    expect(radios[0].getAttribute('name')).not.toBe(radios[1].getAttribute('name'))
  })
})
