import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import type { Frame, RpcMethod, SessionState } from '../../src/shared/rpc'
import { rpcNotificationSchemas, rpcParamsSchemas, rpcResultSchemas } from '../../src/main/desktop/rpc-validation'

// These prove the acceptance DOUBLE can expose races; they are not core/provider tests.
const children: ChildProcessWithoutNullStreams[] = []
afterEach(async () => {
  await Promise.all(children.splice(0).map(child => new Promise<void>(done => {
    if (child.exitCode !== null || child.signalCode !== null) return done()
    child.once('exit', () => done()); child.kill('SIGTERM')
  })))
})
async function host(root?: string, project = 'P') {
  const home = root ?? await mkdtemp(join(tmpdir(), 'rei-multi-fixture-'))
  const projectPath = join(home, project), control = join(home, 'control')
  await mkdir(projectPath, { recursive: true })
  const cwd = await realpath(projectPath)
  const child = spawn(process.execPath, [resolve('tests/fixtures/multisession-host.cjs')], { cwd, env: { PATH: process.env.PATH, HOME: home, REI_FIXTURE_CONTROL: control } })
  children.push(child)
  const messages: any[] = [], changed = new EventEmitter(), wireErrors: Error[] = []
  let id = 0, stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const message = JSON.parse(line)
      if (message.method) {
        const schema = rpcNotificationSchemas[message.method as keyof typeof rpcNotificationSchemas]
        if (!schema && !['eventRef', 'gateway/sessionHead'].includes(message.method)) throw new Error(`Unknown wire notification ${message.method}`)
        // Once v3 shared bindings are integrated, validate their frozen shapes too.
        schema?.parse(message.params)
      }
      messages.push(message)
    } catch (error) { wireErrors.push(error as Error) }
    changed.emit('message')
  })
  const wait = (predicate: (message: any) => boolean) => new Promise<any>((yes, no) => {
    const inspect = () => { if (wireErrors.length) { clearTimeout(timer); changed.off('message', inspect); no(wireErrors[0]); return }; const value = messages.find(predicate); if (value) { clearTimeout(timer); changed.off('message', inspect); yes(value) } }
    const timer = setTimeout(() => { changed.off('message', inspect); no(new Error(`Fixture message not received. stderr: ${stderr}`)) }, 3000)
    changed.on('message', inspect); inspect()
  })
  const wire = (method: string, params: unknown = {}) => { const requestId = ++id; child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n'); return wait(message => message.id === requestId) }
  const request = (method: RpcMethod, params: unknown = {}) => { rpcParamsSchemas[method].parse(params); return wire(method, params).then(message => { if (message.error) throw new Error(message.error.message); rpcResultSchemas[method].parse(message.result); return message.result }) }
  await request('initialize', { protocol: 1, client: { name: 'test', surface: 'desktop' } })
  const endpoint = JSON.parse(await readFile(join(control, `${project}.json`), 'utf8')).endpoint as string
  const command = async (body: Record<string, unknown>) => { const response = await fetch(`${endpoint}/control`, { method: 'POST', body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(JSON.stringify(result)) }
  const state = async () => await (await fetch(`${endpoint}/state`)).json() as { sessions: SessionState[]; epoch: string }
  const frames = () => messages.filter(message => message.method === 'event').map(message => message.params as Frame)
  const event = (predicate: (frame: Frame) => boolean) => wait(message => message.method === 'event' && predicate(message.params))
  const notification = (method: string) => wait(message => message.method === method)
  const open = async (session: string) => request('session/open', { selector: { kind: 'byId', id: session } })
  const submit = async (session: string, text: string, intent: string) => request('session/submit', { session, intent, input: { kind: 'text', text, origin: { surface: 'desktop' } } })
  return { home, cwd, child, control, request, wire, command, state, frames, event, notification, open, submit }
}

describe('deterministic multisession acceptance host', () => {
  it('holds A acknowledgment while B runs and routes permissions and stop to only their source', async () => {
    const runtime = await host()
    await runtime.open('a'); await runtime.open('b')
    await runtime.submit('a', 'hold-ack', 'send-a')
    await runtime.submit('b', 'work', 'send-b')
    await runtime.event(frame => frame.session === 'b' && frame.event.type === 'turnStarted')
    expect(runtime.frames().some(frame => frame.event.type === 'intentAck' && frame.event.intent === 'send-a')).toBe(false)
    await runtime.command({ op: 'releaseAck', session: 'a' })
    await runtime.event(frame => frame.session === 'a' && frame.event.type === 'turnStarted')
    await runtime.command({ op: 'permission', session: 'a' })
    await runtime.request('session/answer', { session: 'a', interaction: 'a-permission', answer: { kind: 'allowOnce' }, intent: 'answer-a', activation: 'pointer' })
    await runtime.submit('a', 'queued follow-up', 'queue-a')
    await runtime.event(frame => frame.event.type === 'queueChanged')
    await runtime.request('session/interrupt', { session: 'b', intent: 'stop-b', scope: { kind: 'head' } })
    const { sessions } = await runtime.state()
    expect(sessions.find(state => state.summary.id === 'a')?.turn).toBeDefined()
    expect(sessions.find(state => state.summary.id === 'a')?.interactions).toEqual([])
    expect(sessions.find(state => state.summary.id === 'a')?.queue?.[0].preview).toBe('queued follow-up')
    expect(sessions.find(state => state.summary.id === 'b')?.turn).toBeUndefined()
    expect(sessions.find(state => state.summary.id === 'b')?.lastTurn?.status.kind).toBe('interrupted')
  })

  it('replays a tree child through its ancestor without attaching its direct port', async () => {
    const runtime = await host()
    await runtime.open('a')
    await runtime.command({ op: 'treeChild', session: 'a' })
    const replay = await runtime.event(frame => frame.root === 'a' && frame.session === 'P-child' && frame.event.type === 'itemCompleted')
    expect(replay.params.event.item.body).toEqual({ kind: 'assistant', text: 'TREE_REPLAY_ONLY' })
    const child = (await runtime.state()).sessions.find(state => state.summary.id === 'P-child')
    expect(child?.summary.parent?.session).toBe('a')
    expect(child?.summary.key).toBe('agent/a/child')
    expect((await runtime.wire('session/children', { parent: 'a', maxBytes: 4096 })).result).toEqual({ children: ['P-child'] })
    expect((await runtime.wire('session/children', { parent: 'a', after: 'P-child', maxBytes: 4096 })).result).toEqual({ children: [] })
    await runtime.request('session/open', { selector: { kind: 'byId', id: 'P-child' }, options: { children: false } })
    await runtime.submit('P-child', 'direct child message', 'child-direct')
    await runtime.event(frame => frame.session === 'P-child' && frame.event.type === 'intentAck' && frame.event.intent === 'child-direct')
  })

  it('pages one thousand old child IDs without opening their ports or enumerating grandchildren prematurely', async () => {
    const runtime = await host()
    await runtime.open('a')
    await runtime.command({ op: 'seedTree', session: 'a', count: 1000 })
    const ids = new Set<string>()
    let after: string | undefined
    for (;;) {
      const message = await runtime.wire('session/children', { parent: 'a', after, maxBytes: 4096 })
      expect(Buffer.byteLength(JSON.stringify(message), 'utf8')).toBeLessThanOrEqual(4096)
      const page = message.result
      for (const id of page.children) { expect(ids.has(id)).toBe(false); ids.add(id) }
      if (!page.next) break
      expect(page.next).toBe(page.children.at(-1))
      after = page.next
    }
    expect(ids.size).toBe(1000)
    expect([...ids].every(id => id.startsWith('P-child-'))).toBe(true)
    const denied = await runtime.wire('session/children', { parent: 'P-child-0000', maxBytes: 4096 })
    expect(denied.error).toBeTruthy()
    await runtime.wire('session/open', { selector: { kind: 'byId', id: 'P-child-0000' }, options: { children: false, maxSnapshotBytes: 4 * 1024 * 1024 } })
    expect((await runtime.wire('session/children', { parent: 'P-child-0000', maxBytes: 4096 })).result).toEqual({ children: ['P-grandchild-0000'] })
    const audit = (await readFile(join(runtime.control, 'P.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(audit.filter(row => row.kind === 'request' && row.method === 'session/open').map(row => row.params.selector.id)).toEqual(['a', 'P-child-0000'])
  }, 30000)

  it('bounds a 17MiB title before direct open while the legacy list explicitly refuses its line', async () => {
    const runtime = await host()
    await runtime.command({ op: 'oversizeSummary', session: 'a', field: 'title' })
    const legacy = await runtime.wire('session/list')
    expect(legacy.error.data.code).toBe('PROTOCOL_LIMIT')
    const first = await runtime.wire('session/listHeads', { filter: { cwd: runtime.cwd }, maxBytes: 4096 })
    expect(first.result.heads.map((entry: any) => entry.id)).toEqual(['a', 'b'])
    expect(first.result.next).toBeUndefined()
    expect(first.result.heads[0].cwd).toBe(runtime.cwd)
    expect(first.result.heads[0].title).toBeUndefined()
    expect(first.result.heads[0].omitted).toEqual([{ field: 'title', totalBytes: 17 * 1024 * 1024, reason: 'openSessionToReadField' }])
    const end = await runtime.wire('session/listHeads', { filter: { cwd: runtime.cwd }, after: 'b', maxBytes: 4096 })
    expect(end.result).toEqual({ heads: [] })
    const opened = await runtime.wire('session/open', { selector: { kind: 'byId', id: 'a' }, options: { maxSnapshotBytes: 4 * 1024 * 1024 } })
    expect(opened.result.snapshot.summary).toMatchObject({ id: 'a', cwd: runtime.cwd })
    expect(opened.result.snapshot.summary.title).toBeUndefined()
    expect(opened.result.history).toEqual({ before: null, hasMore: false, generation: 0 })
    const reference = opened.result.omittedFields[0]
    expect(reference.path).toEqual(['summary', 'title'])
    expect(reference.availability.kind).toBe('available')
    expect(reference.totalBytes).toBe(17 * 1024 * 1024 + 2)
    const part = await runtime.wire('session/fieldPart', { session: 'a', token: reference.availability.token, offset: 0, maxBytes: 1024 })
    expect(part.result).toMatchObject({ totalBytes: reference.totalBytes, nextOffset: 1024 })
    expect(part.result.data).toBe('"' + 'X'.repeat(1023))
  }, 30000)

  it('omits optional escaped head fields until the complete JSON-RPC line fits', async () => {
    const runtime = await host()
    await runtime.command({ op: 'escapedSummary', session: 'a' })
    const response = await runtime.wire('session/listHeads', { filter: { cwd: runtime.cwd }, maxBytes: 1024 })
    expect(Buffer.byteLength(JSON.stringify(response), 'utf8')).toBeLessThanOrEqual(1024)
    const head = response.result.heads[0]
    expect(head).toMatchObject({ id: 'a', cwd: runtime.cwd, driver: 'model', busy: false })
    expect(head.omitted.length).toBeGreaterThan(0)
    for (const omission of head.omitted) {
      expect(head[omission.field]).toBeUndefined()
      expect(omission).toMatchObject({ totalBytes: 200, reason: 'openSessionToReadField' })
    }
  })

  it('represents a 17MiB history item with an empty first window, exact part, and advancing exclusive cursor', async () => {
    const runtime = await host()
    await runtime.command({ op: 'oversizeHistory', session: 'a' })
    expect((await runtime.wire('session/open', { selector: { kind: 'byId', id: 'a' } })).error.data.code).toBe('PROTOCOL_LIMIT')
    const opened = await runtime.wire('session/open', { selector: { kind: 'byId', id: 'a' }, options: { maxSnapshotBytes: 4 * 1024 * 1024 } })
    expect(opened.result.snapshot.summary).toMatchObject({ id: 'a', cwd: runtime.cwd, messages: 1 })
    expect(opened.result.snapshot.items).toEqual([])
    expect(opened.result.history).toEqual({ before: null, hasMore: true, generation: 3 })
    const first = await runtime.wire('session/history', { session: 'a', page: { limit: 20, maxBytes: 4 * 1024 * 1024, generation: 3 } })
    expect(first.result.items).toEqual([])
    expect(first.result.next).toBe('P-oversized-history')
    const ref = first.result.oversized
    expect(ref).toMatchObject({ id: first.result.next, availability: { kind: 'available' } })
    expect(ref.totalBytes).toBeGreaterThan(17 * 1024 * 1024)
    expect(ref.checksum).toMatch(/^[0-9a-f]{16}$/)
    const part = await runtime.wire('session/itemPart', { session: 'a', item: ref.id, generation: 3, token: ref.availability.token, offset: 0, maxBytes: 1024 })
    expect(part.result.data).toContain('P-oversized-history')
    expect(part.result).toMatchObject({ nextOffset: 1024, totalBytes: ref.totalBytes })
    const after = await runtime.wire('session/history', { session: 'a', page: { before: first.result.next, limit: 20, maxBytes: 4 * 1024 * 1024, generation: 3 } })
    expect(after.result).toEqual({ items: [], generation: 3 })
    expect((await runtime.wire('session/history', { session: 'a', page: { before: 'missing-item', limit: 20, maxBytes: 4 * 1024 * 1024, generation: 3 } })).error.message).toBe('STALE_GENERATION')
    await runtime.wire('session/close', { session: 'a' })
    expect((await runtime.wire('session/itemPart', { session: 'a', item: ref.id, generation: 3, token: ref.availability.token, offset: 0, maxBytes: 1024 })).error).toBeTruthy()
  }, 30000)

  it('defers a 17MiB live item but still delivers its next small lifecycle frame', async () => {
    const runtime = await host()
    const opened = await runtime.wire('session/open', { selector: { kind: 'byId', id: 'a' }, options: { children: true, maxSnapshotBytes: 4 * 1024 * 1024, treeBackfill: 'liveOnly' } })
    expect(opened.result.tree).toEqual({ backfill: 'liveOnly', descendantsComplete: false })
    await runtime.command({ op: 'oversizeEvent', session: 'a' })
    const reference = (await runtime.notification('eventRef')).params
    expect(reference).toMatchObject({ session: 'a', eventType: 'itemCompleted', item: 'P-oversized-live', stateUncertain: false, generation: 3, availability: { kind: 'available' } })
    expect(reference.totalBytes).toBeGreaterThan(17 * 1024 * 1024)
    expect(reference.checksum).toMatch(/^[0-9a-f]{16}$/)
    const completed = await runtime.event(frame => frame.session === 'a' && frame.event.type === 'turnCompleted')
    expect(completed.params.seq).toBe(reference.seq + 1)
    const part = await runtime.wire('session/eventPart', { session: 'a', token: reference.availability.token, offset: 0, maxBytes: 1024 })
    expect(part.result).toMatchObject({ nextOffset: 1024, totalBytes: reference.totalBytes })
    expect(part.result.data).toContain('"event":{"type":"itemCompleted"')
    expect(part.result.data).not.toContain('turnCompleted')
  }, 30000)

  it('turns an oversized gateway summary into bounded id-only discovery', async () => {
    const runtime = await host()
    await runtime.wire('gateway/subscribe', { maxBytes: 4096 })
    await runtime.command({ op: 'oversizeGateway' })
    expect((await runtime.notification('gateway/sessionHead')).params).toEqual({ session: 'P-gateway-large' })
    const heads = await runtime.wire('session/listHeads', { filter: { cwd: runtime.cwd }, after: 'P-gateway', maxBytes: 4096 })
    const newHead = heads.result.heads.find((entry: any) => entry.id === 'P-gateway-large')
    expect(newHead).toMatchObject({ cwd: runtime.cwd, omitted: [{ field: 'title', totalBytes: 17 * 1024 * 1024, reason: 'openSessionToReadField' }] })
    expect(newHead.title).toBeUndefined()
  }, 30000)

  it('interleaves two independent processes and exposes a genuine single-host crash boundary', async () => {
    const p = await host(), q = await host(p.home, 'Q')
    await p.open('a'); await q.open('a')
    await p.submit('a', 'work P', 'p-start'); await q.submit('a', 'work Q', 'q-start')
    await p.command({ op: 'burst', session: 'a', count: 1000 })
    await p.event(frame => frame.event.type === 'itemDelta' && frame.event.data === '|P-999|')
    const sequences = p.frames().map(frame => frame.seq)
    expect(sequences).toEqual(Array.from({ length: sequences.length }, (_, i) => i + 1))
    const exited = new Promise<number | null>(resolve => p.child.once('exit', resolve))
    await p.command({ op: 'crash' }); expect(await exited).toBe(27)
    await q.command({ op: 'append', session: 'a', text: '|Q-survives|' })
    await q.event(frame => frame.event.type === 'itemDelta' && frame.event.data === '|Q-survives|')
    expect((await q.state()).sessions.find(state => state.summary.id === 'a')?.turn).toBeDefined()
    expect(q.child.exitCode).toBeNull()
  })

  it('creates globally distinct session IDs and never overwrites a saved session after restart', async () => {
    const p = await host(), q = await host(p.home, 'Q')
    const create = (runtime: Awaited<ReturnType<typeof host>>) => runtime.request('session/open', { selector: { kind: 'create', spec: { cwd: runtime.cwd } } })
    const firstP = await create(p), firstQ = await create(q)
    expect(firstP.session).not.toBe(firstQ.session)
    const exited = new Promise(resolve => p.child.once('exit', resolve))
    await p.request('shutdown'); await exited
    const resumed = await host(p.home), nextP = await create(resumed)
    expect(nextP.session).not.toBe(firstP.session)
    expect((await resumed.open(firstP.session)).snapshot.summary.id).toBe(firstP.session)
    expect((await resumed.state()).sessions.filter(state => state.summary.id === firstP.session)).toHaveLength(1)
  })

  it('returns snapshots at the live watermark and gates real local ShowPage lifetime', async () => {
    const runtime = await host()
    await runtime.open('a'); await runtime.submit('a', 'work', 'begin')
    await runtime.command({ op: 'showPage', session: 'a' })
    const page = await runtime.event(frame => frame.event.type === 'itemStarted' && frame.event.item.body.kind === 'toolCall')
    const url = page.params.event.item.body.progress
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-z]{43}$/)
    expect(await (await fetch(url)).text()).toContain('Isolated P page')
    await runtime.command({ op: 'closePage', session: 'a' })
    const opened = await runtime.open('a')
    expect(opened.snapshot.seq).toBe(runtime.frames().at(-1)?.seq)
    expect(opened.snapshot.items.find((item: any) => item.id === 'a-page').status).toBe('completed')
    const audit = (await readFile(join(runtime.control, 'P.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(audit.filter(row => row.kind === 'pageVisited')).toHaveLength(1)
  })
})
