import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventParams, EventRefParams, OpenResult } from '../../shared/rpc'
const calls = vi.hoisted(() => ({ methods: [] as string[], clients: [] as Array<{ notify: (value: unknown) => void; fail: (error: unknown) => void; request: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> }))
vi.mock('./rpc-client', async (original) => {
  const actual = await original<typeof import('./rpc-client')>()
  return { ...actual, RpcClient: class {
    request = vi.fn(async () => ({}))
    close = vi.fn(async () => {})
    constructor(_options: unknown, notify: (value: unknown) => void, fail: (error: unknown) => void) { calls.clients.push({ notify, fail, request: this.request, close: this.close }) }
    async start() { return { name: 'bingo', version: 'test', protocol: 1, capabilities: { methods: calls.methods, notifications: [] } } }
  } }
})
import { DesktopRuntime } from './runtime'
import { DesktopFailure } from './rpc-client'
const snapshot: OpenResult = { session: 's', snapshot: { seq: 0, summary: { id: 's', cwd: '/project', createdAt: '', updatedAt: '' }, items: [] } }
function frame(event: EventParams['event'], seq = 1) { return { method: 'event', params: { seq, ts: '', session: 's', event } } }
beforeEach(() => { calls.clients.length = 0; calls.methods = [] })
describe('runtime connection ownership', () => {
  it('rejects stale requests and ignores events from an old connection', async () => {
    const emit = vi.fn(), runtime = new DesktopRuntime(emit)
    const old = await runtime.connect('/bin/bingo', '/project')
    const next = await runtime.connect('/bin/bingo', '/project')
    expect(calls.clients[0].close).toHaveBeenCalledOnce()
    const count = emit.mock.calls.length
    calls.clients[0].notify(frame({ type: 'notice', level: 'info', code: 'old', text: 'stale' }))
    expect(emit).toHaveBeenCalledTimes(count)
    await expect(runtime.request({ connectionId: old.connectionId!, method: 'session/list', params: {} })).rejects.toMatchObject({ code: 'STALE_CONNECTION' })
    await runtime.request({ connectionId: next.connectionId!, method: 'session/list', params: {} })
    expect(calls.clients[1].request).toHaveBeenCalledOnce()
  })
  it('holds uncertain permission/lifecycle references through later small completion until a current authoritative snapshot', async () => {
    const emit = vi.fn(), runtime = new DesktopRuntime(emit)
    const connection = await runtime.connect('/bin/bingo', '/project')
    const ref: EventRefParams = { session: 's', seq: 1, messageId: 'pending-int-1', eventType: 'interactionOpened', interaction: 'int-1', stateUncertain: true, generation: 0, availability: { kind: 'available', token: 'token' }, totalBytes: 17 * 1024 * 1024, checksum: 'a6a4eddc16724d5c' }
    calls.clients[0].notify({ method: 'eventRef', params: ref })
    expect(runtime.busy).toBe(true)
    await expect(runtime.request({ connectionId: connection.connectionId!, method: 'session/answer', params: { session: 's', interaction: 'int-1', intent: 'answer-1', answer: { kind: 'allowOnce' }, activation: 'pointer' } })).rejects.toMatchObject({ code: 'SESSION_UNCERTAIN' })
    calls.clients[0].notify(frame({ type: 'turnCompleted', turn: 'turn', status: { kind: 'completed' }, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } }, 2))
    expect(runtime.busy).toBe(true)
    const direct = emit.mock.calls.map(([event]) => event).filter(event => event.type === 'rpc')
    expect(direct.map(event => event.method)).toEqual(['eventRef', 'event'])
    calls.clients[0].request.mockResolvedValueOnce({ ...snapshot, snapshot: { ...snapshot.snapshot, seq: 2 } })
    await runtime.request({ connectionId: connection.connectionId!, method: 'session/open', params: { selector: { kind: 'byId', id: 's' } } })
    expect(runtime.busy).toBe(false)
  })
  it('allows a captured direct-turn Stop through a critical deferred ref but still blocks submit/permission and auto retry', async () => {
    const runtime = new DesktopRuntime(() => {})
    const conn = await runtime.connect('/bin/bingo', '/project')
    calls.clients[0].notify(frame({ type: 'turnStarted', turn: 'known-turn', inputs: [], origin: 'submit' }, 1))
    const ref: EventRefParams = { session: 's', seq: 2, messageId: 'permission-ref', eventType: 'interactionOpened', interaction: 'i', stateUncertain: true, generation: 0, availability: { kind: 'available', token: 'pin' }, totalBytes: 17 * 1024 * 1024, checksum: 'a6a4eddc16724d5c' }
    calls.clients[0].notify({ method: 'eventRef', params: ref })
    await expect(runtime.request({ connectionId: conn.connectionId!, method: 'session/submit', params: { session: 's', intent: 'submit-unsafe', input: { kind: 'text', text: 'unsafe', origin: { surface: 'desktop' } } } })).rejects.toMatchObject({ code: 'SESSION_UNCERTAIN' })
    await expect(runtime.request({ connectionId: conn.connectionId!, method: 'session/answer', params: { session: 's', intent: 'answer-unsafe', interaction: 'i', answer: { kind: 'allowOnce' }, activation: 'pointer' } })).rejects.toMatchObject({ code: 'SESSION_UNCERTAIN' })
    const target = { connectionId: conn.connectionId!, method: 'session/interrupt' as const, params: { session: 's', intent: 'stop-once', scope: { kind: 'turn' as const, turn: 'known-turn' } } }
    await runtime.request(target)
    expect(calls.clients[0].request.mock.calls).toEqual([['session/interrupt', target.params]])
    expect(runtime.busy).toBe(true) // No authoritative ack/ref hydration was fabricated.
  })
  it('never treats omitted critical snapshot fields as empty permission or queue state', async () => {
    const runtime = new DesktopRuntime(() => {})
    const connection = await runtime.connect('/bin/bingo', '/project')
    calls.clients[0].request.mockResolvedValueOnce({ ...snapshot, snapshot: { ...snapshot.snapshot, seq: 3 }, omittedFields: [{ path: ['interactions'], availability: { kind: 'available', token: 'pin' }, totalBytes: 17 * 1024 * 1024, checksum: 'a6a4eddc16724d5c' }] })
    await runtime.request({ connectionId: connection.connectionId!, method: 'session/open', params: { selector: { kind: 'byId', id: 's' } } })
    expect(runtime.busy).toBe(true)
    await expect(runtime.request({ connectionId: connection.connectionId!, method: 'session/answer', params: { session: 's', interaction: 'perhaps-login', intent: 'answer', answer: { kind: 'text', text: 'must-not-send' }, activation: 'pointer' } })).rejects.toMatchObject({ code: 'SESSION_UNCERTAIN' })
    calls.clients[0].request.mockResolvedValueOnce({ ...snapshot, snapshot: { ...snapshot.snapshot, seq: 4 } })
    await runtime.request({ connectionId: connection.connectionId!, method: 'session/open', params: { selector: { kind: 'byId', id: 's' } } })
    expect(runtime.busy).toBe(false)
  })
  it('ignores same-connection event and gateway tails after abort', async () => {
    const emit = vi.fn(), runtime = new DesktopRuntime(emit)
    await runtime.connect('/bin/bingo', '/project')
    runtime.abort(new DesktopFailure('RENDERER_BACKPRESSURE', 'stalled'))
    const count = emit.mock.calls.length
    calls.clients[0].notify(frame({ type: 'turnStarted', turn: 'tail', inputs: [], origin: 'submit' }))
    calls.clients[0].notify({ method: 'gateway/event', params: { seq: 1, event: { type: 'tail' } } })
    expect(emit).toHaveBeenCalledTimes(count)
    expect(runtime.busy).toBe(false)
    expect(runtime.connection.status).toBe('failed')
  })
  it('keeps an abort notice small even when runtime capabilities are large', async () => {
    const emit = vi.fn(), runtime = new DesktopRuntime(emit)
    // 4096-character paths can expand to six JSON bytes per character. The
    // initialize schema also permits large capabilities within its 16 MiB line.
    calls.methods = ['x'.repeat(1024 * 1024)]
    await runtime.connect('\u0001'.repeat(4096), '\u0001'.repeat(4096))
    runtime.abort(new DesktopFailure('RENDERER_BACKPRESSURE', 'stalled'))
    expect(Buffer.byteLength(JSON.stringify(emit.mock.calls.at(-1)![0]))).toBeLessThan(64 * 1024)
    expect(runtime.connection.server).toBeUndefined()
  })
  it('checks renderer recovery before changing state or starting a replacement runtime', async () => {
    const beforeConnect = vi.fn(), runtime = new DesktopRuntime(() => {}, beforeConnect)
    await runtime.connect('/bin/bingo', '/project')
    runtime.abort(new DesktopFailure('RENDERER_BACKPRESSURE', 'stalled'))
    const failed = runtime.connection
    beforeConnect.mockImplementationOnce(() => { throw new DesktopFailure('RENDERER_BACKPRESSURE', 'not drained') })
    await expect(runtime.connect('/bin/bingo', '/project')).rejects.toMatchObject({ code: 'RENDERER_BACKPRESSURE' })
    expect(runtime.connection).toEqual(failed)
    expect(calls.clients).toHaveLength(1)
    expect(calls.clients[0].close).toHaveBeenCalledOnce()
    await runtime.connect('/bin/bingo', '/project')
    expect(runtime.connection.status).toBe('ready')
    expect(calls.clients).toHaveLength(2)
  })
  it.each(['disconnected', 'connecting'])('does not spawn after %s publication synchronously aborts delivery', async (status) => {
    const failure = new DesktopFailure('RENDERER_BACKPRESSURE', 'full')
    const runtime = new DesktopRuntime((event) => {
      if (event.type === 'connection' && event.connection.status === status) runtime.abort(failure)
    })
    await expect(runtime.connect('/bin/bingo', '/project')).rejects.toMatchObject({ code: 'CONNECT_FAILED' })
    expect(runtime.connection.status).toBe('failed')
    expect(calls.clients).toHaveLength(0)
  })
  it('tracks real running work from authoritative snapshots and frames', async () => {
    const runtime = new DesktopRuntime(() => {})
    const connection = await runtime.connect('/bin/bingo', '/project')
    calls.clients[0].request.mockResolvedValue(snapshot)
    await runtime.request({ connectionId: connection.connectionId!, method: 'session/open', params: { selector: { kind: 'byId', id: 's' } } })
    expect(runtime.busy).toBe(false)
    calls.clients[0].notify(frame({ type: 'turnStarted', turn: 't', inputs: [], origin: 'submit' }))
    expect(runtime.busy).toBe(true)
    calls.clients[0].notify(frame({ type: 'turnCompleted', turn: 't', status: { kind: 'completed' }, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } }, 2))
    expect(runtime.busy).toBe(false)
  })
  it('stays busy after the submit RPC reply until authoritative intent outcome', async () => {
    const runtime = new DesktopRuntime(() => {})
    const connection = await runtime.connect('/bin/bingo', '/project')
    await runtime.request({ connectionId: connection.connectionId!, method: 'session/submit', params: { session: 's', intent: 'submit-1', input: { kind: 'text', text: 'hello', origin: { surface: 'desktop' } } } })
    expect(runtime.busy).toBe(true)
    calls.clients[0].notify(frame({ type: 'intentAck', intent: 'submit-1', outcome: { kind: 'turnStarted', turn: 't' } }, 1))
    expect(runtime.busy).toBe(true)
    calls.clients[0].notify(frame({ type: 'turnCompleted', turn: 't', status: { kind: 'completed' }, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } }, 2))
    expect(runtime.busy).toBe(false)
    await runtime.request({ connectionId: connection.connectionId!, method: 'session/submit', params: { session: 's', intent: 'submit-2', input: { kind: 'text', text: '/help', origin: { surface: 'desktop' } } } })
    expect(runtime.busy).toBe(true)
    calls.clients[0].notify(frame({ type: 'intentAck', intent: 'submit-2', outcome: { kind: 'applied', result: null } }, 3))
    expect(runtime.busy).toBe(false)
  })
  it('clears pending submit intent on definite core rejection, not transport uncertainty', async () => {
    const runtime = new DesktopRuntime(() => {})
    const connection = await runtime.connect('/bin/bingo', '/project')
    const request = { connectionId: connection.connectionId!, method: 'session/submit' as const, params: { session: 's', intent: 'submit-1', input: { kind: 'text' as const, text: 'hello', origin: { surface: 'desktop' } } } }
    calls.clients[0].request.mockRejectedValueOnce(new Error('Core refused request'))
    await expect(runtime.request(request)).rejects.toThrow()
    expect(runtime.busy).toBe(false)
    await runtime.request(request)
    calls.clients[0].fail({ code: 'PROCESS_EXITED', message: 'Stopped' })
    expect(runtime.busy).toBe(true)
    await runtime.close()
    expect(runtime.busy).toBe(false)
  })
  it('counts pending non-submit RPC work as busy until its response settles', async () => {
    const runtime = new DesktopRuntime(() => {})
    const connection = await runtime.connect('/bin/bingo', '/project')
    let resolve!: (value: unknown) => void
    calls.clients[0].request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = runtime.request({ connectionId: connection.connectionId!, method: 'session/list', params: {} })
    expect(runtime.busy).toBe(true)
    resolve({ sessions: [] }); await pending
    expect(runtime.busy).toBe(false)
  })
  it('rejects an old snapshot response after abort instead of mutating live activity', async () => {
    const runtime = new DesktopRuntime(() => {})
    const connection = await runtime.connect('/bin/bingo', '/project')
    let resolve!: (value: unknown) => void
    calls.clients[0].request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = runtime.request({ connectionId: connection.connectionId!, method: 'session/open', params: { selector: { kind: 'byId', id: 's' } } })
    runtime.abort(new DesktopFailure('PROCESS_EXITED', 'gone'))
    resolve(snapshot)
    await expect(pending).rejects.toMatchObject({ code: 'STALE_CONNECTION' })
  })
  it('refuses pasted login secrets before any session/answer RPC write', async () => {
    const runtime = new DesktopRuntime(() => {})
    const connection = await runtime.connect('/bin/bingo', '/project')
    calls.clients[0].notify(frame({ type: 'interactionOpened', interaction: { id: 'login', session: 's', openedAt: '', kind: { kind: 'login', provider: 'test', flow: { kind: 'paste' } }, answers: ['text', 'cancel'] } }))
    const input = { connectionId: connection.connectionId!, method: 'session/answer' as const, params: { session: 's', intent: 'i', interaction: 'login', answer: { kind: 'text' as const, text: 'secret-must-not-cross' }, activation: 'pointer' as const } }
    await expect(runtime.request(input)).rejects.toMatchObject({ code: 'UNSAFE_CREDENTIAL_FLOW' })
    expect(calls.clients[0].request).not.toHaveBeenCalled()
    await runtime.request({ ...input, params: { ...input.params, answer: { kind: 'cancel' } } })
    expect(calls.clients[0].request).toHaveBeenCalledOnce()
  })
})
