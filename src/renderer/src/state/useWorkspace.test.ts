// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BingoDesktopApi, ConnectionState, DesktopEvent, DesktopMethod, DesktopPreferences,
  DesktopRequest, Result
} from '../../../shared/desktop'
import type { Event, Frame, RpcMethods, SessionState } from '../../../shared/rpc'
import { rustInitial } from './fixtures'
import { useWorkspace } from './useWorkspace'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
const disconnected: ConnectionState = { status: 'disconnected', connectionId: null, workspace: null, binary: null }
const preferences: DesktopPreferences = { theme: 'system', workspace: null, binaryPath: null, recentWorkspaces: [] }
const snapshot = (id = 'ses_1', seq = 10, text = 'Before', generation = 0): SessionState => ({
  ...rustInitial, seq, historyGeneration: generation,
  summary: { ...rustInitial.summary, id, cwd: '/work', title: id },
  items: [{ id: `${id}-assistant`, turn: 'turn_1', round: 0, startedAt: '2023-11-14T22:13:20Z', status: 'running', body: { kind: 'assistant', text } }]
})
const frame = (seq: number, event: Event, session = 'ses_1'): Frame => ({ seq, session, ts: '2023-11-14T22:13:20Z', event })
const delta = (seq: number, data: string, session = 'ses_1') => frame(seq, { type: 'itemDelta', item: `${session}-assistant`, n: seq, kind: 'text', data }, session)
const openReply = (state: SessionState) => ok({ session: state.summary.id, snapshot: state })

function desktop() {
  const listeners = new Set<(event: DesktopEvent) => void>()
  const handlers = new Map<DesktopMethod, (input: DesktopRequest) => Promise<Result<unknown>>>()
  let generation = 0
  let connection: ConnectionState = disconnected
  const emit = (event: DesktopEvent) => listeners.forEach((listener) => listener(event))
  const emitFrame = (params: Frame, connectionId = connection.connectionId!) => emit({ type: 'rpc', connectionId, method: 'event', params })
  const request = vi.fn(async (input: DesktopRequest): Promise<Result<unknown>> => {
    const handler = handlers.get(input.method)
    if (handler) return handler(input)
    if (input.method === 'session/list') return ok({ sessions: [] })
    if (input.method === 'catalog/read') return ok({ kind: (input.params as RpcMethods['catalog/read']['params']).kind, entries: [] })
    if (input.method === 'session/open') {
      const { selector } = input.params as RpcMethods['session/open']['params']
      const id = selector.kind === 'byId' ? selector.id : 'ses_new'
      const state = snapshot(id)
      if (selector.kind === 'create') {
        state.summary.driver = selector.spec.driver ?? 'model'
        state.summary.provider = selector.spec.provider ?? state.summary.provider
        state.summary.model = selector.spec.model ?? state.summary.model
      }
      return openReply(state)
    }
    return ok({})
  })
  const api: BingoDesktopApi = {
    bootstrap: vi.fn(async () => ok({ version: '0.1.0', platform: 'darwin', preferences, scratchWorkspace: '/scratch', binary: { path: null, source: 'missing' }, connection: disconnected })),
    connect: vi.fn(async ({ workspace }) => {
      connection = { status: 'ready', connectionId: `connection-${++generation}`, workspace: workspace ?? '/scratch', binary: '/bin/bingo' }
      return ok(connection)
    }),
    request: request as BingoDesktopApi['request'],
    onEvent: vi.fn((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }),
    savePreferences: vi.fn(async (patch) => ok({ ...preferences, ...patch })),
    chooseWorkspace: vi.fn(async () => ok('/work')),
    chooseBinary: vi.fn(async () => ok('/bin/bingo')),
    chooseImages: vi.fn(async () => ok([])),
    openExternal: vi.fn(async () => ok(undefined)),
    exportText: vi.fn(async () => ok(false)),
    deleteSession: vi.fn(async () => ok(false)),
    configureProvider: vi.fn(async () => ok(undefined))
  }
  Object.defineProperty(window, 'bingoDesktop', { configurable: true, value: api })
  const ack = (input: DesktopRequest, seq: number, outcome: Extract<Event, { type: 'intentAck' }>['outcome']) => {
    const params = input.params as RpcMethods['session/submit']['params']
    emitFrame(frame(seq, { type: 'intentAck', intent: params.intent, outcome }, params.session), input.connectionId)
  }
  return { api, request, handlers, emit, emitFrame, ack, listeners }
}

async function connected() {
  const bridge = desktop()
  const hook = renderHook(() => useWorkspace())
  await act(async () => { await Promise.resolve() })
  await act(async () => { await hook.result.current.connect('/work') })
  return { bridge, ...hook }
}

async function opened() {
  const setup = await connected()
  await act(async () => { await setup.result.current.openSession('ses_1') })
  return setup
}

function assistantText(state: ReturnType<typeof useWorkspace>['active']): string | undefined {
  const body = state?.snapshot.items[0]?.body
  return body?.kind === 'assistant' ? body.text : undefined
}

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('new conversation runtime selection', () => {
  it('lets a mixed-case model choice repair an invalid default without opening an empty session', async () => {
    const { bridge, result } = await connected()
    bridge.handlers.set('catalog/read', async () => ok({ kind: 'models', entries: [{ id: 'Road-anti/test-model', label: 'Test model', meta: { provider: 'Road-anti', model: 'test-model' } }] }))
    await act(async () => { await result.current.readCatalog('models') })
    bridge.handlers.set('session/open', async () => ({ ok: false, error: { code: 'INVALID_INPUT', message: 'Unknown provider: road-anti' } }))
    let outcome: unknown
    await act(async () => { outcome = await result.current.runAction('model', 'Road-anti/test-model').catch((error: unknown) => error) })
    expect(outcome).not.toBeInstanceOf(Error)
    expect(result.current.activeId).toBeNull()
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/open')).toHaveLength(0)
  })

  it('keeps thinking and model choices on the unsent draft and restores them after visiting a session', async () => {
    const { bridge, result } = await connected()
    bridge.request.mockClear()
    await act(async () => {
      await result.current.runAction('think', 'xhigh')
      await result.current.runAction('model', 'Road-anti/family/Model')
    })
    expect(result.current.activeId).toBeNull()
    expect(result.current.runtimeSelection).toEqual({ model: 'Road-anti/family/Model', thinking: 'xhigh' })
    expect(bridge.request).not.toHaveBeenCalled()
    await act(async () => { await result.current.openSession('ses_1') })
    expect(result.current.runtimeSelection).toEqual({ model: 'fake/fake-1', thinking: 'off' })
    await act(async () => { result.current.newSession() })
    expect(result.current.runtimeSelection).toEqual({ model: 'Road-anti/family/Model', thinking: 'xhigh' })
    await act(async () => { await result.current.connect('/other') })
    expect(result.current.runtimeSelection).toEqual({ model: null, thinking: null })
    await act(async () => { await result.current.connect('/work') })
    expect(result.current.runtimeSelection).toEqual({ model: 'Road-anti/family/Model', thinking: 'xhigh' })
  })

  it('creates with the exact catalog identity, then waits for think acceptance before first text', async () => {
    const { bridge, result } = await connected()
    bridge.handlers.set('catalog/read', async () => ok({ kind: 'models', entries: [{ id: 'Road-anti/family/Model', label: 'Friendly label, not the model ID', meta: { provider: 'Road-anti' } }] }))
    await act(async () => {
      await result.current.readCatalog('models')
      await result.current.runAction('model', 'Road-anti/family/Model')
      await result.current.runAction('think', 'xhigh')
    })
    let think!: DesktopRequest
    bridge.handlers.set('session/submit', async (input) => {
      const params = input.params as RpcMethods['session/submit']['params']
      if (params.input.kind === 'action') think = input
      else bridge.ack(input, 13, { kind: 'turnStarted', turn: 'turn_1' })
      return ok({})
    })
    let sent!: Promise<string>
    await act(async () => { sent = result.current.send('Keep this draft', []) })
    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'session/open', params: { selector: { kind: 'create', spec: { cwd: '/work', driver: 'model', provider: 'Road-anti', model: 'family/Model' } }, options: { children: false } } }))
    expect(think.params).toMatchObject({ session: 'ses_new', input: { kind: 'action', action: { name: 'think', args: 'xhigh' } } })
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/submit')).toHaveLength(1)
    expect(result.current.runtimeSelection).toEqual({ model: 'Road-anti/family/Model', thinking: 'off' })
    await act(async () => {
      bridge.emitFrame(frame(11, { type: 'configChanged', config: { kernel: { thinking: 'xHigh' } } }, 'ses_new'))
      bridge.ack(think, 12, { kind: 'applied', result: { message: 'thinking: xHigh' } })
      await sent
    })
    expect(await sent).toBe('ses_new')
    expect(result.current.runtimeSelection.thinking).toBe('xHigh')
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/submit').map(([input]) => (input.params as RpcMethods['session/submit']['params']).input)).toEqual([
      { kind: 'action', action: { name: 'think', args: 'xhigh' } },
      { kind: 'text', text: 'Keep this draft', images: [], origin: { surface: 'desktop' } }
    ])
  })

  it('supports the App open, draft migration, explicit-session send path and does not repeat setup', async () => {
    const { bridge, result } = await connected()
    let seq = 10
    bridge.handlers.set('session/submit', async (input) => { bridge.ack(input, ++seq, { kind: 'applied', result: {} }); return ok({}) })
    await act(async () => { await result.current.runAction('think', 'off') })
    let id!: string
    await act(async () => { id = await result.current.openSession() })
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/submit')).toHaveLength(0)
    await act(async () => { await result.current.send('First', [], id); await result.current.send('Second', [], id) })
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/submit').map(([input]) => (input.params as RpcMethods['session/submit']['params']).input.kind)).toEqual(['action', 'text', 'text'])
  })

  it('keeps the draft selection after failed creation and never submits against the invalid default', async () => {
    const { bridge, result } = await connected()
    bridge.handlers.set('session/open', async () => ({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to Road-anti.' } }))
    await act(async () => { await result.current.runAction('model', 'Road-anti/Model'); await result.current.runAction('think', 'high') })
    await act(async () => { await expect(result.current.openSession()).rejects.toThrow('Sign in to Road-anti.') })
    expect(result.current.activeId).toBeNull()
    expect(result.current.runtimeSelection).toEqual({ model: 'Road-anti/Model', thinking: 'high' })
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/submit')).toHaveLength(0)
  })

  it('blocks text when initial thinking is rejected and lets an authoritative correction replace it', async () => {
    const { bridge, result } = await connected()
    bridge.handlers.set('session/submit', async (input) => { bridge.ack(input, 11, { kind: 'rejected', error: { code: 'INVALID_INPUT', message: 'Unsupported effort' } }); return ok({}) })
    await act(async () => { await result.current.runAction('think', 'high'); await result.current.openSession() })
    await act(async () => { await expect(result.current.send('Still unsent', [], 'ses_new')).rejects.toThrow('Unsupported effort') })
    expect(result.current.activeId).toBe('ses_new')
    expect(result.current.runtimeSelection.thinking).toBe('off')
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/submit')).toHaveLength(1)
    let seq = 11
    bridge.handlers.set('session/submit', async (input) => { bridge.ack(input, ++seq, { kind: 'applied', result: {} }); return ok({}) })
    await act(async () => { await result.current.runAction('think', 'low'); await result.current.send('Still unsent', [], 'ses_new') })
    const inputs = bridge.request.mock.calls.filter(([input]) => input.method === 'session/submit').map(([input]) => (input.params as RpcMethods['session/submit']['params']).input)
    expect(inputs).toEqual([
      { kind: 'action', action: { name: 'think', args: 'high' } },
      { kind: 'action', action: { name: 'think', args: 'low' } },
      { kind: 'text', text: 'Still unsent', images: [], origin: { surface: 'desktop' } }
    ])
  })

  it('does not send text to a replacement connection when thinking setup finishes late', async () => {
    const { bridge, result } = await connected()
    const wire = deferred<Result<unknown>>()
    bridge.handlers.set('session/submit', async (input) => { bridge.ack(input, 11, { kind: 'applied', result: {} }); return wire.promise })
    await act(async () => { await result.current.runAction('think', 'high'); await result.current.openSession() })
    let sent!: Promise<unknown>
    await act(async () => { sent = result.current.send('Do not misroute this draft', [], 'ses_new').catch((error: unknown) => error) })
    await act(async () => { await result.current.connect('/other') })
    await act(async () => { wire.resolve(ok({})); await sent })
    expect(await sent).toEqual(new Error('Workspace changed before the message could be sent.'))
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/submit')).toHaveLength(1)
    expect(result.current.activeId).toBeNull()
  })

  it('refuses a malformed catalog identity without replacing the previous draft choice', async () => {
    const { bridge, result } = await connected()
    bridge.handlers.set('catalog/read', async () => ok({ kind: 'models', entries: [{ id: 'road-anti/Model', label: 'Model', meta: { provider: 'Road-anti' } }] }))
    await act(async () => { await result.current.runAction('model', 'Road/Previous'); await result.current.readCatalog('models') })
    await act(async () => { await expect(result.current.runAction('model', 'road-anti/Model')).rejects.toThrow('no valid provider identity') })
    expect(result.current.runtimeSelection.model).toBe('Road/Previous')
    expect(result.current.activeId).toBeNull()
  })

  it('resolves settings custom model IDs against an exact registered provider without case folding', async () => {
    const { bridge, result } = await connected()
    bridge.handlers.set('catalog/read', async () => ok({ kind: 'providers', entries: [{ id: 'Road-anti', label: 'Road-anti' }] }))
    await act(async () => {
      await result.current.readCatalog('providers')
      await result.current.runAction('model', 'Road-anti/private/Unlisted')
      await result.current.openSession()
    })
    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'session/open', params: expect.objectContaining({ selector: { kind: 'create', spec: { cwd: '/work', driver: 'model', provider: 'Road-anti', model: 'private/Unlisted' } } }) }))
  })
})

describe('workspace runtime bootstrap', () => {
  it('automatically connects an available binary to personal space without choosing a project', async () => {
    const bridge = desktop()
    vi.mocked(bridge.api.bootstrap).mockResolvedValue(ok({ version: '0.1.0', platform: 'darwin', preferences, scratchWorkspace: '/scratch', binary: { path: '/bin/bingo', source: 'bundled' }, connection: disconnected }))
    const { result } = renderHook(() => useWorkspace())
    await act(async () => { await Promise.resolve() })
    expect(bridge.api.connect).toHaveBeenCalledWith({ workspace: undefined, binary: '/bin/bingo' })
    expect(bridge.api.chooseWorkspace).not.toHaveBeenCalled()
    expect(result.current.connection.workspace).toBe('/scratch')
    expect(bridge.api.savePreferences).toHaveBeenCalledWith({ workspace: null })
    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'session/list', params: { filter: { cwd: '/scratch', limit: 500 } } }))
  })

  it('uses a saved project at startup rather than personal space', async () => {
    const bridge = desktop()
    vi.mocked(bridge.api.bootstrap).mockResolvedValue(ok({ version: '0.1.0', platform: 'darwin', preferences: { ...preferences, workspace: '/saved' }, scratchWorkspace: '/scratch', binary: { path: '/bin/bingo', source: 'bundled' }, connection: disconnected }))
    renderHook(() => useWorkspace())
    await act(async () => { await Promise.resolve() })
    expect(bridge.api.connect).toHaveBeenCalledWith({ workspace: '/saved', binary: '/bin/bingo' })
    expect(bridge.api.chooseWorkspace).not.toHaveBeenCalled()
  })

  it('does not attempt to connect or force a folder picker when no binary was found', async () => {
    const bridge = desktop()
    renderHook(() => useWorkspace())
    await act(async () => { await Promise.resolve() })
    expect(bridge.api.connect).not.toHaveBeenCalled()
    expect(bridge.api.chooseWorkspace).not.toHaveBeenCalled()
  })
})

describe('workspace intent acknowledgments', () => {
  it('registers the pending intent before a synchronous ack and waits for the RPC response too', async () => {
    const { bridge, result } = await opened()
    const wire = deferred<Result<unknown>>()
    bridge.handlers.set('session/submit', async (input) => {
      bridge.ack(input, 11, { kind: 'turnStarted', turn: 'turn_1' })
      return wire.promise
    })
    let sent!: Promise<string>
    let settled = false
    await act(async () => { sent = result.current.send('hello', [], 'ses_1').then((id) => { settled = true; return id }) })
    expect(settled).toBe(false)
    expect(result.current.active?.snapshot.seq).toBe(11)
    await act(async () => { wire.resolve(ok({})); await sent })
    expect(await sent).toBe('ses_1')
    expect(settled).toBe(true)
  })

  it('does not treat an empty RPC response as acceptance and resolves when a queued ack arrives', async () => {
    const { bridge, result } = await opened()
    let submitted!: DesktopRequest
    bridge.handlers.set('session/submit', async (input) => { submitted = input; return ok({}) })
    let sent!: Promise<string>
    let settled = false
    await act(async () => { sent = result.current.send('follow up', [], 'ses_1').then((id) => { settled = true; return id }) })
    expect(settled).toBe(false)
    await act(async () => { bridge.ack(submitted, 11, { kind: 'queued', position: 0 }); await sent })
    expect(settled).toBe(true)
  })

  it('rejects a command from its authoritative ack even when the RPC request succeeded', async () => {
    const { bridge, result } = await opened()
    let submitted!: DesktopRequest
    bridge.handlers.set('session/submit', async (input) => { submitted = input; return ok({}) })
    let rejected!: Promise<unknown>
    await act(async () => { rejected = result.current.runAction('model', 'unknown/m').catch((error: unknown) => error) })
    await act(async () => { bridge.ack(submitted, 11, { kind: 'rejected', error: { code: 'INVALID_INPUT', message: 'No such model' } }); await rejected })
    expect(await rejected).toEqual(new Error('No such model'))
    expect(result.current.activeId).toBe('ses_1')
  })

  it('shows existing-session model and thinking only when authoritative state changes arrive', async () => {
    const { bridge, result } = await opened()
    bridge.handlers.set('session/submit', async (input) => { bridge.ack(input, 11, { kind: 'applied', result: {} }); return ok({}) })
    await act(async () => { await result.current.runAction('model', 'Road-anti/Model') })
    expect(result.current.runtimeSelection.model).toBe('fake/fake-1')
    await act(async () => { bridge.emitFrame(frame(12, { type: 'sessionUpdated', summary: { ...snapshot().summary, provider: 'Road-anti', model: 'Model' } })) })
    expect(result.current.runtimeSelection.model).toBe('Road-anti/Model')
    bridge.handlers.set('session/submit', async (input) => { bridge.ack(input, 13, { kind: 'applied', result: {} }); return ok({}) })
    await act(async () => { await result.current.runAction('think', 'high') })
    expect(result.current.runtimeSelection.thinking).toBe('off')
    await act(async () => { bridge.emitFrame(frame(14, { type: 'configChanged', config: { kernel: { thinking: 'high' } } })) })
    expect(result.current.runtimeSelection.thinking).toBe('high')
  })

  it('renders actual {view} and {message} command ack results without a fictitious kind field', async () => {
    const { bridge, result } = await opened()
    const view = { kind: 'text' as const, text: 'permission mode: plan' }
    bridge.handlers.set('session/submit', async (input) => { bridge.ack(input, 11, { kind: 'applied', result: { view } }); return ok({}) })
    await act(async () => { await result.current.runAction('permission') })
    expect(result.current.commandView).toEqual(view)
    bridge.handlers.set('session/submit', async (input) => { bridge.ack(input, 12, { kind: 'applied', result: { message: 'permission mode: plan' } }); return ok({}) })
    await act(async () => { await result.current.runAction('permission', 'plan') })
    expect(result.current.notice).toBe('permission mode: plan')
  })

  it('fails pending intents on disconnect with an ambiguous-acceptance warning', async () => {
    const { bridge, result } = await opened()
    let rejected!: Promise<unknown>
    await act(async () => { rejected = result.current.send('hello', [], 'ses_1').catch((error: unknown) => error) })
    await act(async () => { bridge.emit({ type: 'connection', connection: disconnected }); await rejected })
    expect(await rejected).toEqual(expect.objectContaining({ message: expect.stringContaining('may have been accepted') }))
    expect(result.current.active?.snapshot.summary.id).toBe('ses_1')
  })

  it('bounds a missing ack without retrying the submission and ignores a late ack for settlement', async () => {
    vi.useFakeTimers()
    const { bridge, result } = await opened()
    let submitted!: DesktopRequest
    bridge.handlers.set('session/submit', async (input) => { submitted = input; return ok({}) })
    let rejected!: Promise<unknown>
    await act(async () => { rejected = result.current.send('hello', [], 'ses_1').catch((error: unknown) => error) })
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); await rejected })
    const error = await rejected
    expect(error).toEqual(expect.objectContaining({ message: expect.stringContaining('Check the session before sending it again') }))
    await act(async () => { bridge.ack(submitted, 11, { kind: 'turnStarted', turn: 'turn_1' }) })
    expect(await rejected).toBe(error)
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/submit')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('workspace snapshots and stream races', () => {
  it('buffers events that arrive before an initial session/open response resolves', async () => {
    const { bridge, result } = await connected()
    const reply = deferred<Result<unknown>>()
    bridge.handlers.set('session/open', () => reply.promise)
    let open!: Promise<string>
    await act(async () => { open = result.current.openSession('ses_1'); bridge.emitFrame(delta(11, ' after snapshot')) })
    expect(result.current.active).toBeNull()
    await act(async () => { reply.resolve(openReply(snapshot())); await open })
    expect(result.current.active?.snapshot.seq).toBe(11)
    expect(assistantText(result.current.active)).toBe('Before after snapshot')
  })

  it('buffers while reopening an existing projection and shares concurrent open requests', async () => {
    const { bridge, result } = await opened()
    const reply = deferred<Result<unknown>>()
    bridge.handlers.set('session/open', () => reply.promise)
    bridge.request.mockClear()
    let first!: Promise<string>, second!: Promise<string>
    await act(async () => {
      first = result.current.openSession('ses_1')
      second = result.current.openSession('ses_1')
      bridge.emitFrame(delta(11, ' retained'))
    })
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/open')).toHaveLength(1)
    expect(assistantText(result.current.active)).toBe('Before')
    await act(async () => { reply.resolve(openReply(snapshot())); await Promise.all([first, second]) })
    expect(assistantText(result.current.active)).toBe('Before retained')
    expect(result.current.active?.snapshot.seq).toBe(11)
    expect(result.current.active?.resync).toBeNull()
  })

  it('reopens after a live gap and preserves newer frames received during recovery', async () => {
    const { bridge, result } = await opened()
    const reply = deferred<Result<unknown>>()
    bridge.handlers.set('session/open', () => reply.promise)
    bridge.request.mockClear()
    await act(async () => { bridge.emitFrame(delta(12, 'gap')) })
    expect(result.current.active?.resync).toEqual({ reason: 'gap', since: 10 })
    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'session/open', params: { selector: { kind: 'byId', id: 'ses_1' }, options: { children: false } } }))
    await act(async () => { bridge.emitFrame(delta(13, ' + live')); reply.resolve(openReply(snapshot('ses_1', 12, 'Repaired'))) })
    expect(result.current.active?.resync).toBeNull()
    expect(result.current.active?.snapshot.seq).toBe(13)
    expect(assistantText(result.current.active)).toBe('Repaired + live')
    expect(result.current.activeId).toBe('ses_1')
  })

  it('reopens after a transport lag marker without treating its seq as applied', async () => {
    const { bridge, result } = await opened()
    const reply = deferred<Result<unknown>>()
    bridge.handlers.set('session/open', () => reply.promise)
    await act(async () => { bridge.emitFrame(frame(40, { type: 'lagged', from: 11, to: 40 })) })
    expect(result.current.active?.snapshot.seq).toBe(10)
    expect(result.current.active?.resync?.reason).toBe('lagged')
    await act(async () => { reply.resolve(openReply(snapshot('ses_1', 40, 'Recovered'))) })
    expect(result.current.active?.snapshot.seq).toBe(40)
    expect(result.current.active?.resync).toBeNull()
  })

  it('does not let an old-stream lag marker invalidate a newer authoritative snapshot', async () => {
    const { bridge, result } = await opened()
    const reply = deferred<Result<unknown>>()
    bridge.handlers.set('session/open', () => reply.promise)
    let open!: Promise<string>
    await act(async () => {
      open = result.current.openSession('ses_1')
      // The previous subscription can finish after reopening has begun. This
      // marker's missed range is already entirely represented in the snapshot.
      bridge.emitFrame(frame(15, { type: 'lagged', from: 11, to: 15 }))
    })
    await act(async () => { reply.resolve(openReply(snapshot('ses_1', 20, 'Authoritative'))); await open })
    expect(result.current.active?.snapshot.seq).toBe(20)
    expect(result.current.active?.resync).toBeNull()
    await act(async () => { bridge.emitFrame(delta(21, ' + live')) })
    expect(assistantText(result.current.active)).toBe('Authoritative + live')
  })

  it('keeps the newest user selection when an earlier open finishes later', async () => {
    const { bridge, result } = await connected()
    const first = deferred<Result<unknown>>(), second = deferred<Result<unknown>>()
    bridge.handlers.set('session/open', (input) => {
      const { selector } = input.params as RpcMethods['session/open']['params']
      return selector.kind === 'byId' && selector.id === 'first' ? first.promise : second.promise
    })
    let openingFirst!: Promise<string>, openingSecond!: Promise<string>
    await act(async () => { openingFirst = result.current.openSession('first'); openingSecond = result.current.openSession('second') })
    await act(async () => { second.resolve(openReply(snapshot('second'))); await openingSecond })
    await act(async () => { first.resolve(openReply(snapshot('first'))); await openingFirst })
    expect(result.current.activeId).toBe('second')
    expect(result.current.sessions.map((entry) => entry.id)).toContain('first')
  })

  it('rejects stale open replies and discards old connection frames after a workspace switch', async () => {
    const { bridge, result } = await connected()
    const reply = deferred<Result<unknown>>()
    bridge.handlers.set('session/open', () => reply.promise)
    let rejected!: Promise<unknown>
    await act(async () => { rejected = result.current.openSession('ses_1').catch((error: unknown) => error) })
    await act(async () => { await result.current.connect('/other') })
    await act(async () => {
      bridge.emitFrame(delta(11, 'stale'), 'connection-1')
      reply.resolve(openReply(snapshot()))
      await rejected
    })
    expect(await rejected).toEqual(new Error('Workspace changed while opening the session.'))
    expect(result.current.active).toBeNull()
    expect(result.current.sessions).toEqual([])
    expect(result.current.connection.workspace).toBe('/other')
  })
})

describe('workspace history and gateway synchronization', () => {
  it('subscribes to gateway events on every connection and routes session create/remove updates', async () => {
    const { bridge, result } = await connected()
    expect(bridge.request).toHaveBeenCalledWith({ connectionId: 'connection-1', method: 'gateway/subscribe', params: {} })
    await act(async () => { bridge.emit({ type: 'rpc', connectionId: 'connection-1', method: 'gateway/event', params: { type: 'sessionCreated', summary: snapshot('external').summary } }) })
    expect(result.current.sessions.map((entry) => entry.id)).toEqual(['external'])
    await act(async () => { bridge.emit({ type: 'rpc', connectionId: 'connection-1', method: 'gateway/event', params: { type: 'sessionRemoved', session: 'external' } }) })
    expect(result.current.sessions).toEqual([])
    await act(async () => { await result.current.connect('/other') })
    expect(bridge.request).toHaveBeenCalledWith({ connectionId: 'connection-2', method: 'gateway/subscribe', params: {} })
  })

  it('refreshes the catalog named by a gateway event', async () => {
    const { bridge, result } = await connected()
    bridge.handlers.set('catalog/read', async () => ok({ kind: 'providers', entries: [{ id: 'codex', label: 'codex', meta: { auth: { kind: 'ready' } } }] }))
    await act(async () => { bridge.emit({ type: 'rpc', connectionId: 'connection-1', method: 'gateway/event', params: { type: 'catalogChanged', kind: 'providers' } }) })
    expect(result.current.catalogs.providers?.entries[0].meta).toEqual({ auth: { kind: 'ready' } })
  })

  it('uses the captured history cursor and reopens on a newer generation instead of staying stuck', async () => {
    const { bridge, result } = await opened()
    bridge.handlers.set('session/history', async () => ok({ items: [], generation: 1 }))
    bridge.handlers.set('session/open', async () => openReply(snapshot('ses_1', 15, 'After compaction', 1)))
    await act(async () => { await result.current.loadHistory() })
    expect(bridge.request).toHaveBeenCalledWith({ connectionId: 'connection-1', method: 'session/history', params: { session: 'ses_1', page: { before: 'ses_1-assistant', limit: 100 } } })
    expect(result.current.active?.snapshot.historyGeneration).toBe(1)
    expect(result.current.active?.snapshot.seq).toBe(15)
    expect(result.current.active?.resync).toBeNull()
    expect(assistantText(result.current.active)).toBe('After compaction')
  })

  it('does not make a history recovery steal selection from another session', async () => {
    const { bridge, result } = await opened()
    const history = deferred<Result<unknown>>()
    bridge.handlers.set('session/history', () => history.promise)
    let loading!: Promise<void>
    await act(async () => { loading = result.current.loadHistory() })
    await act(async () => { await result.current.openSession('second') })
    bridge.handlers.set('session/open', async () => openReply(snapshot('ses_1', 15, 'Recovered', 1)))
    await act(async () => { history.resolve(ok({ items: [], generation: 1 })); await loading })
    expect(result.current.activeId).toBe('second')
    expect(result.current.active?.snapshot.summary.id).toBe('second')
  })

  it('opens browser login through a provider-free log session and refreshes authentication afterward', async () => {
    const { bridge, result } = await connected()
    bridge.handlers.set('session/submit', async (input) => { bridge.ack(input, 11, { kind: 'applied', result: { item: 'login-receipt' } }); return ok({}) })
    bridge.request.mockClear()
    await act(async () => { await result.current.signIn('codex') })
    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'session/open', params: { selector: { kind: 'create', spec: { cwd: '/work', driver: 'log', title: 'Provider setup' } }, options: { children: false } } }))
    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'session/submit', params: expect.objectContaining({ session: 'ses_new', input: { kind: 'action', action: { name: 'login', args: 'codex browser' } } }) }))
    expect(bridge.request.mock.calls.at(-1)?.[0]).toMatchObject({ method: 'catalog/read', params: { kind: 'providers' } })
  })

  it('unsubscribes its desktop listener when unmounted', async () => {
    const { bridge, unmount } = await connected()
    expect(bridge.listeners.size).toBe(1)
    unmount()
    expect(bridge.listeners.size).toBe(0)
  })
})
