// Deterministic protocol-1 desktop acceptance double, NOT a bingo-core concurrency test.
// Test-only control lives on an ephemeral loopback HTTP port; no provider or account access.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const readline = require('node:readline')
const { randomUUID } = require('node:crypto')

const root = process.env.REI_FIXTURE_CONTROL
if (!root) throw new Error('REI_FIXTURE_CONTROL must point at this test’s isolated control directory')
fs.mkdirSync(root, { recursive: true })
const cwd = process.cwd(), project = path.basename(cwd), epoch = randomUUID()
const auditPath = path.join(root, `${project}.ndjson`)
const endpointPath = path.join(root, `${project}.json`)
const statePath = path.join(root, `${project}.state.json`)
const ts = '2026-09-22T10:00:00.000Z'
const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
const methods = ['initialize', 'shutdown', 'session/list', 'session/listHeads', 'session/children', 'session/open', 'session/close', 'session/history', 'session/itemPart', 'session/fieldPart', 'session/eventPart', 'session/events', 'session/submit', 'session/interrupt', 'session/answer', 'catalog/read', 'gateway/subscribe']
const sessions = new Map(), attached = new Set(), attachments = new Map(), deferred = new Map(), pinnedFields = new Map(), pinnedItems = new Map(), pinnedEvents = new Map()
let counter = 0, gateway = false, gatewayBudget = null, initializePending = null, stopping = false
let endpoint
const configPath = path.join(cwd, 'fixture-config.json')
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {}
let initializeHeld = Boolean(config.holdInitialize)
function audit(kind, data = {}) { fs.appendFileSync(auditPath, JSON.stringify({ epoch, pid: process.pid, project, cwd, kind, ...data }) + '\n') }
function send(value) { process.stdout.write(JSON.stringify(value) + '\n') }
function protocolLimit(request, message) { send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message, data: { code: 'PROTOCOL_LIMIT' } } }) }
function reply(request, result, maxBytes = 16 * 1024 * 1024) {
  const line = JSON.stringify({ jsonrpc: '2.0', id: request.id, result })
  if (Buffer.byteLength(line, 'utf8') > maxBytes) { protocolLimit(request, 'Fixture response exceeds the complete JSON-RPC line budget.'); return }
  process.stdout.write(line + '\n')
}
function reject(request, message) { send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message } }) }
function head(summary) {
  const result = Object.fromEntries(['id', 'cwd', 'parent', 'driver', 'createdAt', 'updatedAt', 'busy', 'messages'].filter(field => summary[field] !== undefined).map(field => [field, summary[field]]))
  const omitted = []
  for (const field of ['key', 'title', 'model', 'provider']) {
    const value = summary[field]
    if (value === undefined) continue
    const totalBytes = Buffer.byteLength(value, 'utf8')
    if (totalBytes > 256) omitted.push({ field, totalBytes, reason: 'openSessionToReadField' })
    else result[field] = value
  }
  if (omitted.length) result.omitted = omitted
  return result
}
function checksum(bytes) {
  let value = 0xcbf29ce484222325n
  for (const byte of bytes) value = (value ^ BigInt(byte)) * 0x100000001b3n & 0xffffffffffffffffn
  return value.toString(16).padStart(16, '0')
}
function boundedSnapshot(state, maxBytes, options) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 8 * 1024 * 1024) throw new Error('Invalid bounded snapshot budget')
  const summary = { ...state.summary }, omittedFields = []
  for (const field of ['title', 'key', 'model', 'provider']) {
    const value = summary[field]
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') <= 256) continue
    delete summary[field]
    const bytes = Buffer.from(JSON.stringify(value), 'utf8'), token = randomUUID()
    pinnedFields.set(token, { session: state.summary.id, bytes })
    omittedFields.push({ path: ['summary', field], availability: { kind: 'available', token }, totalBytes: bytes.length, checksum: checksum(bytes) })
  }
  const hasLargeHistory = state.items.some(item => item.id === `${project}-oversized-history`)
  return { session: state.summary.id, snapshot: { ...state, summary, items: hasLargeHistory ? [] : state.items }, history: { before: null, hasMore: hasLargeHistory, generation: hasLargeHistory ? 3 : 0 }, ...(options?.children && options.treeBackfill === 'liveOnly' ? { tree: { backfill: 'liveOnly', descendantsComplete: false } } : {}), ...(omittedFields.length ? { omittedFields } : {}) }
}
function serialPart(request, pin) {
  const { offset, maxBytes } = request.params
  if (!Number.isInteger(offset) || offset < 0 || offset >= pin.bytes.length || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024) { reject(request, 'Invalid part offset or byte budget.'); return }
  let end = Math.min(offset + maxBytes, pin.bytes.length)
  while (end > offset && end < pin.bytes.length && (pin.bytes[end] & 0xc0) === 0x80) end--
  if (end === offset) { reject(request, 'No complete UTF-8 character fits.'); return }
  reply(request, { data: pin.bytes.subarray(offset, end).toString('utf8'), nextOffset: end < pin.bytes.length ? end : null, totalBytes: pin.bytes.length })
}
function fieldPart(request) {
  const pin = pinnedFields.get(request.params.token)
  if (!pin || pin.session !== request.params.session) { reject(request, 'Pinned field is unavailable for this session.'); return }
  serialPart(request, pin)
}
function history(request) {
  const state = required(request.params.session), page = request.params.page ?? {}, large = state.items.find(item => item.id === `${project}-oversized-history`)
  if (!large || page.maxBytes === undefined) { reply(request, { items: state.items, generation: large ? 3 : 0 }); return }
  if (page.generation !== undefined && page.generation !== 3 || page.before && page.before !== large.id) { reject(request, 'STALE_GENERATION'); return }
  if (page.before === large.id) { reply(request, { items: [], generation: 3 }, page.maxBytes); return }
  const bytes = Buffer.from(JSON.stringify(large), 'utf8'), token = randomUUID()
  pinnedItems.set(token, { session: state.summary.id, item: large.id, generation: 3, bytes })
  reply(request, { items: [], next: large.id, generation: 3, oversized: { id: large.id, availability: { kind: 'available', token }, totalBytes: bytes.length, checksum: checksum(bytes) } }, page.maxBytes)
}
function itemPart(request) {
  const { session, item, generation, token } = request.params, pin = pinnedItems.get(token)
  if (!pin || pin.session !== session || pin.item !== item || pin.generation !== generation) { reject(request, 'Pinned item is unavailable for this session/generation.'); return }
  serialPart(request, pin)
}
function eventPart(request) {
  const pin = pinnedEvents.get(request.params.token)
  if (!pin || pin.session !== request.params.session) { reject(request, 'Pinned event is unavailable for this session.'); return }
  serialPart(request, pin)
}
function children(request) {
  const { parent, after, maxBytes } = request.params
  if (!attached.has(parent)) { reject(request, 'Open the parent before enumerating its children.'); return }
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 8 * 1024 * 1024) { protocolLimit(request, 'Invalid child page budget.'); return }
  const ids = [...sessions.values()].filter(state => state.summary.parent?.session === parent && (!after || state.summary.id > after)).map(state => state.summary.id).sort()
  const result = { children: [] }
  for (const id of ids) {
    const candidate = { children: [...result.children, id], next: id }
    if (Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: candidate }), 'utf8') > maxBytes) break
    result.children.push(id)
  }
  if (ids.length && !result.children.length) { protocolLimit(request, 'One child id cannot fit this JSON-RPC line budget.'); return }
  if (result.children.length < ids.length) result.next = result.children.at(-1)
  audit('childrenPage', { parent, count: result.children.length, next: result.next })
  reply(request, result, maxBytes)
}
function listHeads(request) {
  const { filter = {}, after, maxBytes } = request.params
  if (Object.keys(filter).some(key => !['cwd', 'parent'].includes(key))) { reject(request, 'Only cwd/parent filters are valid for session/listHeads.'); return }
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 8 * 1024 * 1024) { protocolLimit(request, 'Invalid bounded response budget.'); return }
  const matched = [...sessions.values()].map(state => state.summary).filter(summary => (!filter.cwd || summary.cwd === filter.cwd) && (!filter.parent || summary.parent?.session === filter.parent) && (!after || summary.id > after)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const heads = []
  const fits = (candidate, next) => Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { heads: [...heads, candidate], next } }), 'utf8') <= maxBytes
  for (const summary of matched) {
    const candidate = head(summary)
    // Count the complete escaped JSON-RPC line, not only the raw display strings.
    for (const field of ['provider', 'model', 'title', 'key']) {
      if (fits(candidate, candidate.id)) break
      if (candidate[field] === undefined) continue
      const totalBytes = Buffer.byteLength(candidate[field], 'utf8')
      delete candidate[field]
      const omissions = candidate.omitted ?? []
      candidate.omitted = omissions
      omissions.push({ field, totalBytes, reason: 'openSessionToReadField' })
    }
    if (!fits(candidate, candidate.id)) break
    heads.push(candidate)
  }
  if (matched.length && !heads.length) { protocolLimit(request, 'One trusted head cannot fit this JSON-RPC line budget.'); return }
  const next = matched.length > heads.length ? heads.at(-1).id : undefined
  audit('headsPage', { ids: heads.map(value => value.id), next, maxBytes })
  reply(request, { heads, ...(next ? { next } : {}) }, maxBytes)
}
function persist() { fs.writeFileSync(statePath, JSON.stringify([...sessions.values()])) }
function create(id, title, summaryExtras = {}, announce = true) {
  const state = { seq: 0, summary: { id, title, cwd, driver: 'model', provider: 'fixture', model: `${project}-model`, createdAt: ts, updatedAt: ts, busy: false, ...summaryExtras }, config: { kernel: { thinking: 'off' }, plugins: { 'bingo.permissions': { mode: 'default' } } }, items: [], interactions: [], queue: [] }
  sessions.set(id, state)
  if (gateway && announce) {
    const event = { jsonrpc: '2.0', method: 'gateway/event', params: { type: 'sessionCreated', summary: state.summary } }
    if (gatewayBudget !== null && Buffer.byteLength(JSON.stringify(event), 'utf8') > gatewayBudget) send({ jsonrpc: '2.0', method: 'gateway/sessionHead', params: { session: id } })
    else send(event)
  }
  return state
}
if (fs.existsSync(statePath)) {
  for (const state of JSON.parse(fs.readFileSync(statePath, 'utf8'))) {
    if (state.turn) { state.lastTurn = { id: state.turn.id, status: { kind: 'failed', error: { code: 'TURN_LOST', message: 'Fixture host restarted; the old turn did not resume.' } }, startedAt: ts, endedAt: ts }; delete state.turn }
    state.summary.busy = false; state.interactions = []; state.queue = []
    sessions.set(state.summary.id, state)
  }
} else { create(config.uniqueSessions ? `${project}-a` : 'a', config.startupOversizedTitle ? 'X'.repeat(17 * 1024 * 1024) : config.sessionTitles?.[0] ?? `${project} A`); create(config.uniqueSessions ? `${project}-b` : 'b', config.sessionTitles?.[1] ?? `${project} B`) }
const lane = id => id.split('-').at(-1)
// IDs must remain unique across project hosts and persisted restart snapshots.
counter = Math.max(0, ...[...sessions.values()].flatMap(state => [state.summary.id, ...state.items.flatMap(item => [item.id, item.turn ?? ''])]).flatMap(id => [...id.matchAll(/(?:created-|turn-)(\d+)/g)].map(match => Number(match[1]))))
function createRequested(spec) {
  let id
  do { id = `${project}-created-${++counter}` } while (sessions.has(id))
  return create(id, spec.title || `${project} new ${counter}`)
}
function required(id) { const state = sessions.get(id); if (!state) throw new Error(`Unknown fixture session ${id}`); return state }
function frame(id, event, root) {
  const state = required(id)
  const params = { seq: ++state.seq, ts, session: id, event, ...(root ? { root } : {}) }
  if (event.type === 'turnStarted') { state.summary.busy = true; state.turn = { id: event.turn, startedAt: ts, origin: event.origin, usage }; audit('turnStarted', { session: id, turn: event.turn }) }
  if (event.type === 'turnCompleted') { state.summary.busy = false; state.lastTurn = { id: event.turn, status: event.status, startedAt: ts, endedAt: ts }; delete state.turn; audit('turnCompleted', { session: id, turn: event.turn, status: event.status }) }
  if (['itemStarted', 'itemUpdated', 'itemCompleted'].includes(event.type)) { const index = state.items.findIndex(item => item.id === event.item.id); if (index < 0) state.items.push(event.item); else state.items[index] = event.item }
  if (event.type === 'itemDelta') { const item = state.items.find(item => item.id === event.item); if (item?.body.kind === 'assistant') item.body.text += event.data }
  if (event.type === 'interactionOpened') state.interactions.push(event.interaction)
  if (event.type === 'interactionResolved' || event.type === 'interactionCancelled') state.interactions = state.interactions.filter(item => item.id !== event.id)
  if (event.type === 'queueChanged') state.queue = event.entries
  if (attached.has(id) || root && attached.has(root)) {
    const encoded = JSON.stringify({ jsonrpc: '2.0', method: 'event', params })
    if (Buffer.byteLength(encoded, 'utf8') > 16 * 1024 * 1024) {
      const route = root ?? id
      if (attachments.get(route)?.bounded) {
        const bytes = Buffer.from(JSON.stringify(params), 'utf8'), token = randomUUID()
        pinnedEvents.set(token, { session: id, bytes })
        send({ jsonrpc: '2.0', method: 'eventRef', params: { session: id, ...(root ? { root } : {}), seq: params.seq, messageId: randomUUID(), eventType: event.type, ...(event.item?.id ? { item: event.item.id } : {}), stateUncertain: false, generation: 3, availability: { kind: 'available', token }, totalBytes: bytes.length, checksum: checksum(bytes) } })
      } else audit('oversizedLegacyEventRejected', { session: id, seq: params.seq })
    } else process.stdout.write(encoded + '\n')
  }
  return params
}
function ack(request, outcome) { frame(request.params.session, { type: 'intentAck', intent: request.params.intent, outcome }) }
function start(request) {
  const id = request.params.session, state = required(id), text = request.params.input.text
  if (state.turn) {
    const entry = { intent: request.params.intent, position: state.queue.length, preview: text, steerable: false, origin: { surface: 'desktop' } }
    frame(id, { type: 'queueChanged', revision: state.seq + 1, entries: [...state.queue, entry] }); ack(request, { kind: 'queued', position: entry.position }); return
  }
  const turn = `${lane(id)}-turn-${++counter}`
  const user = { id: `${turn}-user`, turn, status: 'completed', startedAt: ts, body: { kind: 'user', parts: [{ type: 'text', text }], origin: { surface: 'desktop' } } }
  frame(id, { type: 'itemCompleted', item: user })
  frame(id, { type: 'turnStarted', turn, inputs: [user.id], origin: 'submit' })
  ack(request, { kind: 'turnStarted', turn })
  frame(id, { type: 'itemStarted', item: { id: `${turn}-assistant`, turn, status: 'running', startedAt: ts, body: { kind: 'assistant', text: `${project}/${id}: working on ${text}` } } })
}
function complete(id, failed = false) {
  const state = required(id), turn = state.turn?.id
  if (!turn) throw new Error(`No active turn in ${id}`)
  const item = state.items.find(item => item.id === `${turn}-assistant`)
  if (item) frame(id, { type: 'itemCompleted', item: { ...item, status: failed ? 'failed' : 'completed', completedAt: ts, body: { kind: 'assistant', text: `${project}/${id}: ${failed ? 'failed' : 'complete'}` } } })
  for (const interaction of [...state.interactions]) frame(id, { type: 'interactionCancelled', id: interaction.id, reason: 'turnEnded' })
  frame(id, { type: 'turnCompleted', turn, status: failed ? { kind: 'failed', error: { code: 'TOOL_FAILED', message: `${project}/${id}: controlled failure` } } : { kind: 'completed' }, usage })
}
function initialize(request) { reply(request, { protocol: 1, name: 'bingo', version: 'multisession-acceptance-double', capabilities: { methods, notifications: ['event', 'eventRef', 'gateway/event', 'gateway/sessionHead'] } }); audit('initialized') }
function command(input) {
  const { op, session = 'a' } = input
  audit('control', input)
  if (op === 'releaseInitialize') { initializeHeld = false; if (initializePending) { initialize(initializePending); initializePending = null }; return }
  if (op === 'releaseAck' || op === 'rejectAck') {
    const request = deferred.get(session)
    if (!request) throw new Error(`No deferred submit for ${session}`)
    deferred.delete(session)
    if (op === 'rejectAck') ack(request, { kind: 'rejected', error: { code: 'INVALID_INPUT', message: `${project}/${session}: rejected delayed input` } })
    else start(request)
  } else if (op === 'complete' || op === 'fail') complete(session, op === 'fail')
  else if (op === 'permission') {
    const state = required(session)
    frame(session, { type: 'interactionOpened', interaction: { id: `${lane(session)}-permission`, session, turn: state.turn?.id, openedAt: ts, kind: { kind: 'permission', tool: 'Read', summary: `${project}/${session}: approve fixture read`, preview: { kind: 'command', command: 'fixture read only', cwd } }, answers: ['allowOnce', 'deny'] } })
  } else if (op === 'notice') frame(session, { type: 'notice', level: 'error', code: 'FIXTURE', text: input.text || `${project}/${session}: background notice` })
  else if (op === 'oversizeSummary') {
    const field = input.field ?? 'title', bytes = input.bytes ?? 17 * 1024 * 1024
    if (!['title', 'key'].includes(field) || !Number.isInteger(bytes) || bytes <= 16 * 1024 * 1024 || bytes > 32 * 1024 * 1024) throw new Error('Fixture oversized summary field/size is invalid')
    required(session).summary[field] = 'X'.repeat(bytes)
    audit('oversizeSummary', { session, field, bytes })
  } else if (op === 'escapedSummary') {
    const summary = required(session).summary
    for (const field of ['key', 'title', 'model', 'provider']) summary[field] = '"\\'.repeat(100)
  } else if (op === 'oversizeHistory') {
    const state = required(session), bytes = input.bytes ?? 17 * 1024 * 1024
    if (!Number.isInteger(bytes) || bytes <= 16 * 1024 * 1024 || bytes > 64 * 1024 * 1024) throw new Error('Fixture oversized item size is invalid')
    const item = { id: `${project}-oversized-history`, status: 'completed', startedAt: ts, completedAt: ts, body: { kind: 'assistant', text: 'H'.repeat(bytes) } }
    state.items.push(item); state.summary.messages = state.items.length
    audit('oversizeHistory', { session, bytes })
  } else if (op === 'oversizeEvent') {
    const bytes = input.bytes ?? 17 * 1024 * 1024, turn = `${project}-oversized-turn`
    if (!Number.isInteger(bytes) || bytes <= 16 * 1024 * 1024 || bytes > 64 * 1024 * 1024) throw new Error('Fixture oversized event size is invalid')
    frame(session, { type: 'turnStarted', turn, inputs: [], origin: 'submit' })
    frame(session, { type: 'itemCompleted', item: { id: `${project}-oversized-live`, turn, status: 'completed', startedAt: ts, completedAt: ts, body: { kind: 'assistant', text: 'E'.repeat(bytes) } } })
    frame(session, { type: 'turnCompleted', turn, status: { kind: 'completed' }, usage })
    audit('oversizeEvent', { session, bytes })
  } else if (op === 'oversizeGateway') {
    const bytes = input.bytes ?? 17 * 1024 * 1024
    if (!Number.isInteger(bytes) || bytes <= 16 * 1024 * 1024 || bytes > 32 * 1024 * 1024) throw new Error('Fixture gateway title size is invalid')
    create(`${project}-gateway-large`, 'G'.repeat(bytes))
    audit('oversizeGateway', { bytes })
  } else if (op === 'treeChild') {
    const child = create(`${project}-child`, `${project} Child`, { parent: { session }, key: `agent/${session}/child` })
    frame(child.summary.id, { type: 'itemCompleted', item: { id: `${project}-child-replay`, status: 'completed', startedAt: ts, completedAt: ts, body: { kind: 'assistant', text: 'TREE_REPLAY_ONLY' } } }, session)
  } else if (op === 'seedTree') {
    const count = input.count ?? 1000
    if (!Number.isInteger(count) || count < 1 || count > 1200) throw new Error('Fixture child count is invalid')
    for (let n = 0; n < count; n++) {
      const suffix = String(n).padStart(4, '0'), id = `${project}-child-${suffix}`
      create(id, `${project} Child ${suffix}`, { parent: { session }, key: `agent/${session}/${suffix}` }, false)
    }
    const first = `${project}-child-0000`
    create(`${project}-grandchild-0000`, `${project} Grandchild`, { parent: { session: first }, key: `agent/${first}/grandchild` }, false)
    audit('seedTree', { root: session, count, grandchildParent: first })
  } else if (op === 'append' || op === 'burst') {
    const state = required(session), item = state.items.find(item => item.id === `${state.turn?.id}-assistant`)
    if (!item) throw new Error('No live assistant to append')
    const count = op === 'burst' ? (input.count ?? 1000) : 1
    if (!Number.isInteger(count) || count < 1 || count > 1200) throw new Error('Fixture burst bound exceeded')
    for (let n = 0; n < count; n++) frame(session, { type: 'itemDelta', item: item.id, n: state.seq, kind: 'text', data: input.text || `|${project}-${n}|` })
  } else if (op === 'showPage') {
    const state = required(session), token = 's'.repeat(43), url = `${endpoint}/${token}`
    frame(session, { type: 'itemStarted', item: { id: `${lane(session)}-page`, turn: state.turn?.id, status: 'running', startedAt: ts, body: { kind: 'toolCall', callId: `${lane(session)}-page`, name: 'ShowPage', input: { title: `${project}/${session} page`, html: '<p>isolated fixture page</p>' }, progress: url } } })
  } else if (op === 'closePage') {
    const item = required(session).items.find(item => item.id === `${lane(session)}-page`)
    if (!item) throw new Error('No ShowPage item')
    frame(session, { type: 'itemCompleted', item: { ...item, status: 'completed', completedAt: ts, body: { ...item.body, output: { parts: [{ type: 'text', text: 'Fixture page closed' }] } } } })
  } else if (op === 'frames') {
    // Scripted presentation frames for conversation UI acceptance; events are forwarded verbatim.
    if (!Array.isArray(input.events) || input.events.length > 200) throw new Error('Fixture frames must be a bounded array')
    for (const event of input.events) frame(session, event)
  } else if (op !== 'crash') throw new Error(`Unknown control operation ${op}`)
  persist()
}
const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/state') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ project, epoch, pid: process.pid, cwd, sessions: [...sessions.values()], deferred: [...deferred.keys()] })); return }
  if (request.method === 'GET' && request.url === '/' + 's'.repeat(43)) { audit('pageVisited'); response.setHeader('Content-Type', 'text/html'); response.end(`<title>${project} fixture page</title><p>Isolated ${project} page</p>`); return }
  if (request.method !== 'POST' || request.url !== '/control') { response.writeHead(404); response.end(); return }
  let body = ''
  request.on('data', chunk => { body += chunk; if (body.length > 256 * 1024) request.destroy() })
  request.on('end', () => {
    try { const input = JSON.parse(body); command(input); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true })); if (input.op === 'crash') response.on('finish', () => process.exit(27)) }
    catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: error.message })) }
  })
})
server.listen(0, '127.0.0.1', () => {
  endpoint = `http://127.0.0.1:${server.address().port}`
  fs.writeFileSync(endpointPath, JSON.stringify({ endpoint, epoch, pid: process.pid }))
  audit('started')
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const request = JSON.parse(line)
    audit('request', { method: request.method, params: request.params })
    try {
      switch (request.method) {
        case 'initialize': if (initializeHeld) initializePending = request; else initialize(request); break
        case 'shutdown': audit('shutdown'); stopping = true; persist(); reply(request, {}); process.exit(0); break
        case 'session/list': reply(request, { sessions: [...sessions.values()].map(state => state.summary) }); break
        case 'session/listHeads': listHeads(request); break
        case 'session/children': children(request); break
        case 'session/open': {
          const selector = request.params.selector
          const state = selector.kind === 'create' ? createRequested(selector.spec) : required(selector.id)
          const maxBytes = request.params.options?.maxSnapshotBytes
          attached.add(state.summary.id); attachments.set(state.summary.id, { bounded: maxBytes !== undefined })
          reply(request, maxBytes === undefined ? { session: state.summary.id, snapshot: state } : boundedSnapshot(state, maxBytes, request.params.options), maxBytes)
          persist(); break
        }
        case 'session/close': {
          const session = request.params.session
          attached.delete(session); attachments.delete(session)
          for (const [token, pin] of pinnedFields) if (pin.session === session) pinnedFields.delete(token)
          for (const [token, pin] of pinnedItems) if (pin.session === session) pinnedItems.delete(token)
          for (const [token, pin] of pinnedEvents) if (pin.session === session) pinnedEvents.delete(token)
          reply(request, {}); break
        }
        case 'session/history': history(request); break
        case 'session/itemPart': itemPart(request); break
        case 'session/fieldPart': fieldPart(request); break
        case 'session/eventPart': eventPart(request); break
        case 'session/events': attached.add(request.params.session); reply(request, {}); break
        case 'gateway/subscribe': gateway = true; gatewayBudget = request.params?.maxBytes ?? null; reply(request, {}); break
        case 'catalog/read': {
          const kind = request.params.kind
          const entries = kind === 'models' ? [{ id: `fixture/${project}-model`, label: `${project} fixture model`, meta: { provider: 'fixture' } }] : kind === 'providers' ? [{ id: 'fixture', label: 'Offline fixture', meta: { auth: { kind: 'ready' } } }] : kind === 'commands' ? [{ id: 'model', label: 'Model' }, { id: 'think', label: 'Thinking' }, { id: 'rename', label: 'Rename' }] : []
          reply(request, { kind, entries }); break
        }
        case 'session/submit': {
          const input = request.params.input
          required(request.params.session); reply(request, {})
          if (input.kind === 'action') { ack(request, { kind: 'applied', result: { message: `${project}/${request.params.session}: ${input.action.name} applied` } }); break }
          if (input.text === 'hold-ack' || input.text === 'reject-later') deferred.set(request.params.session, request)
          else start(request)
          persist(); break
        }
        case 'session/answer': {
          const state = required(request.params.session)
          if (!state.interactions.some(item => item.id === request.params.interaction)) throw new Error('Answer sent to wrong interaction/session')
          reply(request, {}); ack(request, { kind: 'applied', result: null }); frame(request.params.session, { type: 'interactionResolved', id: request.params.interaction, answer: request.params.answer, by: { kind: 'client', name: 'Rei', surface: 'desktop' } }); persist(); break
        }
        case 'session/interrupt': {
          const state = required(request.params.session), turn = state.turn?.id
          reply(request, {}); ack(request, { kind: 'applied', result: null })
          if (turn) { for (const interaction of [...state.interactions]) frame(request.params.session, { type: 'interactionCancelled', id: interaction.id, reason: 'interrupted' }); frame(request.params.session, { type: 'turnCompleted', turn, status: { kind: 'interrupted', reason: 'userCancel' }, usage }) }
          persist(); break
        }
        default: reject(request, `Unsupported fixture method ${request.method}`)
      }
    } catch (error) { reject(request, error.message) }
  }).on('close', () => { if (!stopping) { audit('stdinClosed'); process.exit(0) } })
})
process.on('exit', code => audit('exit', { code }))
