import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { RpcClient, redactSecrets, unknownEventType, withDiagnostics, type RpcNotification, type DesktopFailure } from './rpc-client'

const clients: RpcClient[] = []
const fixture = fileURLToPath(new URL('./__fixtures__/rpc-host.cjs', import.meta.url))
function create(mode = 'normal', timeout = 1000) {
  const events: RpcNotification[] = [], failures: DesktopFailure[] = []
  const client = new RpcClient({ binary: process.execPath, cwd: process.cwd(), args: [fixture, mode], timeout }, (event) => events.push(event), (error) => failures.push(error))
  clients.push(client)
  return { client, events, failures }
}
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())) })

describe('native bingo stdio client', () => {
  it('initializes and correlates concurrent out-of-order replies', async () => {
    const { client } = create()
    expect((await client.start()).protocol).toBe(1)
    const [first, second] = await Promise.all([client.request('session/list', {}), client.request('session/list', {})])
    expect(first.sessions[0].title).toBe('1')
    expect(second.sessions[0].title).toBe('2')
  })
  it('observes the authoritative snapshot before a same-chunk following event', async () => {
    const order: string[] = []
    const client = new RpcClient({ binary: process.execPath, cwd: process.cwd(), args: [fixture] }, () => order.push('frame'), () => {}, (method) => { if (method === 'session/open') order.push('snapshot') })
    clients.push(client)
    await client.start()
    await client.request('session/open', { selector: { kind: 'byId', id: 's' } })
    await client.request('catalog/read', { kind: 'tools' })
    expect(order).toEqual(['snapshot', 'frame'])
  })
  it('retains an untouched valid 15 MiB legacy session/open response', async () => {
    const { client, failures } = create('large-open-15', 10000)
    await client.start()
    const opened = await client.request('session/open', { selector: { kind: 'byId', id: 'fixture-session' } })
    expect(opened.snapshot.items[0].body).toMatchObject({ kind: 'assistant', text: 'x'.repeat(15 * 1024 * 1024) })
    expect(failures).toHaveLength(0)
  })
  it.each(['large-open-17', 'large-history-17'])('reproduces exact oversized %s response without treating missing recorded data as success', async mode => {
    const { client, failures } = create(mode, 10000)
    await client.start()
    if (mode === 'large-history-17') {
      await client.request('session/open', { selector: { kind: 'byId', id: 'fixture-session' } })
      await expect(client.request('session/history', { session: 'fixture-session', page: { limit: 50 } })).rejects.toMatchObject({ code: 'PROTOCOL_LIMIT' })
    } else await expect(client.request('session/open', { selector: { kind: 'byId', id: 'fixture-session' } })).rejects.toMatchObject({ code: 'PROTOCOL_LIMIT' })
    expect(failures).toHaveLength(1)
    await expect(client.request('session/list', {})).rejects.toMatchObject({ code: 'DISCONNECTED' })
  })
  it('rejects an oversized notification atomically without exposing a partial frame', async () => {
    const { client, events, failures } = create('large-event-17', 10000)
    await client.start()
    await client.request('session/open', { selector: { kind: 'byId', id: 'fixture-session' } })
    await client.request('session/events', { session: 'fixture-session', since: 0 }).catch(() => {})
    await expect.poll(() => failures.length, { timeout: 10000 }).toBe(1)
    expect(failures[0].code).toBe('PROTOCOL_LIMIT')
    expect(events.some(event => event.method === 'event' && event.params.event.type === 'itemDelta')).toBe(false)
  })
  it('parses an opt-in eventRef before a following small canonical lifecycle and a sourced gateway ID', async () => {
    const { client, events, failures } = create('bounded-notifications')
    await client.start()
    await client.request('session/open', { selector: { kind: 'byId', id: 'fixture-session' } })
    await client.request('session/events', { session: 'fixture-session', since: 0 })
    await client.request('gateway/subscribe', { maxBytes: 4096 })
    await expect.poll(() => events.some(event => event.method === 'gateway/sessionHead'), { timeout: 1000 }).toBe(true)
    expect(events.filter(event => event.method === 'eventRef' || event.method === 'event').slice(-2).map(event => event.method === 'eventRef' ? [event.params.seq, event.params.messageId] : [event.params.seq, event.params.event.type])).toEqual([[2, 'ref-1'], [3, 'turnCompleted']])
    expect(failures).toHaveLength(0)
  })
  it('reads UTF-8 split across native stdout chunks', async () => {
    const { client } = create('split')
    expect((await client.start()).version).toBe('🧪fixture')
  })
  it('carries snapshot, history, events, intent replies, interruptions, answers, and catalogs unchanged', async () => {
    const { client, events } = create()
    await client.start()
    const opened = await client.request('session/open', { selector: { kind: 'create', spec: { cwd: process.cwd(), driver: 'log' } } })
    expect(opened.snapshot.seq).toBe(0)
    const session = opened.session
    expect(await client.request('session/history', { session, page: { limit: 50 } })).toEqual({ items: [], generation: 0 })
    await client.request('session/events', { session, since: 0 })
    await client.request('session/submit', { session, intent: 'intent-1', input: { kind: 'text', text: 'hello', origin: { surface: 'desktop' } } })
    await client.request('session/interrupt', { session, intent: 'intent-2', scope: { kind: 'head' } })
    await client.request('session/answer', { session, intent: 'intent-3', interaction: 'question', activation: 'pointer', answer: { kind: 'cancel' } })
    await client.request('gateway/subscribe', {})
    expect(await client.request('catalog/read', { kind: 'models' })).toEqual({ kind: 'models', entries: [] })
    expect(events.filter((event) => event.method === 'event').map((event) => event.params.event.type)).toEqual(['notice', 'notice', 'intentAck'])
    expect(events.some((event) => event.method === 'gateway/event')).toBe(true)
  })
  it.each(['bad-json', 'oversized', 'truncated', 'exit', 'wrong-protocol'])('fails explicitly for %s output', async (mode) => {
    const { client, failures } = create(mode)
    await expect(client.start()).rejects.toThrow()
    expect(failures).toHaveLength(1)
    await expect(client.request('session/list', {})).rejects.toMatchObject({ code: 'DISCONNECTED' })
  })
  it.each(['uncorrelated', 'invalid-result'])('invalidates the connection on %s', async (mode) => {
    const { client, failures } = create(mode)
    await client.start()
    await expect(client.request('session/list', {})).rejects.toMatchObject({ code: 'INVALID_PROTOCOL' })
    expect(failures).toHaveLength(1)
  })
  it('exposes stable core errors without declaring transport failure', async () => {
    const { client, failures } = create('rpc-error')
    await client.start()
    await expect(client.request('session/list', {})).rejects.toMatchObject({ code: 'sessionNotFound', message: 'Fixture rejected this request.' })
    expect(failures).toHaveLength(0)
    expect(await client.request('catalog/read', { kind: 'tools' })).toEqual({ kind: 'tools', entries: [] })
  })
  it('invalidates all pending requests when a write times out without retrying it', async () => {
    const { client, failures } = create('timeout', 150)
    await client.start()
    const results = await Promise.allSettled([client.request('session/submit', { session: 's', intent: 'i', input: { kind: 'text', text: 'x', origin: { surface: 'desktop' } } }), client.request('session/list', {})])
    expect(results.map(result => result.status === 'rejected' && result.reason.code)).toEqual(['REQUEST_TIMEOUT', 'REQUEST_TIMEOUT'])
    expect(failures).toHaveLength(1)
  })
  it('fails only a timed-out idempotent read and silently drops its late reply', async () => {
    const { client, failures } = create('late-read', 150)
    await client.start()
    await expect(client.request('session/list', {})).rejects.toMatchObject({ code: 'TIMEOUT' })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(await client.request('catalog/read', { kind: 'tools' })).toEqual({ kind: 'tools', entries: [] })
    expect(failures).toHaveLength(0)
  })
  it('keeps the connection when a desktop consumer throws', async () => {
    const failures: DesktopFailure[] = [], error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = new RpcClient({ binary: process.execPath, cwd: process.cwd(), args: [fixture] }, () => { throw new Error('ui exploded') }, (failure) => failures.push(failure), () => { throw new Error('observer exploded') })
    clients.push(client)
    await client.start()
    expect((await client.request('session/open', { selector: { kind: 'byId', id: 's' } })).session).toBe('fixture-session')
    expect(await client.request('catalog/read', { kind: 'tools' })).toEqual({ kind: 'tools', entries: [] })
    expect(failures).toHaveLength(0)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
  it('drops unknown event variants but still rejects malformed known events', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, events, failures } = create('unknown-event')
    await client.start()
    await client.request('session/events', { session: 'fixture-session', since: 0 })
    await expect.poll(() => events.length).toBe(1)
    expect(events[0]).toMatchObject({ method: 'event', params: { seq: 2, event: { type: 'notice' } } })
    expect(failures).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('futureThing'))
    warn.mockRestore()
    const invalid = create('invalid-event')
    await invalid.client.start()
    await invalid.client.request('session/events', { session: 'fixture-session', since: 0 }).catch(() => {})
    await expect.poll(() => invalid.failures.map(failure => failure.code)).toEqual(['INVALID_PROTOCOL'])
    expect(unknownEventType({ event: { type: 'notice' } })).toBeNull()
    expect(unknownEventType({ event: {} })).toBeNull()
  })
  it('reports a redacted, bounded stderr tail when bingo exits', async () => {
    const { client, failures } = create('stderr-exit')
    await client.start()
    await expect(client.request('session/list', {})).rejects.toMatchObject({ code: 'PROCESS_EXITED' })
    const message = failures[0].message
    expect(message).toMatch(/^bingo stopped \(exit 3\)/)
    expect(message).toContain('fatal: boom')
    expect(message.length).toBeLessThanOrEqual(2048)
    expect(message).not.toMatch(/abc123|tok\.en-1|0123456789abcdef|xxxx/)
  })
  it('bounds concurrent requests and payload bytes', async () => {
    const { client } = create('timeout', 500)
    await client.start()
    await expect(client.request('session/submit', { session: 's', intent: 'i', input: { kind: 'text', text: 'x'.repeat(16 * 1024 * 1024), origin: { surface: 'desktop' } } })).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
    const pending = Array.from({ length: 32 }, () => client.request('session/list', {}).catch(() => {}))
    await expect(client.request('session/list', {})).rejects.toMatchObject({ code: 'BACKPRESSURE' })
    await client.close()
    await Promise.all(pending)
  })
  it('closes idempotently and terminates a process ignoring shutdown', async () => {
    const { client, failures } = create('ignore-shutdown', 5000)
    await client.start()
    await Promise.all([client.close(), client.close()])
    expect(failures).toHaveLength(0)
    await expect(client.request('session/list', {})).rejects.toMatchObject({ code: 'DISCONNECTED' })
  })
  it('reports spawn errors without unhandled stream errors', async () => {
    const failures: DesktopFailure[] = []
    const client = new RpcClient({ binary: '/missing/bingo-executable', cwd: process.cwd() }, () => {}, (error) => failures.push(error))
    clients.push(client)
    await expect(client.start()).rejects.toMatchObject({ code: 'START_FAILED' })
    expect(failures).toHaveLength(1)
  })
})

describe('stderr diagnostics', () => {
  it('redacts common credential shapes', () => {
    expect(redactSecrets('key sk-ant-api03-abcdef Bearer abc.def OPENAI_API_KEY=xyz token: "q1" password=hunter2 ok')).toBe('key sk-[redacted] Bearer [redacted] OPENAI_API_KEY=[redacted] token: "[redacted]" password=[redacted] ok')
  })
  it('keeps messages within the desktop error budget', () => {
    expect(withDiagnostics('stopped.', '')).toBe('stopped.')
    const message = withDiagnostics('stopped.', 'y'.repeat(5000) + 'END')
    expect(message.length).toBe(2048)
    expect(message.endsWith('END')).toBe(true)
  })
})
