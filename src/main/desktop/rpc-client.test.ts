import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { RpcClient, type RpcNotification, type DesktopFailure } from './rpc-client'

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
  it('invalidates all pending requests on timeout without retrying writes', async () => {
    const { client, failures } = create('timeout', 150)
    await client.start()
    const results = await Promise.allSettled([client.request('session/list', {}), client.request('session/list', {})])
    expect(results.every((result) => result.status === 'rejected' && result.reason.code === 'REQUEST_TIMEOUT')).toBe(true)
    expect(failures).toHaveLength(1)
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
