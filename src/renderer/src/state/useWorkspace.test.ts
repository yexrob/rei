// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { orderedStartupConnections } from '../../../shared/desktop.fixtures'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BingoDesktopApi, BoundedDelivery, ConnectionState, DesktopEvent, DesktopMethod, DesktopPreferences,
  DesktopRequest, Result
} from '../../../shared/desktop'
import type { Event, Frame, RpcMethods, SessionState } from '../../../shared/rpc'
import { rustInitial } from './fixtures'
import { bufferLimits, frameScheduler, recoveryPolicy, refreshPolicy, useWorkspace } from './useWorkspace'
import { selectStatus } from './session'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
const disconnected: ConnectionState = { hostId: 'host:/work', busy: false, status: 'disconnected', connectionId: null, workspace: '/work', binary: '/bin/bingo' }
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
  const server = { protocol: 1, name: 'fixture', version: 'test', capabilities: { methods: ['session/listHeads', 'session/open', 'session/history', 'session/children', 'session/itemPart', 'session/fieldPart', 'session/eventPart'], notifications: ['eventRef', 'gateway/sessionHead'] } }
  let bounded: ((delivery: BoundedDelivery) => Promise<void>) | undefined
  let generation = 0
  let connection: ConnectionState = disconnected
  const hosts = new Map<string, ConnectionState>()
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
    bootstrap: vi.fn(async () => ok({ version: '0.1.0', platform: 'darwin', preferences, scratchWorkspace: '/scratch', binary: { path: null, source: 'missing' }, connections: [], selection: null, agentPages: [] })),
    connect: vi.fn(async ({ workspace }) => {
      const hostId = `host:${workspace ?? '/scratch'}`, existing = hosts.get(hostId)
      if (existing?.status === 'ready') { connection = existing; return ok(existing) }
      connection = { hostId, busy: false, status: 'connecting', connectionId: `connection-${++generation}`, workspace: workspace ?? '/scratch', binary: '/bin/bingo', server }
      emit({ type: 'connection', connection })
      connection = { ...connection, status: 'ready' }; hosts.set(hostId, connection)
      emit({ type: 'connection', connection })
      return ok(connection)
    }),
    reconnect: vi.fn(async ({ hostId }) => {
      const previous = hosts.get(hostId)!
      emit({ type: 'connection', connection: { ...previous, status: 'disconnected' } })
      connection = { ...previous, connectionId: `connection-${++generation}`, status: 'ready' }; hosts.set(hostId, connection)
      emit({ type: 'connection', connection }); return ok(connection)
    }),
    selectConversation: vi.fn(async () => ok(undefined)), closeHost: vi.fn(async () => ok(undefined)), openAgentPage: vi.fn(async () => ok(undefined)),
    request: request as BingoDesktopApi['request'],
    requestBounded: vi.fn(async ({ transferId, request: input }) => {
      if (!bounded) return { ok: false as const, error: { code: 'NO_CONSUMER', message: 'No bounded consumer.' } }
      const host = [...hosts.values()].find(host => host.connectionId === input.connectionId)!
      const raw = input.method === 'session/listHeads'
        ? handlers.has('session/listHeads') ? await request(input) : await request({ connectionId: input.connectionId, method: 'session/list', params: { filter: { cwd: (input.params as RpcMethods['session/listHeads']['params']).filter?.cwd, limit: 500 } } })
        : input.method === 'session/children' ? ok({ children: [], next: null }) : await request(input)
      if (!raw.ok) return raw
      const value = input.method === 'session/listHeads' && !handlers.has('session/listHeads')
        ? { heads: (raw.value as RpcMethods['session/list']['result']).sessions.map(({ id, cwd, parent, driver, createdAt, updatedAt, busy, title, key, model, provider, messages }) => ({ id, cwd, parent, driver: driver ?? 'model', createdAt, updatedAt, busy: busy ?? false, title, key, model, provider, messages })), next: null }
        : raw.value
      const session = input.method === 'session/open' ? (value as RpcMethods['session/open']['result']).session : input.method === 'session/history' ? (input.params as RpcMethods['session/history']['params']).session : input.method === 'session/children' ? (input.params as RpcMethods['session/children']['params']).parent : null
      await bounded({ kind: 'response', transferId, hostId: host.hostId, connectionId: input.connectionId, session, method: input.method, result: value } as BoundedDelivery)
      return ok({ kind: 'response' as const, transferId, hostId: host.hostId, connectionId: input.connectionId, session, method: input.method, acceptedBytes: 512 })
    }) as BingoDesktopApi['requestBounded'],
    cancelBounded: vi.fn(async () => ok(undefined)),
    readPart: vi.fn(async () => ({ ok: false as const, error: { code: 'UNSUPPORTED', message: 'Part fixture not configured.' } })),
    cancelPart: vi.fn(async () => ok(undefined)), exportReference: vi.fn(async () => ok(false)), cancelExport: vi.fn(async () => ok(undefined)), onBounded: vi.fn(listener => { bounded = listener; return () => { bounded = undefined } }),
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

describe('native connection publication ordering', () => {
  it.each([0, 1, 2])('keeps an invoke-ready snapshot ahead of delayed startup event %s', async index => {
    const { bridge, result } = await connected()
    const connection = result.current.connection
    const states = orderedStartupConnections.map(state => ({ ...state, hostId: connection.hostId, connectionId: state.connectionId === null ? null : connection.connectionId, workspace: connection.workspace, server: connection.server }))
    await act(async () => { bridge.emit({ type: 'connection', connection: states[2] }) })
    expect(result.current.ready).toBe(true)
    const late: ConnectionState = index === 2 ? { ...connection, status: 'disconnected', connectionId: null } : states[index]
    await act(async () => { bridge.emit({ type: 'connection', connection: late }) })
    expect(result.current.connection).toMatchObject({ status: 'ready', connectionId: connection.connectionId, revision: 3 })
    expect(result.current.ready).toBe(true)
    expect(result.current.error).toBe('')
    // A genuinely newer failure still disconnects; stale ready cannot revive it.
    await act(async () => { bridge.emit({ type: 'connection', connection: states[3] }); bridge.emit({ type: 'connection', connection: states[2] }) })
    expect(result.current.hosts[connection.hostId].connection).toMatchObject({ status: 'failed', revision: 4 })
    expect(result.current.ready).toBe(false)
    await act(async () => { bridge.emit({ type: 'connection', connection: { ...states[0], revision: 5, busy: false } }) })
    expect(result.current.hosts[connection.hostId].connection).toMatchObject({ status: 'disconnected', revision: 5, connectionId: null })
  })

  it('does not crash a passive effect whose ready render was invalidated by an earlier layout effect', async () => {
    const bridge = desktop()
    let invalidate = false
    const hook = renderHook(() => {
      const workspace = useWorkspace()
      useLayoutEffect(() => {
        if (!invalidate || workspace.connection.status !== 'ready') return
        invalidate = false
        bridge.emit({ type: 'connection', connection: { ...workspace.connection, status: 'failed', error: { code: 'PROCESS_EXITED', message: 'Stopped before passive effects' } } })
      })
      return workspace
    })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await hook.result.current.connect('/work') })
    expect(hook.result.current.ready).toBe(true)
    invalidate = true
    await act(async () => { bridge.emit({ type: 'connection', connection: { ...hook.result.current.connection, busy: true } }) })
    expect(hook.result.current.ready).toBe(false)
    expect(hook.result.current.hosts['host:/work'].connection.status).toBe('failed')
  })
})

describe('cross-host passive invalidation', () => {
  it('keeps Q projecting frames when P fails between a ready render and passive effects', async () => {
    const bridge = desktop()
    let invalidateP = false
    const hook = renderHook(() => {
      const workspace = useWorkspace()
      useLayoutEffect(() => {
        const p = workspace.hosts['host:/work']?.connection
        if (!invalidateP || p?.status !== 'ready') return
        invalidateP = false
        bridge.emit({ type: 'connection', connection: { ...p, status: 'failed', error: { code: 'PROCESS_EXITED', message: 'P stopped' } } })
      })
      return workspace
    })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await hook.result.current.connect('/work') })
    await act(async () => { await hook.result.current.connect('/other') })
    bridge.handlers.set('session/open', async () => {
      const state = snapshot('q'); state.summary.cwd = '/other'; return openReply(state)
    })
    await act(async () => { await hook.result.current.openSession('q') })
    const q = hook.result.current.connection.connectionId!
    invalidateP = true
    await act(async () => { bridge.emit({ type: 'connection', connection: { ...hook.result.current.hosts['host:/work'].connection, busy: true } }) })
    await act(async () => { bridge.emitFrame(delta(11, ' |Q survives P failure|', 'q'), q) })
    expect(hook.result.current.hosts['host:/work'].connection.status).toBe('failed')
    expect(hook.result.current.connection).toMatchObject({ status: 'ready', connectionId: q })
    expect(assistantText(hook.result.current.active)).toBe('Before |Q survives P failure|')
  })
})

describe('correlated action views', () => {
  it('uses a reusable background log session without selecting or abandoning the unsent thread', async () => {
    const { bridge, result } = await connected()
    let seq = 11
    bridge.handlers.set('session/submit', async (input) => {
      bridge.ack(input, seq++, { kind: 'applied', result: { view: { kind: 'text', text: 'no schedules yet' } } })
      return ok({})
    })
    await act(async () => { await result.current.runAction('model', 'fake/draft-model') })
    await act(async () => {
      expect(await result.current.runActionView('schedule')).toEqual({ kind: 'text', text: 'no schedules yet' })
      await result.current.runActionView('schedule')
    })
    expect(result.current.activeId).toBeNull()
    expect(result.current.active).toBeNull()
    expect(result.current.runtimeSelection.model).toBe('fake/draft-model')
    expect(result.current.loading).toBe(false)
    expect(result.current.commandView).toBeNull()
    const opened = bridge.request.mock.calls.filter(([input]) => input.method === 'session/open')
    expect(opened).toHaveLength(1)
    expect(opened[0][0].params).toMatchObject({ selector: { kind: 'create', spec: { driver: 'log', title: 'Runtime commands' } } })
  })

  it('matches overlapping action outcomes without presenting the page result in the thread', async () => {
    const { bridge, result } = await opened()
    const calls: DesktopRequest[] = []
    bridge.handlers.set('session/submit', async (input) => { calls.push(input); return ok({}) })
    let schedule!: ReturnType<typeof result.current.runActionView>
    let ordinary!: ReturnType<typeof result.current.runAction>
    await act(async () => {
      schedule = result.current.runActionView('schedule')
      ordinary = result.current.runAction('status')
    })
    await act(async () => {
      bridge.ack(calls[1], 11, { kind: 'applied', result: { view: { kind: 'text', text: 'status result' } } })
      bridge.ack(calls[0], 12, { kind: 'applied', result: { view: { kind: 'text', text: 'schedule result' } } })
      await Promise.all([schedule, ordinary])
    })
    expect(await schedule).toEqual({ kind: 'text', text: 'schedule result' })
    expect(await ordinary).toBe('ses_1')
    expect(result.current.commandView).toEqual({ kind: 'text', text: 'status result' })
    expect(calls).toHaveLength(2)
    await act(async () => { bridge.ack(calls[0], 13, { kind: 'applied', result: { view: { kind: 'text', text: 'duplicate schedule result' } } }) })
    expect(result.current.commandView).toEqual({ kind: 'text', text: 'status result' })
  })

  it('does not present a late page result after its request timed out', async () => {
    const { bridge, result } = await opened()
    vi.useFakeTimers()
    let call!: DesktopRequest
    bridge.handlers.set('session/submit', async (input) => { call = input; return ok({}) })
    let request!: Promise<unknown>
    await act(async () => { request = result.current.runActionView('schedule').catch((error: unknown) => error) })
    await act(async () => { await vi.advanceTimersByTimeAsync(30001); await request })
    expect(await request).toBeInstanceOf(Error)
    await act(async () => { bridge.ack(call, 11, { kind: 'applied', result: { view: { kind: 'text', text: 'late schedule result' } } }) })
    expect(result.current.commandView).toBeNull()
  })

  it('rejects the matched failed action instead of reusing an earlier view', async () => {
    const { bridge, result } = await opened()
    bridge.handlers.set('session/submit', async (input) => {
      bridge.ack(input, 11, { kind: 'rejected', error: { code: 'NOT_FOUND', message: 'schedule unavailable' } })
      return ok({})
    })
    await act(async () => { await expect(result.current.runActionView('schedule')).rejects.toThrow('schedule unavailable') })
    expect(result.current.commandView).toBeNull()
  })
})

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
    expect(bridge.api.requestBounded).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ method: 'session/open', params: { selector: { kind: 'create', spec: { cwd: '/work', driver: 'model', provider: 'Road-anti', model: 'family/Model' } }, options: { children: true, maxSnapshotBytes: 4 * 1024 * 1024, treeBackfill: 'liveOnly' } } }) }))
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

  it('finishes thinking and text on the captured host when foreground moves to another project', async () => {
    const { bridge, result } = await connected()
    const wire = deferred<Result<unknown>>()
    bridge.handlers.set('session/submit', async (input) => { bridge.ack(input, 11, { kind: 'applied', result: {} }); return wire.promise })
    await act(async () => { await result.current.runAction('think', 'high'); await result.current.openSession() })
    let sent!: Promise<unknown>
    await act(async () => { sent = result.current.send('Do not misroute this draft', [], 'ses_new').catch((error: unknown) => error) })
    await act(async () => { await result.current.connect('/other') })
    await act(async () => { wire.resolve(ok({})); await sent })
    expect(await sent).toBe('ses_new')
    const submissions = bridge.request.mock.calls.filter(([input]) => input.method === 'session/submit')
    expect(submissions).toHaveLength(2)
    expect(new Set(submissions.map(([input]) => input.connectionId))).toEqual(new Set(['connection-1']))
    expect(result.current.activeId).toBeNull()
    expect(result.current.connection.workspace).toBe('/other')
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
    vi.mocked(bridge.api.bootstrap).mockResolvedValue(ok({ version: '0.1.0', platform: 'darwin', preferences, scratchWorkspace: '/scratch', binary: { path: '/bin/bingo', source: 'bundled' }, connections: [], selection: null, agentPages: [] }))
    const { result } = renderHook(() => useWorkspace())
    await act(async () => { await Promise.resolve() })
    expect(bridge.api.connect).toHaveBeenCalledWith({ workspace: undefined, binary: '/bin/bingo' })
    expect(bridge.api.chooseWorkspace).not.toHaveBeenCalled()
    expect(result.current.connection.workspace).toBe('/scratch')
    expect(result.current.connection.status).toBe('ready')
    expect(result.current.error).toBe('')
    expect(bridge.api.savePreferences).toHaveBeenCalledWith({ workspace: null })
    expect(bridge.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'session/list', params: { filter: { cwd: '/scratch', limit: 500 } } }))
  })

  it('uses a saved project at startup rather than personal space', async () => {
    const bridge = desktop()
    vi.mocked(bridge.api.bootstrap).mockResolvedValue(ok({ version: '0.1.0', platform: 'darwin', preferences: { ...preferences, workspace: '/saved' }, scratchWorkspace: '/scratch', binary: { path: '/bin/bingo', source: 'bundled' }, connections: [], selection: null, agentPages: [] }))
    const { result } = renderHook(() => useWorkspace())
    await act(async () => { await Promise.resolve() })
    expect(bridge.api.connect).toHaveBeenCalledWith({ workspace: '/saved', binary: '/bin/bingo' })
    expect(bridge.api.chooseWorkspace).not.toHaveBeenCalled()
    expect(result.current.connection.status).toBe('ready')
    expect(result.current.error).toBe('')
  })

  it('does not attempt to connect or force a folder picker when no binary was found', async () => {
    const bridge = desktop()
    renderHook(() => useWorkspace())
    await act(async () => { await Promise.resolve() })
    expect(bridge.api.connect).not.toHaveBeenCalled()
    expect(bridge.api.chooseWorkspace).not.toHaveBeenCalled()
  })
})

describe('workspace connection errors', () => {
  it('rejects pending intents during a targeted reconnect and retains real per-session uncertainty', async () => {
    const { bridge, result } = await opened()
    let submitted!: DesktopRequest
    bridge.handlers.set('session/submit', async (input) => { submitted = input; return ok({}) })
    let rejected!: Promise<unknown>
    await act(async () => { rejected = result.current.send('hello', [], 'ses_1').catch((error: unknown) => error) })
    await act(async () => { await result.current.reconnect(); await rejected })
    expect(await rejected).toEqual(expect.objectContaining({ message: expect.stringContaining('request may have been accepted') }))
    expect(result.current.error).toContain('request may have been accepted')
    expect(result.current.connection.status).toBe('ready')
    await act(async () => {
      bridge.ack(submitted, 11, { kind: 'turnStarted', turn: 'old-turn' })
      bridge.emitFrame(frame(12, { type: 'notice', level: 'error', code: 'OLD', text: 'Old transport notice' }), submitted.connectionId)
    })
    expect(result.current.active?.snapshot.seq).toBe(10)
    expect(result.current.error).toContain('request may have been accepted')
  })

  it.each(['failed', 'disconnected'] as const)('reports a real %s event after the connect reset while the IPC reply is pending', async (status) => {
    const { bridge, result } = await connected()
    const reply = deferred<Result<ConnectionState>>()
    const next = { ...result.current.connection, status: 'connecting' as const, connectionId: 'replacement' }
    vi.mocked(bridge.api.reconnect).mockImplementationOnce(() => {
      bridge.emit({ type: 'connection', connection: disconnected })
      bridge.emit({ type: 'connection', connection: next })
      return reply.promise
    })
    let connecting!: Promise<unknown>
    await act(async () => { connecting = result.current.reconnect().catch((error: unknown) => error) })
    expect(result.current.error).toBe('')
    const failure: ConnectionState = status === 'failed'
      ? { ...next, status, error: { code: 'PROCESS_EXITED', message: 'Runtime process exited' } }
      : disconnected
    await act(async () => { bridge.emit({ type: 'connection', connection: failure }) })
    expect(result.current.error).toBe(status === 'failed' ? 'Runtime process exited' : 'bingo is not connected. Reconnect to continue.')
    await act(async () => { reply.resolve({ ok: false, error: { code: 'CONNECT_FAILED', message: 'Cannot start runtime' } }); await connecting })
    expect(result.current.error).toBe('Cannot start runtime')
  })

  it('does not suppress an error-bearing first disconnect during connect', async () => {
    const { bridge, result } = await connected()
    const reply = deferred<Result<ConnectionState>>()
    vi.mocked(bridge.api.connect).mockImplementationOnce(() => {
      bridge.emit({ type: 'connection', connection: { ...disconnected, error: { code: 'CONNECTION', message: 'Transport lost' } } })
      return reply.promise
    })
    let connecting!: Promise<void>
    await act(async () => { connecting = result.current.connect('/work') })
    expect(result.current.error).toBe('Transport lost')
    await act(async () => { reply.resolve({ ok: false, error: { code: 'CONNECT_FAILED', message: 'Cannot connect' } }); await connecting })
  })

  it('reports unsolicited disconnects after a successful connect and after a rejected connect without lifecycle events', async () => {
    const { bridge, result } = await connected()
    await act(async () => { bridge.emit({ type: 'connection', connection: disconnected }) })
    expect(result.current.error).toBe('bingo is not connected. Reconnect to continue.')
    vi.mocked(bridge.api.connect).mockResolvedValueOnce({ ok: false, error: { code: 'CANCELLED', message: 'Reconnect cancelled' } })
    await act(async () => { await result.current.connect('/work') })
    expect(result.current.error).toBe('Reconnect cancelled')
    await act(async () => { bridge.emit({ type: 'connection', connection: disconnected }) })
    expect(result.current.error).toBe('Reconnect cancelled')
  })

  it('preserves application notices and reported errors across ready events', async () => {
    const { bridge, result } = await opened()
    const ready = result.current.connection
    await act(async () => {
      bridge.emitFrame(frame(11, { type: 'notice', level: 'error', code: 'AUTH', text: 'Provider sign-in failed' }))
      bridge.emit({ type: 'connection', connection: ready })
    })
    expect(result.current.error).toBe('Provider sign-in failed')
    await act(async () => {
      result.current.report(new Error('Cannot save preferences'))
      bridge.emit({ type: 'connection', connection: ready })
    })
    expect(result.current.error).toBe('Cannot save preferences')
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

  it('buffers while explicitly reopening an existing projection and shares concurrent open requests', async () => {
    const { bridge, result } = await opened()
    const reply = deferred<Result<unknown>>()
    bridge.handlers.set('session/open', () => reply.promise)
    bridge.request.mockClear()
    let first!: Promise<string>, second!: Promise<string>
    await act(async () => {
      first = result.current.openSession('ses_1', true)
      second = result.current.openSession('ses_1', true)
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
    expect(bridge.api.requestBounded).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ method: 'session/open', params: { selector: { kind: 'byId', id: 'ses_1' }, options: { children: true, maxSnapshotBytes: 4 * 1024 * 1024, treeBackfill: 'liveOnly' } } }) }))
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

  it('finishes a background host open without stealing the newer foreground project', async () => {
    const { bridge, result } = await connected()
    const reply = deferred<Result<unknown>>()
    bridge.handlers.set('session/open', () => reply.promise)
    let opening!: Promise<string>
    await act(async () => { opening = result.current.openSession('ses_1') })
    await act(async () => { await result.current.connect('/other') })
    await act(async () => {
      bridge.emitFrame(delta(11, 'old host'), 'connection-1')
      reply.resolve(openReply(snapshot()))
      await opening
    })
    expect(await opening).toBe('ses_1')
    expect(result.current.active).toBeNull()
    expect(result.current.sessions).toEqual([])
    expect(result.current.connection.workspace).toBe('/other')
    expect(result.current.hosts['host:/work'].projections.ses_1).toBeDefined()
  })
})

describe('workspace history and gateway synchronization', () => {
  it('subscribes to gateway events on every connection and routes session create/remove updates', async () => {
    const { bridge, result } = await connected()
    expect(bridge.request).toHaveBeenCalledWith({ connectionId: 'connection-1', method: 'gateway/subscribe', params: { maxBytes: 4 * 1024 * 1024 } })
    await act(async () => { bridge.emit({ type: 'rpc', connectionId: 'connection-1', method: 'gateway/event', params: { type: 'sessionCreated', summary: snapshot('external').summary } }) })
    expect(result.current.sessions.map((entry) => entry.id)).toEqual(['external'])
    await act(async () => { bridge.emit({ type: 'rpc', connectionId: 'connection-1', method: 'gateway/event', params: { type: 'sessionRemoved', session: 'external' } }) })
    expect(result.current.sessions).toEqual([])
    await act(async () => { await result.current.connect('/other') })
    expect(bridge.request).toHaveBeenCalledWith({ connectionId: 'connection-2', method: 'gateway/subscribe', params: { maxBytes: 4 * 1024 * 1024 } })
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
    expect(bridge.api.requestBounded).toHaveBeenCalledWith(expect.objectContaining({ request: { connectionId: 'connection-1', method: 'session/history', params: { session: 'ses_1', page: { before: 'ses_1-assistant', limit: 100, maxBytes: 4 * 1024 * 1024, generation: 0 } } } }))
    expect(result.current.active?.snapshot.historyGeneration).toBe(1)
    expect(result.current.active?.snapshot.seq).toBe(15)
    expect(result.current.active?.resync).toBeNull()
    expect(assistantText(result.current.active)).toBe('After compaction')
  })

  it('recovers a bounded stale cursor after the server drops its item without replaying older pages', async () => {
    const { bridge, result } = await opened()
    bridge.handlers.set('session/history', async () => ({ ok: false, error: { code: 'STALE_GENERATION', message: 'The old cursor was removed.' } }))
    bridge.handlers.set('session/open', async () => openReply(snapshot('ses_1', 15, 'Authoritative after cursor loss', 1)))
    await act(async () => { await result.current.loadHistory() })
    expect(result.current.active?.snapshot.seq).toBe(15)
    expect(result.current.active?.snapshot.historyGeneration).toBe(1)
    expect(assistantText(result.current.active)).toBe('Authoritative after cursor loss')
    expect(bridge.api.requestBounded).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ method: 'session/history', params: expect.objectContaining({ page: expect.objectContaining({ before: 'ses_1-assistant', maxBytes: 4 * 1024 * 1024 }) }) }) }))
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
    expect(bridge.api.requestBounded).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ method: 'session/open', params: { selector: { kind: 'create', spec: { cwd: '/work', driver: 'log', title: 'Provider setup' } }, options: { children: false, maxSnapshotBytes: 4 * 1024 * 1024 } } }) }))
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

const childSnapshot = (id = 'child'): SessionState => ({ ...snapshot(id), summary: { ...snapshot(id).summary, key: `agent/ses_1/${id}`, parent: { session: 'ses_1' } } })
const treeFrame = (seq: number, event: Event, session = 'child'): Frame => ({ ...frame(seq, event, session), root: 'ses_1' })

describe('journal-driven collaboration subscriptions', () => {
  it('opens the main tree and hydrates sparse child replay without opening or selecting children', async () => {
    const { bridge, result } = await opened()
    expect(bridge.api.requestBounded).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ method: 'session/open', params: { selector: { kind: 'byId', id: 'ses_1' }, options: { children: true, maxSnapshotBytes: 4 * 1024 * 1024, treeBackfill: 'liveOnly' } } }) }))
    bridge.request.mockClear()
    const child = childSnapshot()
    await act(async () => {
      bridge.emitFrame(treeFrame(1, { type: 'sessionUpdated', summary: child.summary }))
      bridge.emitFrame(treeFrame(4, { type: 'itemCompleted', item: { ...child.items[0], status: 'completed' } }))
      bridge.emitFrame(treeFrame(8, { type: 'extension', plugin: 'bingo.rooms', kind: 'members', payload: { members: ['parent', 'child'] } }, 'room'))
      bridge.emitFrame(treeFrame(1, { type: 'sessionUpdated', summary: { ...child.summary, id: 'room', driver: 'log', title: 'review', key: 'rooms/ses_1/review' } }, 'room'))
    })
    expect(result.current.activeId).toBe('ses_1')
    expect(result.current.projections.child.snapshot.seq).toBe(4)
    expect(result.current.projections.child.resync).toBeNull()
    expect(result.current.projections.room.snapshot.extensions?.['bingo.rooms'].members).toEqual({ members: ['parent', 'child'] })
    expect(result.current.collaboration.entries.map((entry) => entry.id)).toEqual(['ses_1', 'child', 'room'])
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/open')).toHaveLength(0)
  })

  it('discovers gateway descendants, isolates background notices, and routes child actions by session', async () => {
    const { bridge, result } = await opened()
    const child = childSnapshot()
    await act(async () => {
      result.current.report(new Error('Parent error'))
      bridge.emit({ type: 'rpc', connectionId: 'connection-1', method: 'gateway/event', params: { type: 'sessionCreated', summary: child.summary } })
      bridge.emitFrame(treeFrame(1, { type: 'sessionUpdated', summary: child.summary }))
      bridge.emitFrame(treeFrame(2, { type: 'notice', level: 'error', code: 'CHILD', text: 'Child failure' }))
    })
    expect(result.current.error).toBe('Parent error')
    bridge.handlers.set('session/open', async () => openReply(child))
    await act(async () => { await result.current.openSession('child') })
    expect(result.current.error).toBe('Child failure')
    let seq = 10
    bridge.handlers.set('session/submit', async (input) => { bridge.ack(input, ++seq, { kind: 'applied', result: {} }); return ok({}) })
    bridge.handlers.set('session/interrupt', async (input) => { bridge.ack(input, ++seq, { kind: 'applied', result: {} }); return ok({}) })
    await act(async () => { await result.current.runAction('model', 'fake/new'); await result.current.runAction('think', 'high'); await result.current.interrupt() })
    const writes = bridge.request.mock.calls.filter(([input]) => input.method === 'session/submit' || input.method === 'session/interrupt')
    expect(writes.map(([input]) => (input.params as { session: string }).session)).toEqual(['child', 'child', 'child'])
    expect(result.current.collaboration.rootId).toBe('ses_1')
  })

  it('keeps a selected child direct stream authoritative over duplicate ancestor replay', async () => {
    const { bridge, result } = await opened()
    bridge.handlers.set('session/open', async () => openReply(childSnapshot()))
    await act(async () => { await result.current.openSession('child') })
    await act(async () => {
      bridge.emitFrame({ ...delta(12, 'duplicate tree'), root: 'ses_1', session: 'child', event: { type: 'itemDelta', item: 'child-assistant', kind: 'text', n: 0, data: 'duplicate tree' } })
      bridge.emitFrame(delta(11, ' direct', 'child'))
    })
    expect(assistantText(result.current.active)).toBe('Before direct')
    expect(result.current.active?.resync).toBeNull()
  })

  it('attaches a missing main ancestor once when navigation starts at a child', async () => {
    const { bridge, result } = await connected()
    bridge.handlers.set('session/open', async (input) => {
      const { selector } = input.params as RpcMethods['session/open']['params']
      return openReply(selector.kind === 'byId' && selector.id === 'child' ? childSnapshot() : snapshot())
    })
    await act(async () => { await result.current.openSession('child') })
    expect(result.current.activeId).toBe('child')
    expect(result.current.collaboration.rootId).toBe('ses_1')
    const opens = bridge.request.mock.calls.filter(([input]) => input.method === 'session/open')
    expect(opens).toHaveLength(2)
    expect(opens[1][0].params).toMatchObject({ selector: { id: 'ses_1' }, options: { children: true } })
    await act(async () => { bridge.emitFrame(delta(11, ' root')) })
    expect(result.current.activeId).toBe('child')
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/open')).toHaveLength(2)
  })

  it('reconnects the selected child and its root tree using a fresh connection epoch', async () => {
    const { bridge, result } = await connected()
    bridge.handlers.set('session/open', async (input) => {
      const { selector } = input.params as RpcMethods['session/open']['params']
      return openReply(selector.kind === 'byId' && selector.id === 'child' ? childSnapshot() : snapshot())
    })
    await act(async () => { await result.current.openSession('child') })
    bridge.request.mockClear()
    await act(async () => { await result.current.reconnect() })
    expect(result.current.activeId).toBe('child')
    expect(result.current.collaboration.rootId).toBe('ses_1')
    const opens = bridge.request.mock.calls.filter(([input]) => input.method === 'session/open')
    expect(opens).toHaveLength(2)
    expect(opens.every(([input]) => input.connectionId === 'connection-2')).toBe(true)
    await act(async () => { bridge.emitFrame(delta(11, ' old epoch', 'child'), 'connection-1') })
    expect(assistantText(result.current.active)).toBe('Before')
  })

  it('keeps gateway creations arriving during session/list and tombstones removed replay', async () => {
    const { bridge, result } = await connected()
    const list = deferred<Result<unknown>>()
    bridge.handlers.set('session/list', () => list.promise)
    let reconnect!: Promise<void>
    await act(async () => { reconnect = result.current.connect('/other') })
    const child = childSnapshot(); child.summary.cwd = '/other'
    await act(async () => {
      bridge.emit({ type: 'rpc', connectionId: 'connection-2', method: 'gateway/event', params: { type: 'sessionCreated', summary: child.summary } })
      list.resolve(ok({ sessions: [{ ...snapshot().summary, cwd: '/other' }] }))
      await reconnect
    })
    expect(result.current.sessions.map((summary) => summary.id)).toContain('child')
    await act(async () => {
      bridge.emit({ type: 'rpc', connectionId: 'connection-2', method: 'gateway/event', params: { type: 'sessionRemoved', session: 'child' } })
      bridge.emitFrame(treeFrame(1, { type: 'sessionUpdated', summary: child.summary }))
    })
    expect(result.current.sessions.map((summary) => summary.id)).not.toContain('child')
    expect(result.current.projections.child).toBeUndefined()
  })

  it('marks an explicit tree lag unavailable without waking a stored child', async () => {
    const { bridge, result } = await opened()
    await act(async () => { bridge.emitFrame(treeFrame(1, { type: 'sessionUpdated', summary: childSnapshot().summary })) })
    bridge.request.mockClear()
    await act(async () => { bridge.emitFrame(treeFrame(20, { type: 'lagged', from: 2, to: 20 })) })
    expect(result.current.projections.child.resync?.reason).toBe('lagged')
    expect(result.current.collaboration.entries.find((entry) => entry.id === 'child')?.activity).toBeNull()
    expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/open')).toHaveLength(0)
  })

  it('clears context errors on a new draft but preserves ongoing transport failure', async () => {
    const { bridge, result } = await opened()
    await act(async () => { result.current.report('Old creation error'); result.current.newSession() })
    expect(result.current.error).toBe('')
    await act(async () => { bridge.emit({ type: 'connection', connection: { ...result.current.connection, status: 'failed', error: { code: 'CONNECTION', message: 'Transport lost' } } }); result.current.newSession() })
    expect(result.current.error).toBe('Transport lost')
  })
})

describe('streamed frame rendering and recovery bounds', () => {
  it('folds a burst of frames into one render and keeps the session list identity while the summary is unchanged', async () => {
    const bridge = desktop()
    let renders = 0
    const { result } = renderHook(() => { renders += 1; return useWorkspace() })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await result.current.connect('/work') })
    await act(async () => { await result.current.openSession('ses_1') })
    const sessions = result.current.sessions, hosts = result.current.hosts, started = renders
    const spy = vi.spyOn(frameScheduler, 'schedule')
    await act(async () => { for (let seq = 11; seq <= 40; seq += 1) bridge.emitFrame(delta(seq, '.')) })
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
    expect(renders - started).toBe(1)
    expect(assistantText(result.current.active)).toBe(`Before${'.'.repeat(30)}`)
    expect(result.current.sessions).toBe(sessions)
    expect(result.current.hosts).not.toBe(hosts)
    await act(async () => { bridge.emitFrame(frame(41, { type: 'sessionUpdated', summary: { ...snapshot().summary, title: 'Renamed' } })) })
    expect(result.current.sessions).not.toBe(sessions)
    expect(result.current.sessions[0].title).toBe('Renamed')
    const renamed = result.current.sessions
    await act(async () => { bridge.emitFrame(frame(42, { type: 'sessionUpdated', summary: { ...snapshot().summary, title: 'Renamed' } })) })
    expect(result.current.sessions).toBe(renamed)
  })

  it('drops an overflowing in-flight buffer and resyncs the opened session instead of growing without bound', async () => {
    const { bridge, result } = await connected()
    const reply = deferred<Result<unknown>>()
    bridge.handlers.set('session/open', () => reply.promise)
    const limits = { ...bufferLimits }
    bufferLimits.session = 5
    try {
      let open!: Promise<string>
      await act(async () => { open = result.current.openSession('ses_1'); for (let seq = 11; seq <= 30; seq += 1) bridge.emitFrame(delta(seq, '.')) })
      bridge.handlers.set('session/open', async () => openReply(snapshot('ses_1', 30, 'Recovered')))
      await act(async () => { reply.resolve(openReply(snapshot())); await open })
      await act(async () => { await Promise.resolve() })
      expect(bridge.api.requestBounded).toHaveBeenCalledTimes(3)
      expect(result.current.active?.resync).toBeNull()
      expect(assistantText(result.current.active)).toBe('Recovered')
    } finally { Object.assign(bufferLimits, limits) }
  })

  it('evicts the largest buffer when the epoch-wide cap is reached and keeps replaying the rest', async () => {
    const { bridge, result } = await connected()
    const reply = deferred<Result<unknown>>()
    bridge.handlers.set('session/open', () => reply.promise)
    const limits = { ...bufferLimits }
    bufferLimits.total = 6
    try {
      let open!: Promise<string>
      await act(async () => {
        open = result.current.openSession('ses_1')
        for (let seq = 1; seq <= 4; seq += 1) bridge.emitFrame(delta(seq, '.', 'other'))
        for (let seq = 11; seq <= 13; seq += 1) bridge.emitFrame(delta(seq, String(seq)))
      })
      await act(async () => { reply.resolve(openReply(snapshot())); await open })
      expect(result.current.active?.resync).toBeNull()
      expect(assistantText(result.current.active)).toBe('Before111213')
    } finally { Object.assign(bufferLimits, limits) }
  })

  it('retries a failed gap recovery with backoff, then surfaces a failed state that a manual reopen clears', async () => {
    const { bridge, result } = await opened()
    const policy = { ...recoveryPolicy }
    Object.assign(recoveryPolicy, { backoff: 1 })
    try {
      bridge.handlers.set('session/open', async () => ({ ok: false as const, error: { code: 'UNAVAILABLE', message: 'Runtime busy.' } }))
      bridge.request.mockClear()
      await act(async () => { bridge.emitFrame(delta(12, 'gap')) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
      expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/open')).toHaveLength(3)
      expect(result.current.active?.resync).toMatchObject({ reason: 'gap', since: 10, failed: true })
      expect(selectStatus(result.current.active!)).toBe('failed')
      expect(result.current.error).toMatch(/recovery failed after 3 attempts: Runtime busy/)
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
      expect(bridge.request.mock.calls.filter(([input]) => input.method === 'session/open')).toHaveLength(3)
      bridge.handlers.set('session/open', async () => openReply(snapshot('ses_1', 12, 'Repaired')))
      await act(async () => { await result.current.openSession('ses_1') })
      expect(result.current.active?.resync).toBeNull()
      expect(assistantText(result.current.active)).toBe('Repaired')
    } finally { Object.assign(recoveryPolicy, policy) }
  })

  it('coalesces sessionHead bursts into one trailing scan and reruns once for heads seen mid-scan', async () => {
    const { bridge, result } = await connected()
    const policy = { ...refreshPolicy }
    Object.assign(refreshPolicy, { debounce: 5 })
    try {
      const gate = deferred<void>()
      let scans = 0
      bridge.handlers.set('session/list', async () => { scans += 1; if (scans === 1) await gate.promise; return ok({ sessions: [] }) })
      const head = () => bridge.emit({ type: 'rpc', connectionId: result.current.connection.connectionId!, method: 'gateway/sessionHead', params: { session: 'ses_1' } })
      await act(async () => { for (let index = 0; index < 20; index += 1) head() })
      expect(scans).toBe(0)
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(scans).toBe(1)
      await act(async () => { head(); head(); head(); await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(scans).toBe(1)
      await act(async () => { gate.resolve(); await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(scans).toBe(2)
      expect(result.current.hosts[result.current.connection.hostId].listComplete).toBe(true)
    } finally { Object.assign(refreshPolicy, policy) }
  })

  it('renders on the next animation frame outside tests, with a timer fallback for hidden windows', () => {
    vi.useFakeTimers()
    vi.stubEnv('MODE', 'production')
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    try {
      const flush = vi.fn()
      frameScheduler.schedule(flush)
      expect(flush).not.toHaveBeenCalled()
      frames[0](0); vi.runAllTimers()
      expect(flush).toHaveBeenCalledTimes(1)
      const hidden = vi.fn()
      frameScheduler.schedule(hidden)
      vi.advanceTimersByTime(100)
      expect(hidden).toHaveBeenCalledTimes(1)
      frames[1](0)
      expect(hidden).toHaveBeenCalledTimes(1)
      const cancelled = vi.fn()
      frameScheduler.schedule(cancelled)()
      frames[2](0); vi.runAllTimers()
      expect(cancelled).not.toHaveBeenCalled()
    } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() }
  })
})
