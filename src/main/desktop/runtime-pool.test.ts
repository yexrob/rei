import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventParams, OpenResult } from '../../shared/rpc'
import { hostA, hostB, selectionA, selectionB, rejectedSelections, stopA, answerB, rendererInvalidated } from '../../shared/desktop.fixtures'
import type { ConversationSelection, DesktopEvent } from '../../shared/desktop'
const calls = vi.hoisted(() => ({ clients: [] as any[], legacy: false }))
vi.mock('./rpc-client', async original => {
  const actual = await original<typeof import('./rpc-client')>()
  return { ...actual, RpcClient: class {
    alive = true
    request = vi.fn(async (method: string, params: any) => {
      const id = params.selector?.id ?? (this.cwd === '/approved/project-a' ? 'session-a' : 'session-b')
      const summary = { id, cwd: this.cwd, createdAt: '', updatedAt: '' }
      if (method === 'session/open') return { session: id, snapshot: { seq: 0, summary, items: [] }, history: { before: null, hasMore: false, generation: 0 }, ...(params.options?.children ? { tree: { backfill: 'liveOnly', descendantsComplete: false } } : {}) }
      if (method === 'session/list') return { sessions: [{ ...summary, id: this.cwd === '/approved/project-a' ? 'session-a' : 'session-b' }] }
      if (method === 'session/listHeads') return { heads: [{ id: this.cwd === '/approved/project-a' ? 'session-a' : 'session-b', cwd: this.cwd, driver: 'model', createdAt: '', updatedAt: '', busy: false, key: 'shared-key' }], next: null }
      return {}
    })
    close = vi.fn(async () => { this.alive = false })
    start = vi.fn(async () => ({ name: 'bingo', version: 'fixture', protocol: 1, capabilities: calls.legacy
      ? { methods: ['initialize', 'session/list', 'session/open'], notifications: ['event', 'gateway/event'] }
      : { methods: ['session/listHeads', 'session/children', 'session/itemPart', 'session/fieldPart', 'session/eventPart'], notifications: ['eventRef', 'gateway/sessionHead'] } }))
    cwd: string
    constructor(options: { cwd: string }, readonly notify: (frame: unknown) => void, readonly fail: (error: unknown) => void) { this.cwd = options.cwd; calls.clients.push(this) }
  } }
})
import { RuntimePool, MAX_RUNTIME_HOSTS, hostIdentity } from './runtime-pool'
import { DesktopFailure } from './rpc-client'
const frame = (session: string, event: EventParams['event'], seq = 1) => ({ method: 'event', params: { session, event, seq, ts: '' } })
async function setup() {
  const events: DesktopEvent[] = [], pool = new RuntimePool(event => events.push(event))
  const a = await pool.connect(hostA.binary!, hostA.workspace!), b = await pool.connect(hostB.binary!, hostB.workspace!)
  await pool.request({ connectionId: a.connectionId!, method: 'session/open', params: { selector: { kind: 'byId', id: selectionA.sessionId! } } })
  await pool.request({ connectionId: b.connectionId!, method: 'session/open', params: { selector: { kind: 'byId', id: selectionB.sessionId! } } })
  const selectA = { ...selectionA, hostId: a.hostId, connectionId: a.connectionId }, selectB = { ...selectionB, hostId: b.hostId, connectionId: b.connectionId }
  return { pool, events, a, b, selectA, selectB }
}
beforeEach(() => { calls.clients = []; calls.legacy = false })
describe('multi-host runtime ownership', () => {
  it('fails closed with an actionable update error when old Core lacks bounded methods and notifications', async () => {
    calls.legacy = true
    const pool = new RuntimePool(() => {})
    await expect(pool.connect('/approved/bingo', '/approved/project-a')).rejects.toMatchObject({ code: 'RUNTIME_UPDATE_REQUIRED' })
    expect(pool.connections[0]).toMatchObject({ status: 'failed', error: { code: 'RUNTIME_UPDATE_REQUIRED' } })
    expect(calls.clients).toHaveLength(1)
    expect(calls.clients[0].request).not.toHaveBeenCalled()
  })
  it('opens a large-titled saved session only after paged listHeads verifies its exact id/cwd', async () => {
    const { pool, a } = await setup()
    calls.clients[0].request.mockImplementationOnce(async (method: string, params: any) => {
      if (method !== 'session/listHeads') throw new DesktopFailure('PROTOCOL_LIMIT', 'Legacy unbounded list would exceed 16 MiB.')
      expect(params).toMatchObject({ filter: { cwd: hostA.workspace }, maxBytes: 4 * 1024 * 1024 })
      return { heads: [{ id: 'older-000', cwd: hostA.workspace, driver: 'model', createdAt: '', updatedAt: '', busy: false }], next: 'older-000' }
    }).mockImplementationOnce(async (method: string, params: any) => {
      expect(method).toBe('session/listHeads')
      expect(params.after).toBe('older-000')
      return { heads: [{ id: 'older-session', cwd: hostA.workspace, driver: 'model', createdAt: '', updatedAt: '', busy: false, omitted: [{ field: 'title', totalBytes: 17 * 1024 * 1024, reason: 'openSessionToReadField' }] }], next: null }
    })
    const opened = await pool.request({ connectionId: a.connectionId!, method: 'session/open', params: { selector: { kind: 'byId', id: 'older-session' }, options: { maxSnapshotBytes: 4 * 1024 * 1024 } } })
    expect(opened.session).toBe('older-session')
    expect(calls.clients[0].request.mock.calls.slice(-3).map(([method]: [string]) => method)).toEqual(['session/listHeads', 'session/listHeads', 'session/open'])
  })
  it('refuses omitted keys rather than treating an unsafe byKey head as an empty key', async () => {
    const { pool, a } = await setup()
    calls.clients[0].request.mockResolvedValueOnce({ heads: [{ id: 'opaque-key', cwd: hostA.workspace, driver: 'model', createdAt: '', updatedAt: '', busy: false, omitted: [{ field: 'key', totalBytes: 17 * 1024 * 1024, reason: 'openSessionToReadField' }] }], next: null })
    await expect(pool.request({ connectionId: a.connectionId!, method: 'session/open', params: { selector: { kind: 'byKey', key: 'requested' }, options: { maxSnapshotBytes: 4 * 1024 * 1024 } } })).rejects.toMatchObject({ code: 'SESSION_HEAD_INCOMPLETE' })
    expect(calls.clients[0].request.mock.calls.at(-1)?.[0]).toBe('session/listHeads')
  })
  it('does not treat discovered children as opened ports or allow unowned parent enumeration', async () => {
    const { pool, a, b } = await setup()
    await expect(pool.request({ connectionId: b.connectionId!, method: 'session/children', params: { parent: 'session-a', maxBytes: 4096 } })).rejects.toMatchObject({ code: 'SESSION_NOT_OWNED' })
    await pool.request({ connectionId: a.connectionId!, method: 'session/children', params: { parent: 'session-a', maxBytes: 4096 } })
    await expect(pool.request({ connectionId: a.connectionId!, method: 'session/submit', params: { session: 'unopened-child', intent: 'none', input: { kind: 'text', text: 'not open', origin: { surface: 'desktop' } } } })).rejects.toMatchObject({ code: 'SESSION_NOT_OWNED' })
  })
  it('admits only the matching current-epoch Core reference and never trusts Renderer-provided digest or bytes', async () => {
    const { pool, a, b } = await setup()
    const ref = { session: 'session-a', seq: 1, messageId: 'ref-1', eventType: 'itemCompleted', item: 'item-1', stateUncertain: false, generation: 0, availability: { kind: 'available', token: 'server-pin' }, totalBytes: 5, checksum: 'a430d84680aabd0b' }
    calls.clients[0].notify({ method: 'eventRef', params: ref })
    const target = { transferId: 't', hostId: a.hostId, connectionId: a.connectionId!, session: 'session-a', kind: 'event' as const, token: 'server-pin', offset: 0, maxBytes: 5 }
    expect(pool.referenceFor(target)).toMatchObject({ kind: 'event', totalBytes: 5, checksum: 'a430d84680aabd0b' })
    await pool.readCorePart(target)
    expect(calls.clients[0].request).toHaveBeenLastCalledWith('session/eventPart', { session: 'session-a', token: 'server-pin', offset: 0, maxBytes: 5 })
    expect(() => pool.referenceFor({ ...target, hostId: b.hostId })).toThrow()
    expect(() => pool.referenceFor({ ...target, connectionId: b.connectionId! })).toThrow()
    expect(() => pool.referenceFor({ ...target, session: 'session-b' })).toThrow()
    expect(() => pool.referenceFor({ ...target, token: 'invented-pin' })).toThrow()
    expect(() => pool.referenceFor({ ...target, totalBytes: 6, checksum: ref.checksum, suggestedName: 'recorded.json' })).toThrow()
    await pool.closeHost(a)
    expect(() => pool.referenceFor(target)).toThrow()
  })
  it('reuses a healthy pair and never stops another running host on connect or selection', async () => {
    const { pool, a, b, selectA, selectB } = await setup()
    calls.clients[0].notify(frame('session-a', { type: 'turnStarted', turn: 't', inputs: [], origin: 'submit' }))
    pool.selectConversation(selectA); pool.selectConversation(selectB)
    expect(await pool.connect(hostA.binary!, hostA.workspace!)).toMatchObject({ hostId: a.hostId, connectionId: a.connectionId })
    expect(pool.selection).toEqual(selectB)
    expect(pool.connections.find(state => state.hostId === a.hostId)?.busy).toBe(true)
    expect(pool.connections.find(state => state.hostId === b.hostId)?.busy).toBe(false)
    expect(calls.clients).toHaveLength(2)
    for (const client of calls.clients) expect(client.close).not.toHaveBeenCalled()
    expect(hostIdentity(hostA.binary!, hostA.workspace!)).toBe(a.hostId)
  })
  it('routes canonical Stop/answer to their captured host, with foreign/unopened sessions refused', async () => {
    const { pool, a, b, selectB } = await setup(); pool.selectConversation(selectB)
    await pool.request({ ...stopA, connectionId: a.connectionId! })
    await pool.request({ ...answerB, connectionId: b.connectionId! })
    expect(calls.clients[0].request).toHaveBeenCalledWith(stopA.method, stopA.params)
    expect(calls.clients[1].request).toHaveBeenCalledWith(answerB.method, answerB.params)
    await expect(pool.request({ ...stopA, connectionId: b.connectionId! })).rejects.toMatchObject({ code: 'SESSION_NOT_OWNED' })
    await expect(pool.request({ ...stopA, connectionId: a.connectionId!, params: { ...stopA.params, session: 'unopened' } })).rejects.toMatchObject({ code: 'SESSION_NOT_OWNED' })
  })
  it.each(rejectedSelections)('rejects shared consumer selection fixture: $name', async ({ input }) => {
    const { pool, a, b } = await setup()
    const value = structuredClone(input) as ConversationSelection
    if (value.hostId === hostA.hostId) value.hostId = a.hostId
    if (value.hostId === hostB.hostId) value.hostId = b.hostId
    if (value.connectionId === hostA.connectionId) value.connectionId = a.connectionId
    if (value.connectionId === hostB.connectionId) value.connectionId = b.connectionId
    expect(() => pool.selectConversation(value)).toThrow()
    expect(pool.selection).toBeNull()
  })
  it('isolates failure/reconnect and never clears selected B when A changes', async () => {
    const { pool, a, b, selectB, events } = await setup(); pool.selectConversation(selectB)
    calls.clients[0].alive = false; calls.clients[0].fail(new DesktopFailure('PROCESS_EXITED', 'A failed'))
    expect(pool.selection).toEqual(selectB)
    expect(pool.getConnection(b.connectionId!).status).toBe('ready')
    const next = await pool.reconnect({ hostId: a.hostId, connectionId: a.connectionId })
    expect(next.hostId).toBe(a.hostId); expect(next.connectionId).not.toBe(a.connectionId)
    expect(pool.selection).toEqual(selectB)
    const count = events.length
    calls.clients[0].notify(frame('session-a', { type: 'notice', level: 'info', code: 'late', text: 'old' }))
    expect(events).toHaveLength(count)
    await expect(pool.request({ ...stopA, connectionId: a.connectionId! })).rejects.toMatchObject({ code: 'STALE_CONNECTION' })
    expect(calls.clients[1].close).not.toHaveBeenCalled()
  })
  it('clears only a selected host on idle close without deleting saved sessions', async () => {
    const { pool, a, b, selectB } = await setup(); pool.selectConversation(selectB)
    await pool.closeHost(a)
    expect(pool.selection).toEqual(selectB)
    await pool.closeHost(b)
    expect(pool.selection).toBeNull()
    expect(calls.clients.flatMap(client => client.request.mock.calls).some(([method]: any[]) => method === 'session/delete')).toBe(false)
  })
  it('uses a hard live-host limit without eviction; closing idle or reaping failure frees a slot', async () => {
    const pool = new RuntimePool(() => {})
    for (let n = 0; n < MAX_RUNTIME_HOSTS; n++) await pool.connect('/approved/bingo', `/approved/${n}`)
    await expect(pool.connect('/approved/bingo', '/approved/ninth')).rejects.toMatchObject({ code: 'HOST_LIMIT' })
    const first = pool.connections[0]
    calls.clients[0].notify(frame('s', { type: 'turnStarted', turn: 't', inputs: [], origin: 'submit' }))
    await expect(pool.closeHost(first)).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })
    calls.clients[0].alive = false; calls.clients[0].fail(new DesktopFailure('PROCESS_EXITED', 'done'))
    await pool.connect('/approved/bingo', '/approved/ninth')
    await pool.closeHost(first)
    expect(calls.clients).toHaveLength(9)
  })
  it('refuses duplicate same-workspace binary hosts until the old process is fully closed', async () => {
    const { pool, a } = await setup()
    await expect(pool.connect('/approved/other-bingo', hostA.workspace!)).rejects.toMatchObject({ code: 'WORKSPACE_IN_USE' })
    await pool.closeHost(a)
    await expect(pool.connect('/approved/other-bingo', hostA.workspace!)).resolves.toMatchObject({ binary: '/approved/other-bingo' })
  })
  it('publishes one bounded global invalidation, not one failure snapshot per host', async () => {
    const { pool, events } = await setup(); events.length = 0
    pool.abort(new DesktopFailure('RENDERER_BACKPRESSURE', rendererInvalidated.type === 'runtime-invalidated' ? rendererInvalidated.error.message : 'full'))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'runtime-invalidated', error: { code: 'RENDERER_BACKPRESSURE' } })
    expect(Buffer.byteLength(JSON.stringify(events[0]))).toBeLessThan(1024)
    expect(pool.connections.every(state => state.status === 'failed')).toBe(true)
    for (const client of calls.clients) expect(client.close).toHaveBeenCalledOnce()
  })
  it('publishes failed-but-idle only after ordinary transport failure has really reaped its process', async () => {
    const { pool, a, events } = await setup()
    calls.clients[0].notify(frame('session-a', { type: 'turnStarted', turn: 't', inputs: [], origin: 'submit' }))
    let release!: () => void
    const retired = new Promise<void>(resolve => { release = resolve })
    calls.clients[0].close.mockImplementation(() => retired.then(() => { calls.clients[0].alive = false }))
    calls.clients[0].fail(new DesktopFailure('READ_FAILED', 'read failed before close'))
    expect(pool.connections.find(state => state.hostId === a.hostId)).toMatchObject({ status: 'failed', busy: true })
    release()
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: 'connection', connection: { hostId: a.hostId, connectionId: a.connectionId, status: 'failed', busy: false } }))
    await pool.closeHost(a)
  })
  it('waits for a delayed aggregate shutdown, then can ensure/open/select the same stable host again', async () => {
    const { pool, a } = await setup()
    let release!: () => void
    const retired = new Promise<void>(resolve => { release = resolve })
    calls.clients[0].close.mockImplementation(() => retired.then(() => { calls.clients[0].alive = false }))
    const closing = pool.close()
    let settled = false
    const barrier = pool.waitForClose().then(() => { settled = true })
    await Promise.resolve(); expect(settled).toBe(false)
    await expect(pool.connect(hostA.binary!, hostA.workspace!)).rejects.toMatchObject({ code: 'RUNTIME_CLOSING' })
    release(); await closing; await barrier
    const reopened = await pool.connect(hostA.binary!, hostA.workspace!)
    expect(reopened.hostId).toBe(a.hostId); expect(reopened.connectionId).not.toBe(a.connectionId)
    await pool.request({ connectionId: reopened.connectionId!, method: 'session/open', params: { selector: { kind: 'byId', id: 'session-a' } } })
    pool.selectConversation({ hostId: reopened.hostId, connectionId: reopened.connectionId, sessionId: 'session-a' })
    expect(pool.selection?.sessionId).toBe('session-a')
  })
  it('can reopen an explicitly closed idle project without changing its stable draft identity', async () => {
    const { pool, a } = await setup()
    await pool.closeHost(a)
    const reopened = await pool.connect(hostA.binary!, hostA.workspace!)
    expect(reopened.hostId).toBe(a.hostId); expect(reopened.connectionId).not.toBe(a.connectionId)
    await pool.request({ connectionId: reopened.connectionId!, method: 'session/open', params: { selector: { kind: 'byId', id: 'session-a' } } })
    pool.selectConversation({ hostId: reopened.hostId, connectionId: reopened.connectionId, sessionId: 'session-a' })
    expect(pool.selection?.connectionId).toBe(reopened.connectionId)
  })
  it('pins a workspace-validated byKey match to byId before sending the actual open', async () => {
    const { pool, a } = await setup()
    calls.clients[0].request.mockResolvedValueOnce({ heads: [{ id: 'session-a', key: 'shared-key', cwd: hostA.workspace, driver: 'model', createdAt: '', updatedAt: '', busy: false }], next: null })
    await pool.request({ connectionId: a.connectionId!, method: 'session/open', params: { selector: { kind: 'byKey', key: 'shared-key' } } })
    expect(calls.clients[0].request).toHaveBeenLastCalledWith('session/open', { selector: { kind: 'byId', id: 'session-a' }, options: { maxSnapshotBytes: 4 * 1024 * 1024 } })
  })
  it('does not resurrect a host while its explicit close is awaiting process reap', async () => {
    const { pool, a } = await setup()
    let release!: () => void
    const retired = new Promise<void>(resolve => { release = resolve })
    calls.clients[0].close.mockImplementation(() => retired.then(() => { calls.clients[0].alive = false }))
    const closing = pool.closeHost(a)
    const reconnecting = pool.connect(hostA.binary!, hostA.workspace!)
    const rejected = expect(reconnecting).rejects.toMatchObject({ code: 'RUNTIME_CLOSING' })
    release(); await closing; await rejected
    expect(calls.clients).toHaveLength(2)
  })
  it('never loads or deletes a session already owned by another live host', async () => {
    const { pool, b } = await setup()
    const count = calls.clients[1].request.mock.calls.length
    await expect(pool.request({ connectionId: b.connectionId!, method: 'session/open', params: { selector: { kind: 'byId', id: 'session-a' } } })).rejects.toMatchObject({ code: 'SESSION_NOT_OWNED' })
    await expect(pool.deleteSession(b.connectionId!, 'session-a')).rejects.toMatchObject({ code: 'SESSION_NOT_OWNED' })
    expect(calls.clients[1].request).toHaveBeenCalledTimes(count)
  })
})
