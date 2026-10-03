const readline = require('node:readline')
const mode = process.argv[2] || 'normal'
const methods = ['initialize','shutdown','session/list','session/open','session/history','session/events','session/submit','session/interrupt','session/answer','session/delete','catalog/read','gateway/subscribe']
const ts = '2026-09-05T00:00:00Z'
const summary = { id: 'fixture-session', cwd: process.cwd(), createdAt: ts, updatedAt: ts }
let seq = 0
let lists = 0
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
const reply = (request, result) => send({ jsonrpc: '2.0', id: request.id, result })
const frame = (event) => send({ jsonrpc: '2.0', method: 'event', params: { seq: ++seq, ts, session: summary.id, event } })
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const r = JSON.parse(line)
  if (r.method === 'initialize') {
    if (mode === 'exit') return process.exit(17)
    if (mode === 'bad-json') return process.stdout.write('not json\n')
    if (mode === 'oversized') { process.stdout.write('x'.repeat(16 * 1024 * 1024 + 1)); return }
    if (mode === 'truncated') { process.stdout.write('{"jsonrpc":'); process.stdout.end(); return }
    const result = { protocol: mode === 'wrong-protocol' ? 99 : 1, name: 'bingo', version: 'fixture', capabilities: { methods, notifications: mode === 'bounded-notifications' ? ['event','gateway/event','eventRef','gateway/sessionHead'] : ['event','gateway/event'] } }
    if (mode === 'split') {
      const data = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: { ...result, version: '🧪fixture' } }) + '\n')
      const split = data.indexOf(Buffer.from('🧪')) + 2
      process.stdout.write(data.subarray(0, split))
      setTimeout(() => process.stdout.write(data.subarray(split)), 15)
    } else reply(r, result)
  } else if (r.method === 'shutdown') {
    if (mode === 'ignore-shutdown') return
    reply(r, {})
    process.stdin.destroy()
    process.exit(0)
  } else if (r.method === 'session/list') {
    if (mode === 'timeout') return
    if (mode === 'late-read') return setTimeout(() => reply(r, { sessions: [] }), 300)
    if (mode === 'stderr-exit') {
      process.stderr.write('x'.repeat(20 * 1024) + '\nstarting provider with api_key=abc123 and Authorization: Bearer tok.en-1\nusing sk-live-0123456789abcdef\nfatal: boom\n')
      return setTimeout(() => process.exit(3), 20)
    }
    if (mode === 'uncorrelated') return send({ jsonrpc: '2.0', id: 'bogus', result: { sessions: [] } })
    if (mode === 'invalid-result') return reply(r, { sessions: 'invalid' })
    if (mode === 'rpc-error') return send({ jsonrpc: '2.0', id: r.id, error: { code: -32000, message: 'Fixture rejected this request.', data: { code: 'sessionNotFound' } } })
    const n = ++lists
    setTimeout(() => reply(r, { sessions: [{ ...summary, title: String(n) }] }), n === 1 ? 30 : 1)
  } else if (r.method === 'catalog/read') reply(r, { kind: r.params.kind, entries: [] })
  else if (r.method === 'session/open') {
    const bytes = mode === 'large-open-17' ? 17 * 1024 * 1024 : mode === 'large-open-15' ? 15 * 1024 * 1024 : 0
    const item = bytes ? [{ id: 'recorded-item', round: 0, status: 'completed', startedAt: ts, completedAt: ts, body: { kind: 'assistant', text: 'x'.repeat(bytes) } }] : []
    reply(r, { session: summary.id, snapshot: { seq, summary, items: item } })
    if (!bytes) frame({ type: 'notice', level: 'info', code: 'attached', text: 'Attached fixture.' })
  } else if (r.method === 'session/history') {
    const item = { id: 'recorded-item', round: 0, status: 'completed', startedAt: ts, completedAt: ts, body: { kind: 'assistant', text: 'x'.repeat(17 * 1024 * 1024) } }
    reply(r, { items: mode === 'large-history-17' ? [item] : [], generation: 0 })
  } else if (r.method === 'session/events') {
    reply(r, {})
    if (mode === 'large-event-17') frame({ type: 'itemDelta', item: 'recorded-item', kind: 'text', n: 0, data: 'x'.repeat(17 * 1024 * 1024) })
    else if (mode === 'bounded-notifications') {
      send({ jsonrpc: '2.0', method: 'eventRef', params: { session: summary.id, seq: ++seq, messageId: 'ref-1', eventType: 'itemCompleted', item: 'recorded-item', stateUncertain: false, generation: 0, availability: { kind: 'available', token: 'fixture-token' }, totalBytes: 17 * 1024 * 1024, checksum: 'a6a4eddc16724d5c' } })
      frame({ type: 'turnCompleted', turn: 'turn', status: { kind: 'completed' }, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } })
    } else if (mode === 'unknown-event') {
      frame({ type: 'futureThing', payload: { anything: true } })
      frame({ type: 'notice', level: 'info', code: 'replay', text: 'Replay fixture.' })
    } else if (mode === 'invalid-event') frame({ type: 'notice', level: 'info' })
    else frame({ type: 'notice', level: 'info', code: 'replay', text: 'Replay fixture.' })
  }
  else if (r.method === 'gateway/subscribe') {
    reply(r, {})
    if (mode === 'bounded-notifications') send({ jsonrpc: '2.0', method: 'gateway/sessionHead', params: { session: summary.id } })
    else send({ jsonrpc: '2.0', method: 'gateway/event', params: { type: 'sessionCreated', summary } })
  }
  else if (r.method === 'session/submit') { if (mode === 'timeout') return; reply(r, {}); frame({ type: 'intentAck', intent: r.params.intent, outcome: { kind: 'applied', result: null } }) }
  else reply(r, {})
})
