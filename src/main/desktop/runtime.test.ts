import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventParams, OpenResult } from '../../shared/rpc'
const calls = vi.hoisted(() => ({ clients: [] as Array<{ notify: (value: unknown) => void; fail: (error: unknown) => void; request: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> }))
vi.mock('./rpc-client', async (original) => {
  const actual = await original<typeof import('./rpc-client')>()
  return { ...actual, RpcClient: class {
    request = vi.fn(async () => ({}))
    close = vi.fn(async () => {})
    constructor(_options: unknown, notify: (value: unknown) => void, fail: (error: unknown) => void) { calls.clients.push({ notify, fail, request: this.request, close: this.close }) }
    async start() { return { name: 'bingo', version: 'test', protocol: 1, capabilities: { methods: [], notifications: [] } } }
  } }
})
import { DesktopRuntime } from './runtime'
const snapshot: OpenResult = { session: 's', snapshot: { seq: 0, summary: { id: 's', cwd: '/project', createdAt: '', updatedAt: '' }, items: [] } }
function frame(event: EventParams['event'], seq = 1) { return { method: 'event', params: { seq, ts: '', session: 's', event } } }
beforeEach(() => { calls.clients.length = 0 })
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
