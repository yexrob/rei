import { expect, test } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RpcClient } from '../src/main/desktop/rpc-client'
import type { Frame, Input } from '../src/shared/rpc'

const binary = process.env.BINGO_E2E_BINARY || resolve('../bingo-improve/target/debug', process.platform === 'win32' ? 'bingo.exe' : 'bingo')

// Real bingo process and native RPC adapter, with an isolated HOME and a loopback
// provider. This is a protocol regression, not an Electron/DOM interaction test.
test('real RPC: explicit mixed-case catalog identity bypasses invalid default and think governs the first turn', async () => {
  await access(binary)
  const root = await mkdtemp(join(tmpdir(), 'rei-selection-'))
  const workspace = join(root, 'project')
  await mkdir(join(root, '.bingo'), { recursive: true })
  await mkdir(workspace)
  const model = 'gpt-6-astra/Private'
  const calls: Record<string, unknown>[] = []
  const events: Frame[] = []
  const failures: string[] = []
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: model }] }))
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404); response.end(); return
    }
    let body = ''
    for await (const chunk of request) body += chunk
    calls.push(JSON.parse(body))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const sse = (type: string, value: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`
    response.end([
      sse('response.created', { response: { id: 'resp_local', model } }),
      sse('response.output_item.added', { output_index: 0, item: { id: 'msg_local', type: 'message', role: 'assistant', content: [] } }),
      sse('response.output_text.delta', { output_index: 0, delta: 'Local provider received the selected runtime.' }),
      sse('response.output_item.done', { output_index: 0, item: { id: 'msg_local', type: 'message', role: 'assistant' } }),
      sse('response.completed', { response: { status: 'completed', usage: { input_tokens: 5, output_tokens: 7 } } })
    ].join(''))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No loopback server address')
  const endpoint = { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'synthetic-local-test-only' }
  const settingsPath = join(root, '.bingo/settings.json')
  await writeFile(settingsPath, JSON.stringify({
    provider: 'road-anti', model, thinking: 'low',
    openai: { instances: { 'Road-anti': endpoint, Road: endpoint } },
    models: { [`Road-anti/${model}`]: { reasoning: true }, [`Road/${model}`]: { reasoning: true } }
  }))
  const client = new RpcClient({ binary, cwd: workspace, env: { PATH: process.env.PATH ?? '', HOME: root, USERPROFILE: root } }, (notification) => {
    if (notification.method === 'event') events.push(notification.params)
  }, (failure) => failures.push(failure.message))
  const submit = async (session: string, input: Input) => {
    const intent = randomUUID()
    await client.request('session/submit', { session, intent, input })
    await expect.poll(() => events.find((frame) => frame.event.type === 'intentAck' && frame.event.intent === intent), { timeout: 10000 }).toBeTruthy()
    const ack = events.find((frame) => frame.event.type === 'intentAck' && frame.event.intent === intent)!
    if (ack.event.type !== 'intentAck') throw new Error('Missing intent acknowledgment')
    expect(ack.event.outcome.kind).not.toBe('rejected')
    return ack
  }
  try {
    await client.start()
    // The old renderer sequence fails here before it can submit /model.
    await expect(client.request('session/open', { selector: { kind: 'create', spec: { cwd: workspace } } })).rejects.toThrow('No provider called `road-anti`')
    expect((await client.request('session/list', { filter: { cwd: workspace } })).sessions).toEqual([])
    const catalog = await client.request('catalog/read', { kind: 'models' })
    const entry = catalog.entries.find((entry) => entry.id === `Road-anti/${model}`)
    expect(entry).toMatchObject({ id: `Road-anti/${model}`, meta: { provider: 'Road-anti' } })
    const provider = (entry!.meta as { provider: string }).provider
    const opened = await client.request('session/open', { selector: { kind: 'create', spec: { cwd: workspace, provider, model: entry!.id.slice(provider.length + 1) } } })
    expect(opened.snapshot.summary).toMatchObject({ provider: 'Road-anti', model })
    expect(opened.snapshot.config?.kernel).toMatchObject({ thinking: 'low' })
    expect(calls).toHaveLength(0)
    const thinkAck = await submit(opened.session, { kind: 'action', action: { name: 'think', args: 'xhigh' } })
    expect(events.some((frame) => frame.session === opened.session && frame.seq < thinkAck.seq && frame.event.type === 'configChanged' && (frame.event.config.kernel as { thinking?: string })?.thinking === 'xHigh')).toBe(true)
    const configured = await client.request('session/open', { selector: { kind: 'byId', id: opened.session } })
    expect(configured.snapshot.config?.kernel).toMatchObject({ thinking: 'xHigh' })
    await submit(opened.session, { kind: 'text', text: 'Use my chosen model and effort.', origin: { surface: 'desktop' } })
    await expect.poll(() => events.find((frame) => frame.session === opened.session && frame.event.type === 'turnCompleted'), { timeout: 10000 }).toMatchObject({ event: { status: { kind: 'completed' } } })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ model, reasoning: { effort: 'xhigh' } })
    const after = await client.request('session/open', { selector: { kind: 'byId', id: opened.session } })
    expect(after.snapshot.items.some((item) => item.body.kind === 'assistant' && item.body.text === 'Local provider received the selected runtime.')).toBe(true)
    // Session creation is a runtime override, not a manual repair of defaults.
    const saved = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(saved.provider).toBe('road-anti')
    expect(saved.thinking).toBe('xHigh')
    // Existing-session selectors still go through canonical commands and snapshots.
    await submit(opened.session, { kind: 'action', action: { name: 'model', args: `Road/${model}` } })
    await submit(opened.session, { kind: 'action', action: { name: 'think', args: 'off' } })
    const changed = await client.request('session/open', { selector: { kind: 'byId', id: opened.session } })
    expect(changed.snapshot.summary).toMatchObject({ provider: 'Road', model })
    expect(changed.snapshot.config?.kernel).toMatchObject({ thinking: null })
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({ provider: 'Road', model, thinking: null })
    expect(failures).toEqual([])
  } finally {
    await client.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
