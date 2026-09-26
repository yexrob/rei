// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BingoDesktopApi, BoundedDelivery, ConnectionState, DesktopEvent, DesktopRequest, Result } from '../../../shared/desktop'
import { hostA, hostB, multiHostBootstrap, selectionA, selectionB, restartedHostA, rendererInvalidated, rejectedSelections, pageA, pageB } from '../../../shared/desktop.fixtures'
import type { Frame, RpcMethods, SessionState } from '../../../shared/rpc'
import { rustInitial } from './fixtures'
import { useWorkspace } from './useWorkspace'

const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
const time = '2026-09-22T00:00:00Z'
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
const state = (id: string, cwd: string): SessionState => ({ ...rustInitial, seq: 0, summary: { ...rustInitial.summary, id, cwd, title: id }, items: [] })
const item = (id: string, text: string): SessionState['items'][number] => ({ id, status: 'completed', startedAt: time, body: { kind: 'assistant', text } })
function bridge() {
  const listeners = new Set<(event: DesktopEvent) => void>()
  const server = { protocol: 1, name: 'fixture', version: 'test', capabilities: { methods: ['session/listHeads', 'session/open', 'session/history', 'session/children', 'session/itemPart', 'session/fieldPart', 'session/eventPart'], notifications: ['eventRef', 'gateway/sessionHead'] } }
  const connections: Record<string, ConnectionState> = { [hostA.hostId]: { ...hostA, server }, [hostB.hostId]: { ...hostB, server } }
  let bounded: ((delivery: BoundedDelivery) => Promise<void>) | undefined
  const emit = (event: DesktopEvent) => listeners.forEach(listener => listener(event))
  const request = vi.fn(async (input: DesktopRequest): Promise<Result<unknown>> => {
    const host = Object.values(connections).find(h => h.connectionId === input.connectionId)!
    if (input.method === 'session/list') return ok({ sessions: [state(host.hostId === hostA.hostId ? 'session-a' : 'session-b', host.workspace!).summary] })
    if (input.method === 'catalog/read') return ok({ kind: (input.params as RpcMethods['catalog/read']['params']).kind, entries: [] })
    if (input.method === 'session/open') { const p = input.params as RpcMethods['session/open']['params']; const id = p.selector.kind === 'byId' ? p.selector.id : `${host.hostId}-created`; return ok({ session: id, snapshot: state(id, host.workspace!) }) }
    return ok({})
  })
  const api: BingoDesktopApi = {
    bootstrap: vi.fn(async () => ok({ ...multiHostBootstrap, connections: Object.values(connections) })), connect: vi.fn(async ({ workspace }) => ok(connections[workspace === hostA.workspace ? hostA.hostId : hostB.hostId])),
    reconnect: vi.fn(async () => { const next = { ...restartedHostA, server }; connections[hostA.hostId] = next; emit({ type: 'connection', connection: next }); return ok(next) }),
    closeHost: vi.fn(async target => { const connection = { ...connections[target.hostId], status: 'disconnected' as const, connectionId: null, busy: false }; connections[target.hostId] = connection; emit({ type: 'connection', connection }); return ok(undefined) }),
    selectConversation: vi.fn(async () => ok(undefined)), openAgentPage: vi.fn(async () => ok(undefined)),
    request: request as BingoDesktopApi['request'],
    requestBounded: vi.fn(async ({ transferId, request: input }) => {
      if (!bounded) return { ok: false as const, error: { code: 'NO_CONSUMER', message: 'No bounded consumer.' } }
      const host = Object.values(connections).find(connection => connection.connectionId === input.connectionId)!
      const raw = input.method === 'session/listHeads'
        ? await request({ connectionId: input.connectionId, method: 'session/list', params: { filter: { cwd: (input.params as RpcMethods['session/listHeads']['params']).filter?.cwd, limit: 500 } } })
        : input.method === 'session/children' ? ok({ children: [], next: null }) : await request(input)
      if (!raw.ok) return raw
      const value = input.method === 'session/listHeads'
        ? { heads: (raw.value as RpcMethods['session/list']['result']).sessions.map(({ id, cwd, parent, driver, createdAt, updatedAt, busy, title, key, model, provider, messages }) => ({ id, cwd, parent, driver: driver ?? 'model', createdAt, updatedAt, busy: busy ?? false, title, key, model, provider, messages })), next: null }
        : raw.value
      const session = input.method === 'session/open' ? (value as RpcMethods['session/open']['result']).session : input.method === 'session/history' ? (input.params as RpcMethods['session/history']['params']).session : input.method === 'session/children' ? (input.params as RpcMethods['session/children']['params']).parent : null
      await bounded({ kind: 'response', transferId, hostId: host.hostId, connectionId: input.connectionId, session, method: input.method, result: value } as BoundedDelivery)
      return ok({ kind: 'response' as const, transferId, hostId: host.hostId, connectionId: input.connectionId, session, method: input.method, acceptedBytes: 512 })
    }) as BingoDesktopApi['requestBounded'],
    cancelBounded: vi.fn(async () => ok(undefined)),
    readPart: vi.fn(async () => ({ ok: false as const, error: { code: 'UNSUPPORTED', message: 'Part fixture not configured.' } })),
    cancelPart: vi.fn(async () => ok(undefined)), exportReference: vi.fn(async () => ok(false)), cancelExport: vi.fn(async () => ok(undefined)), onBounded: vi.fn(listener => { bounded = listener; return () => { bounded = undefined } }),
    onEvent: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    savePreferences: vi.fn(async patch => ok({ ...multiHostBootstrap.preferences, ...patch })), chooseWorkspace: vi.fn(async () => ok(null)), chooseBinary: vi.fn(async () => ok(null)), chooseImages: vi.fn(async () => ok([])), openExternal: vi.fn(async () => ok(undefined)), exportText: vi.fn(async () => ok(true)), deleteSession: vi.fn(async () => ok(false)), configureProvider: vi.fn(async () => ok(undefined))
  }
  window.bingoDesktop = api
  return { api, request, emit, connections, deliverBounded: (delivery: BoundedDelivery) => bounded!(delivery), frame: (connectionId: string, params: Frame) => emit({ type: 'rpc', connectionId, method: 'event', params }) }
}
afterEach(() => { cleanup(); localStorage.clear() })
async function setup() { const b = bridge(); const hook = renderHook(() => useWorkspace()); await waitFor(() => expect(hook.result.current.activeId).toBe('session-b')); return { ...b, ...hook } }

describe('multi-host renderer ownership', () => {
  it('does not let a late bootstrap selection override a foreground choice made while loading', async () => {
    const b = bridge(), boot = deferred<Result<typeof multiHostBootstrap>>()
    vi.mocked(b.api.bootstrap).mockImplementationOnce(() => boot.promise)
    const { result } = renderHook(() => useWorkspace())
    await act(async () => { await result.current.connect(hostB.workspace!, hostB.binary!) })
    await act(async () => b.emit({ type: 'agent-page', page: { ...pageB, status: 'opened' } }))
    await act(async () => { boot.resolve(ok({ ...multiHostBootstrap, selection: selectionA })); await boot.promise })
    await waitFor(() => expect(result.current.hosts[hostA.hostId]).toBeDefined())
    expect(result.current.agentPages.find(page => page.hostId === hostB.hostId)?.status).toBe('opened')
    expect(result.current.target?.hostId).toBe(hostB.hostId)
    expect(vi.mocked(b.api.selectConversation).mock.calls.at(-1)?.[0]?.hostId).toBe(hostB.hostId)
  })
  it('does not show a stale bootstrap failure over a successfully chosen project', async () => {
    const b = bridge(), boot = deferred<Result<typeof multiHostBootstrap>>()
    vi.mocked(b.api.bootstrap).mockImplementationOnce(() => boot.promise)
    const { result } = renderHook(() => useWorkspace())
    await act(async () => { await result.current.connect(hostB.workspace!, hostB.binary!) })
    await act(async () => { boot.resolve({ ok: false, error: { code: 'STALE_BOOT', message: 'Old bootstrap failed' } }); await boot.promise })
    expect(result.current.target?.hostId).toBe(hostB.hostId)
    expect(result.current.error).toBe('')
  })
  it('ensures the saved project after reload when retained registry hosts are all disconnected', async () => {
    const b = bridge()
    vi.mocked(b.api.bootstrap).mockResolvedValue(ok({ ...multiHostBootstrap, selection: null, connections: [{ ...hostA, status: 'disconnected', connectionId: null }, { ...hostB, status: 'disconnected', connectionId: null }], preferences: { ...multiHostBootstrap.preferences, workspace: hostA.workspace } }))
    const { result } = renderHook(() => useWorkspace())
    await waitFor(() => expect(b.api.connect).toHaveBeenCalledWith({ workspace: hostA.workspace, binary: multiHostBootstrap.binary.path }))
    await waitFor(() => expect(result.current.target).toEqual({ hostId: hostA.hostId, connectionId: hostA.connectionId, sessionId: null }))
    expect(b.request.mock.calls.some(([call]) => call.method === 'session/submit')).toBe(false)
  })
  it('dismisses connection admission errors even with an existing preview', async () => {
    const { result, api } = await setup()
    vi.mocked(api.connect).mockResolvedValueOnce({ ok: false, error: { code: 'HOST_LIMIT', message: 'Eight projects are already connected.' } })
    await act(async () => { await result.current.connect('/approved/ninth') })
    expect(result.current.error).toBe('Eight projects are already connected.')
    await act(async () => result.current.setError(''))
    expect(result.current.error).toBe('')
  })
  it('dismisses a global invalidation without erasing an independent session error', async () => {
    const { result, emit, frame } = await setup()
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    await act(async () => {
      frame(hostA.connectionId!, { session: 'session-a', seq: 1, ts: time, event: { type: 'notice', level: 'error', code: 'LOCAL', text: 'A needs inspection' } })
      emit(rendererInvalidated)
    })
    expect(result.current.error).toBe('The window could not keep up. All runtime connections were invalidated; reconnect to recover saved history.')
    await act(async () => result.current.setError(''))
    expect(result.current.error).toBe('A needs inspection')
  })
  it('clears a recovered host transport error without erasing a different session error', async () => {
    const { result, api, emit, connections } = await setup()
    await act(async () => emit({ type: 'connection', connection: { ...hostB, status: 'failed', error: { code: 'EXITED', message: 'B stopped' } } }))
    expect(result.current.error).toBe('B stopped')
    const restartedB = { ...hostB, connectionId: 'epoch-b-2', server: connections[hostB.hostId].server }
    vi.mocked(api.reconnect).mockImplementationOnce(async () => { connections[hostB.hostId] = restartedB; return ok(restartedB) })
    await act(async () => { await result.current.reconnect() })
    expect(result.current.error).toBe('')
    expect(result.current.ready).toBe(true)
    await act(async () => { await result.current.newSession() })
    expect(result.current.error).toBe('')
  })
  it('clears the global invalidation banner only after explicit successful recovery', async () => {
    const { result, emit } = await setup()
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    await act(async () => emit(rendererInvalidated))
    expect(result.current.error).toBe('The window could not keep up. All runtime connections were invalidated; reconnect to recover saved history.')
    await act(async () => { await result.current.reconnect() })
    expect(result.current.ready).toBe(true)
    expect(result.current.error).toBe('')
  })
  it('owns a failed foreground select after successful creation on the created session, not the blank draft', async () => {
    const { result, api } = await setup()
    await act(async () => { await result.current.newSession() })
    vi.mocked(api.selectConversation).mockResolvedValueOnce({ ok: false, error: { code: 'SELECT_FAILED', message: 'Could not select the created session' } })
    await act(async () => { await expect(result.current.openSession()).rejects.toThrow('Could not select the created session') })
    const host = result.current.hosts[hostB.hostId]
    expect(host.contexts[JSON.stringify(null)]?.error).toBeFalsy()
    expect(host.contexts[JSON.stringify(`${hostB.hostId}-created`)]?.error).toBe('Could not select the created session')
  })
  it('reopens a closed stable host using ensure rather than reconnecting a missing epoch', async () => {
    const { result, api, connections } = await setup()
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId); await result.current.closeHost(hostA.hostId) })
    vi.mocked(api.connect).mockImplementationOnce(async () => { connections[hostA.hostId] = { ...restartedHostA, server: connections[hostA.hostId].server }; return ok(connections[hostA.hostId]) })
    await act(async () => { await result.current.reconnect() })
    expect(api.connect).toHaveBeenCalledWith({ workspace: hostA.workspace, binary: hostA.binary })
    expect(api.reconnect).not.toHaveBeenCalled()
    expect(result.current.target).toEqual({ ...selectionA, connectionId: restartedHostA.connectionId })
  })
  it('retains a closed project draft and saved session history when its stable host is ensured again', async () => {
    const { result, api, connections } = await setup()
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    await act(async () => { await result.current.newSession() })
    await act(async () => { await result.current.runAction('think', 'high') })
    await act(async () => { await result.current.closeHost(hostA.hostId) })
    vi.mocked(api.connect).mockImplementationOnce(async () => { connections[hostA.hostId] = { ...restartedHostA, server: connections[hostA.hostId].server }; return ok(connections[hostA.hostId]) })
    await act(async () => { await result.current.viewHost(hostA.hostId) })
    expect(result.current.runtimeSelection.thinking).toBe('high')
    expect(result.current.sessions.some(summary => summary.id === 'session-a')).toBe(true)
    await act(async () => { await result.current.viewHost(hostA.hostId, 'session-a') })
    expect(result.current.active?.snapshot.summary.id).toBe('session-a')
    expect(result.current.hosts[hostA.hostId].projectionEpochs['session-a']).toBe(restartedHostA.connectionId)
  })
  it('hydrates every bootstrap host without reconnecting or stealing the selected conversation', async () => {
    const { result, api } = await setup()
    expect(Object.keys(result.current.hosts)).toEqual([hostA.hostId, hostB.hostId])
    expect(result.current.target).toEqual(selectionB)
    expect(api.connect).not.toHaveBeenCalled()
  })
  it('requires an updated runtime before probing a legacy full session list', async () => {
    const b = bridge()
    vi.mocked(b.api.bootstrap).mockResolvedValueOnce(ok({ ...multiHostBootstrap, connections: [hostA, hostB], selection: { ...selectionB, sessionId: null } }))
    const { result } = renderHook(() => useWorkspace())
    await waitFor(() => expect(result.current.error).toMatch(/RUNTIME_UPDATE_REQUIRED/))
    expect(b.request.mock.calls.some(([call]) => call.method === 'session/list')).toBe(false)
    expect(b.api.requestBounded).not.toHaveBeenCalled()
  })
  it('hydrates bounded heads before opening a session without probing legacy full lists', async () => {
    const b = bridge(), server = { protocol: 1, name: 'fixture', version: 'test', capabilities: { methods: ['session/listHeads', 'session/open', 'session/history', 'session/children', 'session/itemPart', 'session/fieldPart', 'session/eventPart'], notifications: ['eventRef', 'gateway/sessionHead'] } }
    vi.mocked(b.api.bootstrap).mockResolvedValueOnce(ok({ ...multiHostBootstrap, connections: [{ ...hostA, server }, { ...hostB, server }], selection: { ...selectionB, sessionId: null } }))
    let consume!: (delivery: BoundedDelivery) => Promise<void>
    vi.mocked(b.api.onBounded).mockImplementation(listener => { consume = listener; return () => {} })
    vi.mocked(b.api.requestBounded).mockImplementation(async ({ transferId, request }) => {
      const host = request.connectionId === hostA.connectionId ? hostA : hostB
      if (request.method === 'session/listHeads') {
        const summary = state(host.hostId === hostA.hostId ? 'session-a' : 'session-b', host.workspace!).summary
        await consume({ kind: 'response', transferId, hostId: host.hostId, connectionId: request.connectionId, session: null, method: 'session/listHeads', result: { heads: [{ id: summary.id, cwd: summary.cwd, driver: 'model', createdAt: summary.createdAt, updatedAt: summary.updatedAt, busy: false, omitted: [{ field: 'title', totalBytes: 17_000_000, reason: 'openSessionToReadField' }] }], next: null } })
        return ok({ kind: 'response', transferId, hostId: host.hostId, connectionId: request.connectionId, session: null, method: 'session/listHeads', acceptedBytes: 512 })
      }
      if (request.method === 'session/open') {
        const selector = (request.params as RpcMethods['session/open']['params']).selector
        if (selector.kind !== 'byId') throw new Error('Expected a verified session ID.')
        await consume({ kind: 'response', transferId, hostId: host.hostId, connectionId: request.connectionId, session: selector.id, method: 'session/open', result: { session: selector.id, snapshot: state(selector.id, host.workspace!), history: { before: null, hasMore: true, generation: 0 } } })
        return ok({ kind: 'response', transferId, hostId: host.hostId, connectionId: request.connectionId, session: selector.id, method: 'session/open', acceptedBytes: 512 })
      }
      return { ok: false, error: { code: 'UNEXPECTED', message: 'Unexpected bounded method.' } }
    })
    const { result } = renderHook(() => useWorkspace())
    await waitFor(() => expect(result.current.hosts[hostB.hostId]?.sessions.map(summary => summary.id)).toEqual(['session-b']))
    expect(result.current.hosts[hostB.hostId].sessions[0].title).toBeUndefined()
    expect(b.api.requestBounded).toHaveBeenCalledWith(expect.objectContaining({ hostId: hostB.hostId, request: expect.objectContaining({ method: 'session/listHeads', params: expect.objectContaining({ maxBytes: 4 * 1024 * 1024 }) }) }))
    expect(b.request.mock.calls.some(([call]) => call.method === 'session/list')).toBe(false)
    await act(async () => { await result.current.viewHost(hostB.hostId, 'session-b') })
    expect(b.api.requestBounded).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ method: 'session/open', params: expect.objectContaining({ options: expect.objectContaining({ maxSnapshotBytes: 4 * 1024 * 1024 }) }) }) }))
    expect(b.request.mock.calls.some(([call]) => call.method === 'session/open')).toBe(false)
    expect(result.current.active?.history.complete).toBe(false)
    expect(result.current.ready).toBe(true)
  })
  it('discovers only a selected root branch before directly opening and scanning one child', async () => {
    const { result, api, request, deliverBounded } = await setup()
    const original = vi.mocked(api.requestBounded).getMockImplementation()!
    vi.mocked(api.requestBounded).mockImplementation(async ({ transferId, hostId, request: input }) => {
      if (input.method === 'session/open' && input.connectionId === hostA.connectionId) {
        const selector = (input.params as RpcMethods['session/open']['params']).selector
        if (selector.kind !== 'byId') throw new Error('Expected direct byId open.')
        const session = selector.id, summary = { ...state(session, hostA.workspace!).summary, ...(session === 'child-1' ? { parent: { session: 'session-a' } } : {}) }
        await deliverBounded({ kind: 'response', transferId, hostId: hostA.hostId, connectionId: input.connectionId, session, method: 'session/open', result: { session, snapshot: { ...state(session, hostA.workspace!), summary }, history: { before: null, hasMore: false, generation: 0 }, ...(session === 'session-a' ? { tree: { backfill: 'liveOnly', descendantsComplete: false } } : {}) } })
        return ok({ kind: 'response', transferId, hostId: hostA.hostId, connectionId: input.connectionId, session, method: 'session/open', acceptedBytes: 512 })
      }
      if (input.method === 'session/children') {
        const { parent, after } = input.params as RpcMethods['session/children']['params']
        const opened = vi.mocked(api.requestBounded).mock.calls.some(([call]) => call.request.method === 'session/open' && (call.request.params as RpcMethods['session/open']['params']).selector.kind === 'byId' && (call.request.params as { selector: { id: string } }).selector.id === parent)
        if (!opened) throw new Error('A tree parent must have a direct port before discovery.')
        const children = parent === 'session-a' ? after ? ['child-2'] : ['child-1'] : ['grandchild']
        const next = parent === 'session-a' && !after ? 'child-1' : null
        await deliverBounded({ kind: 'response', transferId, hostId: hostA.hostId, connectionId: input.connectionId, session: parent, method: 'session/children', result: { children, next } })
        return ok({ kind: 'response', transferId, hostId: hostA.hostId, connectionId: input.connectionId, session: parent, method: 'session/children', acceptedBytes: 256 })
      }
      return original({ transferId, hostId, request: input })
    })
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    await waitFor(() => expect(result.current.hosts[hostA.hostId].childScanComplete['session-a']).toBe(true))
    expect(result.current.hosts[hostA.hostId].childIds['session-a']).toEqual(['child-1', 'child-2'])
    expect(result.current.active?.tree?.descendantsComplete).toBe(false)
    expect(vi.mocked(api.requestBounded).mock.calls.filter(([call]) => call.request.method === 'session/open' && call.request.connectionId === hostA.connectionId)).toHaveLength(1)
    await act(async () => { await result.current.viewHost(hostA.hostId, 'child-1') })
    await waitFor(() => expect(result.current.hosts[hostA.hostId].childScanComplete['child-1']).toBe(true))
    expect(result.current.hosts[hostA.hostId].childIds['child-1']).toEqual(['grandchild'])
    const openedA = vi.mocked(api.requestBounded).mock.calls.filter(([call]) => call.request.method === 'session/open' && call.request.connectionId === hostA.connectionId)
    expect(openedA).toHaveLength(2)
    expect((openedA[1][0].request.params as RpcMethods['session/open']['params']).options).toMatchObject({ children: false, maxSnapshotBytes: 4 * 1024 * 1024 })
    expect(request.mock.calls.filter(([call]) => call.method === 'session/submit')).toHaveLength(0)
  })
  it('rejects a discovered child whose direct-open parent disagrees with the authorized tree', async () => {
    const { result, api, deliverBounded } = await setup()
    const original = vi.mocked(api.requestBounded).getMockImplementation()!
    vi.mocked(api.requestBounded).mockImplementation(async ({ transferId, hostId, request: input }) => {
      if (input.method === 'session/open' && input.connectionId === hostA.connectionId) {
        const selector = (input.params as RpcMethods['session/open']['params']).selector
        if (selector.kind !== 'byId') throw new Error('Expected byId.')
        const session = selector.id, summary = { ...state(session, hostA.workspace!).summary, ...(session === 'child-1' ? { parent: { session: 'wrong-root' } } : {}) }
        await deliverBounded({ kind: 'response', transferId, hostId: hostA.hostId, connectionId: input.connectionId, session, method: 'session/open', result: { session, snapshot: { ...state(session, hostA.workspace!), summary }, history: { before: null, hasMore: false, generation: 0 }, ...(session === 'session-a' ? { tree: { backfill: 'liveOnly', descendantsComplete: false } } : {}) } })
        return ok({ kind: 'response', transferId, hostId: hostA.hostId, connectionId: input.connectionId, session, method: 'session/open', acceptedBytes: 512 })
      }
      if (input.method === 'session/children') {
        const parent = (input.params as RpcMethods['session/children']['params']).parent
        const children = parent === 'session-a' ? ['child-1'] : []
        await deliverBounded({ kind: 'response', transferId, hostId: hostA.hostId, connectionId: input.connectionId, session: parent, method: 'session/children', result: { children, next: null } })
        return ok({ kind: 'response', transferId, hostId: hostA.hostId, connectionId: input.connectionId, session: parent, method: 'session/children', acceptedBytes: 256 })
      }
      return original({ transferId, hostId, request: input })
    })
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    await waitFor(() => expect(result.current.hosts[hostA.hostId].childIds['session-a']).toContain('child-1'))
    await act(async () => { await expect(result.current.viewHost(hostA.hostId, 'child-1')).rejects.toThrow(/parent/) })
    expect(result.current.hosts[hostA.hostId].childIds['session-a']).not.toContain('child-1')
    expect(result.current.hosts[hostA.hostId].childScanComplete['session-a']).toBe(false)
    expect(result.current.target).toEqual(selectionA)
    expect(vi.mocked(api.requestBounded).mock.calls.filter(([call]) => call.request.method === 'session/children' && (call.request.params as RpcMethods['session/children']['params']).parent === 'child-1')).toHaveLength(0)
  })
  it('does not select or enable a provisional snapshot before its bounded receipt arrives', async () => {
    const { result, api, deliverBounded } = await setup()
    const receipt = deferred<Result<Awaited<ReturnType<BingoDesktopApi['requestBounded']>> extends Result<infer T> ? T : never>>()
    const original = vi.mocked(api.requestBounded).getMockImplementation()!
    vi.mocked(api.requestBounded).mockImplementation(async input => {
      if (input.request.method !== 'session/open' || input.request.connectionId !== hostA.connectionId) return original(input)
      const selector = (input.request.params as RpcMethods['session/open']['params']).selector
      if (selector.kind !== 'byId') throw new Error('Expected byId.')
      await deliverBounded({ kind: 'response', transferId: input.transferId, hostId: hostA.hostId, connectionId: hostA.connectionId!, session: selector.id, method: 'session/open', result: { session: selector.id, snapshot: state(selector.id, hostA.workspace!), history: { before: null, hasMore: true, generation: 0 } } })
      return receipt.promise
    })
    let opening!: Promise<string>
    await act(async () => { opening = result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    await waitFor(() => expect(result.current.hosts[hostA.hostId].projections['session-a']?.provisional).toBe(true))
    expect(result.current.target).toEqual(selectionB)
    await act(async () => { await expect(result.current.selectConversation(selectionA)).rejects.toThrow('Open this session directly on its owning runtime') })
    expect(api.selectConversation).not.toHaveBeenCalledWith(selectionA)
    await act(async () => { receipt.resolve(ok({ kind: 'response', transferId: vi.mocked(api.requestBounded).mock.calls.at(-1)![0].transferId, hostId: hostA.hostId, connectionId: hostA.connectionId!, session: 'session-a', method: 'session/open', acceptedBytes: 512 })); await opening })
    expect(result.current.hosts[hostA.hostId].projections['session-a']?.provisional).toBe(false)
    expect(result.current.target).toEqual(selectionB) // A later explicit selection superseded the pending open.
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    expect(result.current.target).toEqual(selectionA)
  })
  it('rolls back a provisional bounded open when its acknowledged receipt has the wrong source', async () => {
    const { result, api } = await setup()
    const priorSummary = result.current.hosts[hostA.hostId].sessions.find(summary => summary.id === 'session-a')
    const original = vi.mocked(api.requestBounded).getMockImplementation()!
    vi.mocked(api.requestBounded).mockImplementation(async input => {
      const reply = await original(input)
      return input.request.method === 'session/open' && input.request.connectionId === hostA.connectionId && reply.ok ? ok({ ...reply.value, transferId: 'wrong-transfer' }) : reply
    })
    await act(async () => { await expect(result.current.openSession('session-a', false, 'model', true, hostA.hostId)).rejects.toThrow('not acknowledged') })
    expect(result.current.hosts[hostA.hostId].projections['session-a']).toBeUndefined()
    expect(result.current.hosts[hostA.hostId].sessions.find(summary => summary.id === 'session-a')).toEqual(priorSummary)
    expect(result.current.hosts[hostA.hostId].listComplete).toBe(false)
    expect(result.current.target).toEqual(selectionB)
    expect(result.current.hosts[hostA.hostId].contexts[JSON.stringify('session-a')].error).toMatch(/not acknowledged/)
  })
  it('switches warm direct attachments with native selection without replacing loaded history or live frames', async () => {
    const { result, request, api, frame } = await setup()
    await waitFor(() => expect(result.current.hosts[hostB.hostId].projections['session-b']).toBeDefined())
    const original = request.getMockImplementation()!
    let opensA = 0
    request.mockImplementation(async input => {
      if (input.method === 'session/open' && input.connectionId === hostA.connectionId && (input.params as RpcMethods['session/open']['params']).selector.kind === 'byId') {
        opensA += 1
        return ok({ session: 'session-a', snapshot: opensA === 1 ? { ...state('session-a', hostA.workspace!), seq: 10, items: [item('recent', 'Recent')] } : state('session-a', hostA.workspace!) })
      }
      if (input.method === 'session/history' && input.connectionId === hostA.connectionId) return ok({ items: [item('older', 'Older')], next: null, generation: 0 })
      return original(input)
    })
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    await act(async () => { await result.current.loadHistory() })
    await act(async () => { await result.current.openSession('session-b', false, 'model', true, hostB.hostId) })
    await act(async () => { frame(hostA.connectionId!, { session: 'session-a', seq: 11, ts: time, event: { type: 'itemCompleted', item: item('live', 'Background reply') } }) })
    const retained = result.current.hosts[hostA.hostId].projections['session-a']
    expect(retained.snapshot.items.map(entry => entry.id)).toEqual(['older', 'recent', 'live'])
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    expect(opensA).toBe(1)
    expect(result.current.hosts[hostA.hostId].projections['session-a']).toBe(retained)
    expect(result.current.active?.snapshot.items.map(entry => entry.id)).toEqual(['older', 'recent', 'live'])
    expect(result.current.active?.history.complete).toBe(true)
    expect(api.selectConversation).toHaveBeenCalledWith(selectionA)
    expect(result.current.target).toEqual(selectionA)
  })
  it('opens a tree-projected descendant directly before treating it as a warm attachment', async () => {
    const { result, frame, request } = await setup()
    const child = { ...state('child-a', hostA.workspace!).summary, parent: { session: 'session-a' } }
    await act(async () => frame(hostA.connectionId!, { session: child.id, root: 'session-a', seq: 1, ts: time, event: { type: 'sessionUpdated', summary: child } }))
    expect(result.current.hosts[hostA.hostId].projections[child.id]).toBeDefined()
    await act(async () => { await result.current.viewHost(hostA.hostId, child.id) })
    const childOpens = () => request.mock.calls.map(([call]) => call).filter(call => {
      if (call.method !== 'session/open') return false
      const selector = (call.params as RpcMethods['session/open']['params']).selector
      return selector.kind === 'byId' && selector.id === child.id
    })
    expect(childOpens()).toHaveLength(1)
    expect(childOpens()[0].params).toMatchObject({ options: { children: false } })
    await act(async () => { await result.current.viewHost(hostB.hostId, 'session-b') })
    await act(async () => { await result.current.viewHost(hostA.hostId, child.id) })
    expect(childOpens()).toHaveLength(1)
  })
  it('refuses to select a tree-only child with a known turn until it owns a direct port', async () => {
    const { result, api, frame, request } = await setup()
    const child = { ...state('child-only', hostA.workspace!).summary, parent: { session: 'session-a' } }
    await act(async () => {
      frame(hostA.connectionId!, { session: child.id, root: 'session-a', seq: 1, ts: time, event: { type: 'sessionUpdated', summary: child } })
      frame(hostA.connectionId!, { session: child.id, root: 'session-a', seq: 2, ts: time, event: { type: 'turnStarted', turn: 'child-turn', inputs: [], origin: 'submit' } })
    })
    expect(result.current.hosts[hostA.hostId].projections[child.id].snapshot.turn?.id).toBe('child-turn')
    await act(async () => { await expect(result.current.selectConversation({ hostId: hostA.hostId, connectionId: hostA.connectionId, sessionId: child.id })).rejects.toThrow(/direct|owning runtime/) })
    expect(api.selectConversation).not.toHaveBeenCalledWith({ hostId: hostA.hostId, connectionId: hostA.connectionId, sessionId: child.id })
    expect(request.mock.calls.filter(([call]) => call.method === 'session/interrupt')).toHaveLength(0)
    await act(async () => { await result.current.viewHost(hostA.hostId, child.id) })
    const original = request.getMockImplementation()!
    request.mockImplementation(async input => input.method === 'session/interrupt' ? { ok: false, error: { code: 'NOT_READY', message: 'The known child turn was replaced.' } } : original(input))
    await act(async () => { await expect(result.current.interrupt('child-turn')).rejects.toThrow('The known child turn was replaced.') })
    const interrupts = request.mock.calls.map(([call]) => call).filter(call => call.method === 'session/interrupt')
    expect(interrupts).toHaveLength(1)
    expect(interrupts[0]).toMatchObject({ connectionId: hostA.connectionId, params: { session: child.id, scope: { kind: 'turn', turn: 'child-turn' } } })
  })
  it('refreshes a direct attachment after history generation changes or its session closes', async () => {
    const { result, frame, request } = await setup()
    const opensA = () => request.mock.calls.filter(([call]) => call.method === 'session/open' && call.connectionId === hostA.connectionId && (call.params as RpcMethods['session/open']['params']).selector.kind === 'byId').length
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    expect(opensA()).toBe(1)
    await act(async () => frame(hostA.connectionId!, { session: 'session-a', seq: 1, ts: time, event: { type: 'compacted', generation: 1, boundary: 'item-before', summary: 'item-summary', kept: [] } }))
    expect(result.current.active?.snapshot.historyGeneration).toBe(1)
    await act(async () => { await result.current.openSession('session-b', false, 'model', true, hostB.hostId) })
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    expect(opensA()).toBe(2)
    await act(async () => frame(hostA.connectionId!, { session: 'session-a', seq: 1, ts: time, event: { type: 'sessionClosed', reason: { kind: 'client' } } }))
    expect(result.current.active?.snapshot.closed).toBe(true)
    await act(async () => { await result.current.openSession('session-b', false, 'model', true, hostB.hostId) })
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    expect(opensA()).toBe(3)
  })
  it('records an oversized event as incomplete while applying a later small turn completion', async () => {
    const { result, emit, frame } = await setup()
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    const ref = { session: 'session-a', seq: 1, messageId: 'ref-a-1', eventType: 'itemCompleted', item: 'huge-item', generation: 0, stateUncertain: false, availability: { kind: 'available', token: 'opaque-a' }, totalBytes: 17 * 1024 * 1024, checksum: 'a6a4eddc16724d5c' }
    await act(async () => {
      emit({ type: 'rpc', connectionId: hostA.connectionId!, method: 'eventRef', params: ref } as unknown as DesktopEvent)
      frame(hostA.connectionId!, { session: 'session-a', seq: 2, ts: time, event: { type: 'turnCompleted', turn: 'turn-a', status: { kind: 'completed' }, usage: { inputTokens: 1, outputTokens: 1 } } })
    })
    expect(result.current.active?.resync).toBeNull()
    expect(result.current.active?.snapshot.lastTurn?.status.kind).toBe('completed')
    expect(result.current.active?.snapshot.items).toEqual([])
    expect(result.current.active?.snapshot.summary.messages).toBeUndefined()
    expect(result.current.active?.transportSeq).toBe(2)
    expect(result.current.active?.unloaded).toEqual([expect.objectContaining({ messageId: 'ref-a-1', item: 'huge-item', seq: 1 })])
    await act(async () => result.current.markRead(selectionA, 2))
    expect(result.current.watermarks[JSON.stringify([hostA.hostId, 'session-a'])]).toBeUndefined()
  })
  it('previews only one acknowledged bounded part without claiming the full event loaded', async () => {
    const { result, api, emit, deliverBounded } = await setup()
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    const totalBytes = 17 * 1024 * 1024, data = '{"session":"session-a","seq":1}', nextOffset = new TextEncoder().encode(data).byteLength
    await act(async () => emit({ type: 'rpc', connectionId: hostA.connectionId!, method: 'eventRef', params: { session: 'session-a', seq: 1, messageId: 'ref-a-1', eventType: 'itemCompleted', item: 'huge-item', stateUncertain: false, generation: 0, availability: { kind: 'available', token: 'opaque-a' }, totalBytes, checksum: 'a6a4eddc16724d5c' } } as unknown as DesktopEvent))
    vi.mocked(api.readPart).mockImplementation(async input => {
      await deliverBounded({ kind: 'part', transferId: input.transferId, hostId: hostA.hostId, connectionId: hostA.connectionId!, session: 'session-a', partKind: 'event', token: 'opaque-a', offset: 0, data, nextOffset, totalBytes })
      return ok({ kind: 'part', transferId: input.transferId, hostId: hostA.hostId, connectionId: hostA.connectionId!, session: 'session-a', partKind: 'event', offset: 0, nextOffset, totalBytes })
    })
    await act(async () => { await result.current.previewReference('event', 'ref-a-1') })
    expect(api.readPart).toHaveBeenCalledWith(expect.objectContaining({ hostId: hostA.hostId, connectionId: hostA.connectionId, session: 'session-a', kind: 'event', token: 'opaque-a', maxBytes: 64 * 1024 }))
    expect(result.current.active?.rawPreview).toEqual({ id: 'ref-a-1', text: data, totalBytes, nextOffset })
    expect(result.current.active?.unloaded).toHaveLength(1)
    vi.mocked(api.readPart).mockImplementationOnce(async input => {
      await expect(deliverBounded({ kind: 'part', transferId: input.transferId, hostId: hostB.hostId, connectionId: hostA.connectionId!, session: 'session-a', partKind: 'event', token: 'opaque-a', offset: 0, data, nextOffset, totalBytes })).rejects.toThrow(/another source/)
      return { ok: false, error: { code: 'NACK', message: 'Wrong host rejected.' } }
    })
    await act(async () => { await expect(result.current.previewReference('event', 'ref-a-1')).rejects.toThrow('Wrong host rejected.') })
    expect(result.current.active?.unloaded).toHaveLength(1)
    expect(api.cancelPart).toHaveBeenCalledOnce()
  })
  it('exports a reference only through the native save flow and waits for its final result', async () => {
    const { result, api, emit } = await setup()
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    const totalBytes = 17_000_000, completion = deferred<Result<boolean>>()
    await act(async () => emit({ type: 'rpc', connectionId: hostA.connectionId!, method: 'eventRef', params: { session: 'session-a', seq: 1, messageId: 'save-ref', eventType: 'itemCompleted', item: 'large-item', stateUncertain: false, generation: 0, availability: { kind: 'available', token: 'pinned-event' }, totalBytes, checksum: 'a6a4eddc16724d5c' } }))
    vi.mocked(api.exportReference).mockImplementation(async input => { emit({ type: 'export-progress', transferId: input.transferId, hostId: hostA.hostId, connectionId: hostA.connectionId!, session: 'session-a', doneBytes: totalBytes, totalBytes, status: 'completed' }); return completion.promise })
    let saved!: Promise<boolean>
    await act(async () => { saved = result.current.exportReference('event', 'save-ref') })
    expect(result.current.exportProgress?.status).toBe('running') // A progress event is not an acknowledged Save result.
    expect(api.exportReference).toHaveBeenCalledWith(expect.objectContaining({ hostId: hostA.hostId, connectionId: hostA.connectionId, session: 'session-a', kind: 'event', token: 'pinned-event', totalBytes, checksum: 'a6a4eddc16724d5c' }))
    expect(api.readPart).not.toHaveBeenCalled()
    await act(async () => { completion.resolve(ok(true)); await saved })
    expect(result.current.exportProgress?.status).toBe('completed')
    expect(result.current.active?.unloaded).toHaveLength(1)
  })
  it('fails closed on uncertain permission references without forwarding a new intent', async () => {
    const { result, emit, request } = await setup()
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    const original = request.getMockImplementation()!
    request.mockImplementation(async input => input.method === 'session/submit' ? { ok: false, error: { code: 'UNSAFE', message: 'Intent should never be sent' } } : original(input))
    await act(async () => emit({ type: 'rpc', connectionId: hostA.connectionId!, method: 'eventRef', params: { session: 'session-a', seq: 1, messageId: 'permission-ref', eventType: 'interactionOpened', interaction: 'permission-a', stateUncertain: true, generation: 0, availability: { kind: 'available', token: 'permission-token' }, totalBytes: 18_000_000, checksum: 'a6a4eddc16724d5c' } } as unknown as DesktopEvent))
    await act(async () => { await expect(result.current.runAction('status')).rejects.toThrow(/not loaded/i) })
    expect(request.mock.calls.filter(([call]) => call.method === 'session/submit')).toHaveLength(0)
    expect(result.current.error).toMatch(/not loaded/i)
  })
  it('permits only a direct source-bound Stop through uncertain state and never retries its unknown ACK', async () => {
    const { result, api, emit, request } = await setup()
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    await act(async () => emit({ type: 'rpc', connectionId: hostA.connectionId!, method: 'eventRef', params: { session: 'session-a', seq: 1, messageId: 'permission-ref', eventType: 'interactionOpened', interaction: 'permission-a', stateUncertain: true, generation: 0, availability: { kind: 'available', token: 'permission-token' }, totalBytes: 18_000_000, checksum: 'a6a4eddc16724d5c' } }))
    await act(async () => { await expect(result.current.runAction('status')).rejects.toThrow(/not loaded/i); await expect(result.current.respond('session-a', 'permission-a', { kind: 'deny' }, 'keyboard')).rejects.toThrow(/not loaded/i) })
    expect(request.mock.calls.some(([call]) => call.method === 'session/submit' || call.method === 'session/answer')).toBe(false)
    vi.useFakeTimers()
    try {
      let stopped!: Promise<unknown>
      await act(async () => { stopped = result.current.interrupt('turn-a').catch(error => error) })
      const interrupts = () => request.mock.calls.filter(([call]) => call.method === 'session/interrupt')
      expect(interrupts()).toHaveLength(1)
      expect(interrupts()[0][0].connectionId).toBe(hostA.connectionId)
      expect(interrupts()[0][0].params).toMatchObject({ session: 'session-a', scope: { kind: 'turn', turn: 'turn-a' } })
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); await stopped })
      expect(await stopped).toEqual(expect.objectContaining({ message: expect.stringContaining('not acknowledged') }))
      expect(interrupts()).toHaveLength(1)
      expect(result.current.error).toMatch(/Check the session before sending it again/)
      expect(api.reconnect).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('does not classify or send from a child whose bounded identity key is omitted', async () => {
    const { result, api, request, deliverBounded } = await setup()
    const original = vi.mocked(api.requestBounded).getMockImplementation()!
    vi.mocked(api.requestBounded).mockImplementation(async ({ transferId, hostId, request: input }) => {
      if (input.method !== 'session/open' || input.connectionId !== hostA.connectionId) return original({ transferId, hostId, request: input })
      const selector = (input.params as RpcMethods['session/open']['params']).selector
      if (selector.kind !== 'byId' || selector.id !== 'child-unknown') return original({ transferId, hostId, request: input })
      const snapshot = state(selector.id, hostA.workspace!)
      snapshot.summary.parent = { session: 'session-a' }
      await deliverBounded({ kind: 'response', transferId, hostId: hostA.hostId, connectionId: input.connectionId, session: selector.id, method: 'session/open', result: { session: selector.id, snapshot, history: { before: null, hasMore: false, generation: 0 }, omittedFields: [{ path: ['summary', 'key'], availability: { kind: 'available', token: 'large-key' }, totalBytes: 17_000_000, checksum: 'a6a4eddc16724d5c' }] } })
      return ok({ kind: 'response', transferId, hostId: hostA.hostId, connectionId: input.connectionId, session: selector.id, method: 'session/open', acceptedBytes: 512 })
    })
    await act(async () => { await result.current.viewHost(hostA.hostId, 'child-unknown') })
    expect(result.current.active?.omittedFields?.[0].path).toEqual(['summary', 'key'])
    await act(async () => { await expect(result.current.runAction('status')).rejects.toThrow(/session type is not loaded/i) })
    expect(request.mock.calls.filter(([call]) => call.method === 'session/submit')).toHaveLength(0)
  })
  it('keeps synthetic duplicate IDs partitioned by host even though native rejects dual live ownership', async () => {
    const { result, request, frame } = await setup()
    const original = request.getMockImplementation()!
    request.mockImplementation(async input => input.method === 'session/open' && (input.params as RpcMethods['session/open']['params']).selector.kind === 'byId'
      ? ok({ session: 'same-id', snapshot: state('same-id', input.connectionId === hostA.connectionId ? hostA.workspace! : hostB.workspace!) })
      : original(input))
    await act(async () => { await result.current.openSession('same-id', false, 'model', true, hostA.hostId); await result.current.openSession('same-id', false, 'model', true, hostB.hostId) })
    await act(async () => {
      frame(hostA.connectionId!, { session: 'same-id', seq: 1, ts: time, event: { type: 'notice', level: 'error', code: 'A', text: 'Only A' } })
      frame(hostB.connectionId!, { session: 'same-id', seq: 1, ts: time, event: { type: 'notice', level: 'error', code: 'B', text: 'Only B' } })
    })
    expect(result.current.error).toBe('Only B')
    await act(async () => { await result.current.openSession('same-id', false, 'model', true, hostA.hostId) })
    expect(result.current.error).toBe('Only A')
    expect(result.current.hosts[hostB.hostId].contexts[JSON.stringify('same-id')].error).toBe('Only B')
  })
  it('preserves background errors/results and routes a captured action after foreground changes', async () => {
    const { result, request, frame } = await setup()
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    const onA = result.current.runAction
    await act(async () => { await result.current.openSession('session-b', false, 'model', true, hostB.hostId) })
    let action!: Promise<unknown>
    await act(async () => { action = onA('status') })
    const call = request.mock.calls.map(([call]) => call).find(call => call.method === 'session/submit')!
    expect(call.connectionId).toBe(hostA.connectionId)
    const intent = (call.params as RpcMethods['session/submit']['params']).intent
    await act(async () => { frame(hostA.connectionId!, { session: 'session-a', seq: 1, ts: time, event: { type: 'intentAck', intent, outcome: { kind: 'applied', result: { view: { kind: 'text', text: 'A result' } } } } }); await action })
    await act(async () => { frame(hostA.connectionId!, { session: 'session-a', seq: 2, ts: time, event: { type: 'notice', level: 'error', code: 'A_ERROR', text: 'Only A failed' } }) })
    expect(result.current.error).toBe('')
    expect(result.current.commandView).toBeNull()
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    expect(result.current.error).toBe('Only A failed')
    expect(result.current.commandView).toEqual({ kind: 'text', text: 'A result' })
  })
  it('does not let a late host connection change the last foreground choice', async () => {
    const { result, api } = await setup()
    const delayed = deferred<Result<ConnectionState>>()
    vi.mocked(api.connect).mockImplementation(async ({ workspace }) => workspace === hostA.workspace ? delayed.promise : ok(hostB))
    let first!: Promise<void>
    await act(async () => { first = result.current.connect(hostA.workspace!) })
    await act(async () => { await result.current.connect(hostB.workspace!) })
    await act(async () => { delayed.resolve(ok(hostA)); await first })
    expect(result.current.target?.hostId).toBe(hostB.hostId)
    expect(vi.mocked(api.selectConversation).mock.calls.at(-1)?.[0]?.hostId).toBe(hostB.hostId)
  })
  it('isolates ordinary host failure, then invalidates all epochs only on the global control event', async () => {
    const { result, emit } = await setup()
    await act(async () => emit({ type: 'connection', connection: { ...hostA, status: 'failed', error: { code: 'EXITED', message: 'A stopped' } } }))
    expect(result.current.ready).toBe(true)
    expect(result.current.target).toEqual(selectionB)
    await act(async () => emit(rendererInvalidated))
    expect(result.current.ready).toBe(false)
    expect(Object.values(result.current.hosts).every(host => host.connection.status !== 'ready')).toBe(true)
  })
  it('refreshes old-epoch summaries while preserving new-epoch live projections', async () => {
    const { result, request, connections } = await setup()
    await act(async () => { await result.current.openSession('session-a', false, 'model', true, hostA.hostId) })
    const original = request.getMockImplementation()!
    let fresh = false
    request.mockImplementation(async input => input.method === 'session/list' && input.connectionId?.startsWith('epoch-a') ? ok({ sessions: [{ ...state('background-a', hostA.workspace!).summary, busy: !fresh }] }) : original(input))
    // Initial host list discovers a real running background session.
    await act(async () => { await result.current.reconnect() })
    expect(result.current.hosts[hostA.hostId].sessions.find(row => row.id === 'background-a')?.busy).toBe(true)
    fresh = true
    // Explicit list refresh is exercised by replacement host initialization.
    const next = { ...restartedHostA, connectionId: 'epoch-a-3', server: connections[hostA.hostId].server }
    connections[hostA.hostId] = next
    vi.mocked(window.bingoDesktop.reconnect).mockResolvedValueOnce(ok(next))
    await act(async () => { await result.current.reconnect() })
    expect(result.current.hosts[hostA.hostId].sessions.find(row => row.id === 'background-a')?.busy).toBe(false)
  })
  it('keeps B selected when A reconnects and ignores the old A epoch', async () => {
    const { result, emit, frame } = await setup()
    await act(async () => emit({ type: 'connection', connection: restartedHostA }))
    await act(async () => frame(hostA.connectionId!, { session: 'session-a', seq: 1, ts: time, event: { type: 'notice', level: 'error', code: 'STALE', text: 'Wrong epoch' } }))
    expect(result.current.target).toEqual(selectionB)
    expect(result.current.error).toBe('')
    expect(result.current.hosts[hostA.hostId].connection.connectionId).toBe(restartedHostA.connectionId)
  })
  it('retains agent-page sources without treating a bootstrap opened snapshot or background opened event as foreground', async () => {
    const { result, emit } = await setup()
    expect(result.current.agentPageEvent).toBeNull()
    await act(async () => emit({ type: 'agent-page', page: { ...pageA, status: 'opened' } }))
    expect(result.current.agentPages.some(page => page.hostId === hostA.hostId)).toBe(true)
    expect(result.current.target).toEqual(selectionB)
    await act(async () => emit({ type: 'agent-page', page: { ...pageB, status: 'invalidated' } }))
    expect(result.current.agentPages.find(page => page.hostId === hostB.hostId)?.status).toBe('invalidated')
  })
  it('rejects frozen invalid target fixtures instead of forwarding them to the selected host', async () => {
    const { result, api } = await setup()
    for (const fixture of rejectedSelections) await expect(result.current.selectConversation(fixture.input as typeof selectionA)).rejects.toThrow()
    expect(api.selectConversation).not.toHaveBeenCalledWith(expect.objectContaining({ hostId: 'host-missing' }))
  })
})
