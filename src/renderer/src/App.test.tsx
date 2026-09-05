// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BingoDesktopApi, DesktopEvent, DesktopRequest } from '../../shared/desktop'
import type { Event, RpcMethods, SessionState } from '../../shared/rpc'
import App from './App'
import { rustInitial } from './state/fixtures'
import { InteractionPanel } from './components/InteractionPanel'

const time = '2026-09-05T10:00:00Z'
function desktop({ welcome = false, reject = false } = {}) {
  let listener: (event: DesktopEvent) => void = () => {}
  let seq = 0
  let preferences = { theme: 'light' as 'light' | 'dark' | 'system', workspace: welcome ? null : '/work', binaryPath: '/bin/bingo', recentWorkspaces: [] as string[] }
  const summary = { ...rustInitial.summary, id: 'session-one', title: 'Review the workspace', cwd: '/work', provider: 'custom', model: 'same-model', createdAt: time, updatedAt: time }
  const state: SessionState = { ...rustInitial, seq: 0, summary, items: [], config: { kernel: { thinking: 'xHigh' }, plugins: { 'bingo.permissions': { mode: 'plan' } } } }
  const emit = (event: Event) => listener({ type: 'rpc', connectionId: 'connection', method: 'event', params: { session: summary.id, ts: time, seq: ++seq, event } })
  const api: BingoDesktopApi = {
    bootstrap: vi.fn(async () => ({ ok: true as const, value: { version: '0.1.0', platform: 'linux', scratchWorkspace: '/scratch', preferences, binary: { path: '/bin/bingo', source: 'test' }, connection: { status: 'disconnected' as const, connectionId: null, workspace: null, binary: null } } })),
    connect: vi.fn(async ({ workspace = '/scratch' }) => ({ ok: true as const, value: { status: 'ready' as const, connectionId: 'connection', workspace, binary: '/bin/bingo' } })),
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
  return { api, emit, state }
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
  it('starts in personal space without requiring a folder or creating an empty session', async () => {
    const { api } = desktop({ welcome: true }); render(<App />)
    await screen.findByText('Connected locally')
    expect(screen.getByRole('heading', { name: 'What’s on your mind?' })).toBeTruthy()
    expect(api.chooseWorkspace).not.toHaveBeenCalled()
    expect(api.connect).toHaveBeenCalledWith({ binary: '/bin/bingo' })
    expect(vi.mocked(api.request).mock.calls.some(([call]) => call.method === 'session/open')).toBe(false)
    expect(screen.getByRole('button', { name: 'Attach a project' })).toBeTruthy()
  })
  it('submits through the real protocol contract, renders response, and clears only accepted drafts', async () => {
    desktop(); render(<App />); await ready()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message bingo' }), { target: { value: 'Explain the project' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('heading', { name: 'Answer' })).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Message bingo' }) as HTMLTextAreaElement).value).toBe(''))
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
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button'))
    await screen.findByRole('heading', { name: 'Review the workspace' })
    expect((screen.getByRole('textbox', { name: 'Message bingo' }) as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'New session' }))
    expect((screen.getByRole('textbox', { name: 'Message bingo' }) as HTMLTextAreaElement).value).toBe('Unsent new draft')
  })
  it('shows provider-qualified model identity and authoritative live permission mode', async () => {
    desktop(); render(<App />); await ready()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button'))
    await screen.findByRole('heading', { name: 'Review the workspace' })
    expect(screen.getByRole('button', { name: 'Model' }).getAttribute('title')).toBe('custom/same-model')
    expect(screen.getByRole('combobox', { name: 'Permission mode' }).textContent).toContain('Plan · read only')
  })
  it('requires explicit confirmation before enabling permission bypass', async () => {
    const { api } = desktop(); render(<App />); await ready()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Permission mode' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: /^Bypass permissions/ }))
    expect(screen.getByRole('dialog', { name: 'Bypass permission prompts?' })).toBeTruthy()
    expect(vi.mocked(api.request).mock.calls.some(([call]) => call.method === 'session/submit')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Keep asking' }))
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved drafts' }))
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
