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
    const result = { protocol: mode === 'wrong-protocol' ? 99 : 1, name: 'bingo', version: 'fixture', capabilities: { methods, notifications: ['event','gateway/event'] } }
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
    if (mode === 'uncorrelated') return send({ jsonrpc: '2.0', id: 'bogus', result: { sessions: [] } })
    if (mode === 'invalid-result') return reply(r, { sessions: 'invalid' })
    if (mode === 'rpc-error') return send({ jsonrpc: '2.0', id: r.id, error: { code: -32000, message: 'Fixture rejected this request.', data: { code: 'sessionNotFound' } } })
    const n = ++lists
    setTimeout(() => reply(r, { sessions: [{ ...summary, title: String(n) }] }), n === 1 ? 30 : 1)
  } else if (r.method === 'catalog/read') reply(r, { kind: r.params.kind, entries: [] })
  else if (r.method === 'session/open') {
    reply(r, { session: summary.id, snapshot: { seq, summary, items: [] } })
    frame({ type: 'notice', level: 'info', code: 'attached', text: 'Attached fixture.' })
  } else if (r.method === 'session/history') reply(r, { items: [], generation: 0 })
  else if (r.method === 'session/events') { reply(r, {}); frame({ type: 'notice', level: 'info', code: 'replay', text: 'Replay fixture.' }) }
  else if (r.method === 'gateway/subscribe') { reply(r, {}); send({ jsonrpc: '2.0', method: 'gateway/event', params: { type: 'sessionCreated', summary } }) }
  else if (r.method === 'session/submit') { reply(r, {}); frame({ type: 'intentAck', intent: r.params.intent, outcome: { kind: 'applied', result: null } }) }
  else reply(r, {})
})
