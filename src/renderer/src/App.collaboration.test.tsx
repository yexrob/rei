// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BingoDesktopApi, DesktopEvent, DesktopRequest, Result } from '../../shared/desktop'
import type { Event, Frame, GatewayEvent, IntentOutcome, RpcMethods, SessionState } from '../../shared/rpc'
import App from './App'
import { rustInitial } from './state/fixtures'
import { foldSessionFrame } from './state/session'

const time = '2026-09-17T10:00:00Z'
const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
const rootId = 'main-session'
const childId = 'reviewer-session'

function desktop() {
  let listener: (event: DesktopEvent) => void = () => {}
  const preferences = { theme: 'light' as const, workspace: '/work', binaryPath: '/bin/bingo', recentWorkspaces: ['/work'] }
  const root: SessionState = { ...rustInitial, summary: { ...rustInitial.summary, id: rootId, title: 'Main conversation', cwd: '/work' }, items: [], config: { kernel: { thinking: 'off' }, plugins: {} } }
  const child: SessionState = { ...root, summary: { ...root.summary, id: childId, title: 'reviewer', key: `agent/${rootId}/reviewer`, parent: { session: rootId } } }
  const states = new Map([[rootId, root], [childId, child]])
  const submitted: DesktopRequest<'session/submit'>[] = []
  const emit = (session: string, event: Event) => {
    const snapshot = states.get(session)!
    const frame: Frame = { session, seq: snapshot.seq + 1, ts: time, event }
    states.set(session, foldSessionFrame(snapshot, frame))
    listener({ type: 'rpc', connectionId: 'connection', method: 'event', params: frame })
  }
  const gateway = (event: GatewayEvent) => {
    if (event.type === 'sessionRemoved') states.delete(event.session)
    listener({ type: 'rpc', connectionId: 'connection', method: 'gateway/event', params: event })
  }
  const ack = (index: number, outcome: IntentOutcome) => {
    const { session, intent } = submitted[index].params
    emit(session, { type: 'intentAck', intent, outcome })
  }
  const request = vi.fn(async (input: DesktopRequest): Promise<Result<unknown>> => {
    if (input.method === 'session/list') return ok({ sessions: [...states.values()].map((state) => state.summary) })
    if (input.method === 'session/open') {
      const { selector } = input.params as RpcMethods['session/open']['params']
      const snapshot = states.get(selector.kind === 'byId' ? selector.id : rootId)
      return snapshot ? ok({ session: snapshot.summary.id, snapshot }) : { ok: false, error: { code: 'NOT_FOUND', message: 'The parent session is no longer available.' } }
    }
    if (input.method === 'catalog/read') {
      const { kind } = input.params as RpcMethods['catalog/read']['params']
      return ok({ kind, entries: kind === 'models' ? [{ id: 'fake/fake-1', label: 'Fake model', meta: { provider: 'fake' } }] : kind === 'providers' ? [{ id: 'fake', label: 'fake', meta: { auth: { kind: 'notApplicable' } } }] : [] })
    }
    if (input.method === 'session/submit') submitted.push(input as DesktopRequest<'session/submit'>)
    return ok({})
  })
  const api: BingoDesktopApi = {
    bootstrap: vi.fn(async () => ok({ version: '0.1.0', platform: 'linux', scratchWorkspace: '/scratch', preferences, binary: { path: '/bin/bingo', source: 'test' }, connection: { status: 'disconnected' as const, connectionId: null, workspace: null, binary: null } })),
    connect: vi.fn(async () => ok({ status: 'ready' as const, connectionId: 'connection', workspace: '/work', binary: '/bin/bingo' })),
    request: request as BingoDesktopApi['request'],
    onEvent: vi.fn((next) => { listener = next; return () => { listener = () => {} } }),
    chooseWorkspace: vi.fn(async () => ok('/work')),
    chooseBinary: vi.fn(async () => ok('/bin/bingo')),
    chooseImages: vi.fn(async () => ok([])),
    savePreferences: vi.fn(async (patch) => ok({ ...preferences, ...patch })),
    openExternal: vi.fn(async () => ok(undefined)),
    exportText: vi.fn(async () => ok(false)),
    deleteSession: vi.fn(async () => ok(false)),
    configureProvider: vi.fn(async () => ok(undefined))
  }
  window.bingoDesktop = api
  return { submitted, emit, gateway, ack }
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

async function openMain() {
  const bridge = desktop()
  render(<App />)
  await screen.findByText('Connected locally')
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Sessions' })).getByRole('button', { name: /Main conversation/ }))
  await screen.findByRole('heading', { name: 'Main conversation' })
  await screen.findByRole('button', { name: 'Environment' })
  return bridge
}

async function openChild() {
  fireEvent.click(screen.getByRole('button', { name: 'Environment' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Collaborators' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Collaborators' }))
  fireEvent.click(await screen.findByRole('button', { name: /^reviewer · Agent/ }))
  await screen.findByRole('textbox', { name: 'Message reviewer' })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Back to Bingo' }).hasAttribute('disabled')).toBe(false))
}

async function backToMain() {
  fireEvent.click(screen.getByRole('button', { name: 'Back to Bingo' }))
  await screen.findByRole('heading', { name: 'Main conversation' })
}

const message = (name: string) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement
const typeMessage = (name: string, value: string) => fireEvent.change(message(name), { target: { value } })
const mainError = { type: 'notice' as const, level: 'error' as const, code: 'MAIN', text: 'Main conversation needs attention.' }

describe('collaboration recipient and async presentation isolation', () => {
  it('keeps the canonical child recipient and routing after its parent summary disappears', async () => {
    const bridge = await openMain()
    typeMessage('Message bingo', 'Unsent main draft')
    await openChild()
    typeMessage('Message reviewer', 'Only the reviewer receives this')
    await act(async () => { bridge.gateway({ type: 'sessionRemoved', session: rootId }) })
    expect(message('Message reviewer').value).toBe('Only the reviewer receives this')
    expect(screen.getByText('To reviewer')).toBeTruthy()
    expect(screen.getByText('Only reviewer receives this message')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Message bingo' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(bridge.submitted).toHaveLength(1))
    expect(bridge.submitted[0].params).toMatchObject({ session: childId, input: { kind: 'text', text: 'Only the reviewer receives this', origin: { surface: 'desktop' } } })
    await act(async () => { bridge.ack(0, { kind: 'applied', result: {} }) })
    await waitFor(() => expect(message('Message reviewer').value).toBe(''))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('rei.drafts.v1') ?? '{}')[`/work:${rootId}`]).toBe('Unsent main draft'))
  })

  it('keeps independent drafts and does not display a late child rejection in the main conversation', async () => {
    const bridge = await openMain()
    typeMessage('Message bingo', 'Preserved main draft')
    await openChild()
    typeMessage('Message reviewer', 'Rejected child draft stays here')
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(bridge.submitted).toHaveLength(1))
    await backToMain()
    expect(message('Message bingo').value).toBe('Preserved main draft')
    await act(async () => { bridge.emit(rootId, mainError) })
    expect(screen.getByText(mainError.text)).toBeTruthy()
    await act(async () => { bridge.ack(0, { kind: 'rejected', error: { code: 'INVALID_INPUT', message: 'The child rejected this draft.' } }) })
    expect(screen.getByText(mainError.text)).toBeTruthy()
    expect(screen.queryByText('The child rejected this draft.')).toBeNull()
    expect(message('Message bingo').value).toBe('Preserved main draft')
    await openChild()
    expect(message('Message reviewer').value).toBe('Rejected child draft stays here')
  })

  it('does not clear a newer main error when a child thinking command succeeds late', async () => {
    const bridge = await openMain()
    await openChild()
    typeMessage('Message reviewer', 'Independent child draft')
    const thinking = screen.getByRole('combobox', { name: 'Thinking effort' })
    act(() => thinking.focus())
    fireEvent.keyDown(thinking, { key: 'ArrowDown' })
    const high = await screen.findByRole('option', { name: /^High/ })
    act(() => high.focus())
    fireEvent.keyDown(high, { key: 'Enter' })
    await waitFor(() => expect(bridge.submitted).toHaveLength(1))
    expect(bridge.submitted[0].params).toMatchObject({ session: childId, input: { kind: 'action', action: { name: 'think', args: 'high' } } })
    await backToMain()
    await act(async () => { bridge.emit(rootId, mainError) })
    expect(screen.getByText(mainError.text)).toBeTruthy()
    await act(async () => { bridge.ack(0, { kind: 'applied', result: { message: 'Child thinking updated.' } }) })
    expect(screen.getByText(mainError.text)).toBeTruthy()
    expect(screen.queryByText('Child thinking updated.')).toBeNull()
    await openChild()
    expect(message('Message reviewer').value).toBe('Independent child draft')
  })
})
