// Offline NDJSON runtime: one stdout write deliberately exceeds the 256-message
// Electron ACK window. No provider, account, network or tool execution is used.
const readline = require('node:readline')
const ts = '2026-09-22T00:00:00Z'
const summary = { id: 'burst', title: 'Burst regression', cwd: process.cwd(), createdAt: ts, updatedAt: ts }
const methods = ['initialize', 'shutdown', 'session/list', 'session/open', 'session/history', 'session/events', 'session/submit', 'session/answer', 'catalog/read', 'gateway/subscribe']
let seq = 0
const encode = value => JSON.stringify(value) + '\n'
const reply = (request, result) => process.stdout.write(encode({ jsonrpc: '2.0', id: request.id, result }))
const frame = event => ({ jsonrpc: '2.0', method: 'event', params: { seq: ++seq, ts, session: summary.id, event } })
const item = { id: 'assistant', turn: 'turn', round: 0, status: 'running', startedAt: ts, body: { kind: 'assistant', text: '' } }
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line)
  switch (request.method) {
    case 'initialize': reply(request, { protocol: 1, name: 'bingo', version: 'offline-burst-fixture', capabilities: { methods, notifications: ['event', 'gateway/event'] } }); break
    case 'shutdown': reply(request, {}); process.exit(0); break
    case 'session/list': reply(request, { sessions: [summary] }); break
    case 'catalog/read': reply(request, { kind: request.params.kind, entries: [] }); break
    case 'session/open': reply(request, { session: summary.id, snapshot: { seq, summary, items: [] } }); break
    case 'session/history': reply(request, { items: [], generation: 0 }); break
    case 'session/submit': {
      const events = [
        { type: 'turnStarted', turn: 'turn', inputs: [], origin: 'submit' },
        { type: 'intentAck', intent: request.params.intent, outcome: { kind: 'turnStarted', turn: 'turn' } },
        { type: 'itemStarted', item },
        ...Array.from({ length: 1000 }, (_, n) => ({ type: 'itemDelta', item: item.id, n, kind: 'text', data: 'x' })),
        { type: 'itemCompleted', item: { ...item, status: 'completed', completedAt: ts, body: { kind: 'assistant', text: 'Burst delivered in order.' } } },
        { type: 'interactionOpened', interaction: { id: 'permission', session: summary.id, turn: 'turn', openedAt: ts, kind: { kind: 'permission', tool: 'Read', summary: 'Offline burst permission checkpoint' }, answers: ['allowOnce', 'deny'] } }
      ]
      process.stdout.write(encode({ jsonrpc: '2.0', id: request.id, result: {} }) + events.map(event => encode(frame(event))).join(''))
      break
    }
    case 'session/answer': {
      const events = [
        { type: 'intentAck', intent: request.params.intent, outcome: { kind: 'applied', result: null } },
        { type: 'interactionResolved', id: 'permission', answer: request.params.answer, by: { kind: 'client', name: 'Rei', surface: 'desktop' } },
        { type: 'turnCompleted', turn: 'turn', status: { kind: 'completed' }, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } }
      ]
      process.stdout.write(encode({ jsonrpc: '2.0', id: request.id, result: {} }) + events.map(event => encode(frame(event))).join(''))
      break
    }
    default: reply(request, {})
  }
})
