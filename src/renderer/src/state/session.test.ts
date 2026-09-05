import { describe, expect, it } from 'vitest'
import type { Event, Frame, Interaction, Item, ItemBody, SessionState, View } from '../../../shared/rpc'
import { rustFrames, rustInitial, rustSnapshots } from './fixtures'
import {
  contentText, createSessionProjection, foldSessionFrame, isDurableEvent, itemText,
  projectFrame, projectHistory, selectConfig, selectMessages, selectPendingInteractions,
  selectSessionTitle, selectStatus, selectToolRuns, selectUsage, viewText
} from './session'

const ts = '2023-11-14T22:13:20Z'
const zeroUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
const frame = (seq: number, event: Event): Frame => ({ seq, ts, session: 'ses_1', event })
const item = (id: string, body: ItemBody = { kind: 'assistant', text: id }, status: Item['status'] = 'completed'): Item => ({
  id, turn: 'trn_1', round: 0, startedAt: ts, body, status
})
const base = (patch: Partial<SessionState> = {}) => createSessionProjection({ ...rustInitial, ...patch })
const run = (events: Event[], initial = base()) => events.reduce((state, event) => projectFrame(state, frame(state.snapshot.seq + 1, event)), initial)
const permission = (id = 'int_1'): Interaction => ({
  id, session: 'ses_1', turn: 'trn_1', item: 'itm_tool', openedAt: ts,
  kind: { kind: 'permission', tool: 'Edit', summary: 'Edit src/lib.rs', sessionScope: 'Edit(src/)' },
  answers: ['allowOnce', 'allowSession', 'deny']
})

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

describe('SDK reducer parity', () => {
  it('matches actual Rust SessionState::apply snapshots after every pinned frame, without mutating inputs', () => {
    let snapshot = deepFreeze(rustInitial)
    for (const [index, current] of rustFrames.entries()) {
      snapshot = foldSessionFrame(deepFreeze(snapshot), deepFreeze(current))
      expect(snapshot, `frame ${current.seq}: ${current.event.type}`).toStrictEqual(rustSnapshots[index])
    }
    expect(new Set(rustFrames.map((current) => current.event.type)).size).toBe(23)
  })

  it('matches Rust snapshots on a live attachment through all contiguous frames', () => {
    let state = base()
    for (const [index, current] of rustFrames.slice(0, 21).entries()) {
      state = projectFrame(state, current)
      expect(state.resync).toBeNull()
      expect(state.snapshot).toStrictEqual(rustSnapshots[index])
    }
  })

  it('honors a snapshot cursor and ignores replayed duplicates without recounting usage or messages', () => {
    let state = createSessionProjection(rustSnapshots[12])
    const original = state
    for (const current of rustFrames.slice(0, 13)) state = projectFrame(state, current)
    expect(state).toBe(original)
    expect(state.snapshot.summary.messages).toBe(2)
    expect(selectUsage(state).inputTokens).toBe(10)
  })

  it('restores sparse defaulted snapshots without inventing a message count', () => {
    const state = createSessionProjection({ seq: 0, summary: rustInitial.summary, items: [] })
    expect(state.snapshot).toStrictEqual(rustInitial)
    expect(state.snapshot.summary.messages).toBeUndefined()
  })
})

describe('streaming transcript', () => {
  it('appends prose/reasoning, replaces tool tails, and trusts authoritative completion over all deltas', () => {
    const state = run([
      { type: 'itemStarted', item: item('a', { kind: 'assistant', text: '' }, 'running') },
      { type: 'itemStarted', item: item('r', { kind: 'reasoning', text: '' }, 'running') },
      { type: 'itemStarted', item: item('t', { kind: 'toolCall', callId: 'call_1', name: 'Bash', input: { command: 'npm test' } }, 'running') },
      { type: 'itemDelta', item: 'a', n: 0, kind: 'text', data: 'Hello' },
      { type: 'itemDelta', item: 'r', n: 1, kind: 'reasoning', data: 'Check the parser.' },
      { type: 'itemDelta', item: 'a', n: 2, kind: 'text', data: ' world' },
      { type: 'itemDelta', item: 't', n: 3, kind: 'tail', data: 'old tail' },
      { type: 'itemDelta', item: 't', n: 4, kind: 'tail', data: 'new tail' }
    ])
    expect(state.snapshot.items.map(itemText)).toEqual(['Hello world', 'Check the parser.', 'new tail'])
    const done = run([
      { type: 'itemCompleted', item: item('a', { kind: 'assistant', text: 'Canonical final answer.' }) },
      { type: 'itemDelta', item: 'a', n: 5, kind: 'text', data: ' ignored after terminal' }
    ], state)
    expect(done.snapshot.items[0].body).toEqual({ kind: 'assistant', text: 'Canonical final answer.' })
    expect(done.snapshot.summary.messages).toBe(1)
  })

  it.each(['completed', 'failed', 'interrupted'] as const)('does not extend %s items', (status) => {
    const original = item('a', { kind: 'assistant', text: 'settled' }, status)
    const state = run([{ type: 'itemDelta', item: 'a', n: 1, kind: 'text', data: 'no' }], base({ items: [original] }))
    expect(state.snapshot.items[0]).toBe(original)
    expect(state.snapshot.seq).toBe(1)
  })

  it('ignores orphan and mismatched deltas but still advances seq as the SDK does', () => {
    const original = item('a', { kind: 'assistant', text: 'before' }, 'running')
    const state = run([
      { type: 'itemDelta', item: 'missing', n: 1, kind: 'text', data: 'no' },
      { type: 'itemDelta', item: 'a', n: 2, kind: 'reasoning', data: 'no' }
    ], base({ items: [original] }))
    expect(state.snapshot.items).toEqual([original])
    expect(state.snapshot.seq).toBe(2)
  })

  it('uses item IDs rather than tool names or call IDs to preserve parallel runs and transcript order', () => {
    const first = item('z', { kind: 'toolCall', callId: 'call_1', name: 'Read', input: { file_path: 'a' } }, 'running')
    const second = item('a', { kind: 'toolCall', callId: 'call_2', name: 'Read', input: { file_path: 'b' } }, 'running')
    const state = run([
      { type: 'itemStarted', item: first },
      { type: 'itemStarted', item: second },
      { type: 'itemCompleted', item: { ...second, status: 'completed' } },
      { type: 'itemUpdated', item: { ...first, meta: { external: true } } }
    ])
    expect(selectToolRuns(state).map((tool) => [tool.id, tool.status])).toEqual([['z', 'running'], ['a', 'completed']])
    expect(selectToolRuns(state)[0].meta).toEqual({ external: true })
    expect(state.snapshot.summary.messages).toBeUndefined()
  })

  it('counts only completed user and assistant items, not questions, tools, or progress updates', () => {
    const state = run([
      { type: 'itemCompleted', item: item('u', { kind: 'user', parts: [{ type: 'text', text: 'Fix it' }], origin: { surface: 'desktop' } }) },
      { type: 'itemStarted', item: item('a', { kind: 'assistant', text: 'yes' }, 'running') },
      { type: 'itemUpdated', item: item('a', { kind: 'assistant', text: 'yes' }, 'running') },
      { type: 'itemCompleted', item: item('q', { kind: 'questionAnswer', interaction: 'q', question: 'Which?', answer: 'A' }) },
      { type: 'itemCompleted', item: item('r', { kind: 'reasoning', text: 'think' }) },
      { type: 'itemCompleted', item: item('a') }
    ])
    expect(selectMessages(state).map((entry) => entry.id)).toEqual(['u', 'a'])
    expect(state.snapshot.summary.messages).toBe(2)
  })
})

describe('turn, queue, interactions and plugin state', () => {
  it('adds per-round usage once, removes retry-dropped items, and never adds the completion total again', () => {
    const usage = { inputTokens: 10, outputTokens: 3, cacheReadTokens: 7, cacheWriteTokens: 2, reasoningTokens: 1 }
    let state = run([
      { type: 'turnStarted', turn: 'trn_1', inputs: [], origin: 'submit' },
      { type: 'itemStarted', item: item('discard', { kind: 'assistant', text: 'partial' }, 'running') },
      { type: 'turnUsage', turn: 'trn_1', usage, context: { used: 22, window: 100, trigger: 80 } },
      { type: 'turnRetrying', turn: 'trn_1', attempt: 2, max: 10, delayMs: 400, dropped: ['discard'], reason: '503' }
    ])
    expect(selectStatus(state)).toBe('retrying')
    expect(state.snapshot.items).toEqual([])
    expect(state.snapshot.turn).toMatchObject({ round: 1, usage, retrying: { attempt: 2, max: 10 } })
    state = run([{ type: 'turnUsage', turn: 'trn_1', usage, context: { used: 40, window: 100, trigger: 80 } }], state)
    const total = { inputTokens: 20, outputTokens: 6, cacheReadTokens: 14, cacheWriteTokens: 4, reasoningTokens: 2 }
    expect(state.snapshot.turn?.usage).toEqual(total)
    expect(state.snapshot.turn?.retrying).toBeUndefined()
    expect(selectStatus(state)).toBe('working')
    state = run([{ type: 'turnCompleted', turn: 'trn_1', usage: total, status: { kind: 'completed' } }], state)
    expect(selectUsage(state)).toEqual(total)
    expect(state.snapshot.context).toEqual({ used: 40, window: 100, trigger: 80 })
    expect(state.snapshot).toMatchObject({ unread: true, lastTurn: { kind: 'completed' }, summary: { busy: false } })
    expect(state.snapshot.turn).toBeUndefined()
  })

  it('retains ordered open interactions until the kernel explicitly resolves them, even when a turn ends', () => {
    let state = run([
      { type: 'interactionOpened', interaction: permission('one') },
      { type: 'interactionOpened', interaction: permission('two') },
      { type: 'interactionOpened', interaction: { ...permission('one'), guardUntil: '2023-11-14T22:13:22Z' } },
      { type: 'turnCompleted', turn: 'trn_1', usage: zeroUsage, status: { kind: 'interrupted', reason: 'userCancel' } }
    ])
    expect(selectPendingInteractions(state).map((entry) => entry.id)).toEqual(['two', 'one'])
    expect(selectStatus(state)).toBe('waiting')
    expect(selectPendingInteractions(state)[1].guardUntil).toBe('2023-11-14T22:13:22Z')
    state = run([
      { type: 'interactionResolved', id: 'two', answer: { kind: 'allowOnce' }, by: { kind: 'client', name: 'Rei', surface: 'desktop' } },
      { type: 'interactionCancelled', id: 'one', reason: 'interrupted' }
    ], state)
    expect(selectPendingInteractions(state)).toEqual([])
    expect(selectStatus(state)).toBe('interrupted')
  })

  it('replaces queue/config wholesale and keeps arbitrary extension payloads separate from transient signals', () => {
    const state = run([
      { type: 'queueChanged', revision: 1, entries: [{ intent: 'req_2', position: 0, preview: 'Then docs', steerable: false, origin: { surface: 'desktop' } }] },
      { type: 'queueChanged', revision: 2, entries: [] },
      { type: 'configChanged', config: { kernel: { model: 'old' }, plugins: { permissions: { mode: 'default' } } } },
      { type: 'configChanged', config: { kernel: { model: 'new' }, plugins: {} } },
      { type: 'extension', plugin: 'bingo.tasks', kind: 'board', payload: { rows: ['old'] } },
      { type: 'extension', plugin: 'bingo.tasks', kind: 'board', payload: { rows: ['new'] } },
      { type: 'extension', plugin: 'bingo.tasks', kind: 'other', payload: null },
      { type: 'signal', plugin: 'bingo.tasks', kind: 'progress', payload: { value: 1 } },
      { type: 'signal', plugin: 'bingo.tasks', kind: 'progress', payload: { value: 2 } },
      { type: 'signal', plugin: 'bingo.tasks', kind: 'progress', payload: null }
    ])
    expect(state.snapshot.queue).toEqual([])
    expect(selectConfig(state)).toEqual({ kernel: { model: 'new' }, plugins: {} })
    expect(state.snapshot.extensions).toEqual({ 'bingo.tasks': { board: { rows: ['new'] }, other: null } })
    expect(state.snapshot.signals).toBeUndefined()
  })

  it('treats plugin/kind names as plain map keys, including JavaScript prototype names', () => {
    const state = run([
      { type: 'signal', plugin: '__proto__', kind: 'constructor', payload: { safe: true } },
      { type: 'extension', plugin: '__proto__', kind: '__proto__', payload: 42 }
    ])
    expect(Object.hasOwn(state.snapshot.signals!, '__proto__')).toBe(true)
    expect(state.snapshot.signals!['__proto__']['constructor']).toEqual({ safe: true })
    expect(Object.hasOwn(state.snapshot.extensions!['__proto__'], '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(state.snapshot.signals)).toBe(Object.prototype)
  })

  it('does not store transient notices, acknowledgments or catalogs in the snapshot', () => {
    const state = run([
      { type: 'notice', level: 'warn', code: 'COUNT_TOKENS_UNAVAILABLE', text: 'Estimating' },
      { type: 'intentAck', intent: 'req_1', outcome: { kind: 'rejected', error: { code: 'INVALID_INPUT', message: 'No input' } } },
      { type: 'catalogChanged', kind: 'models' }
    ])
    expect(state.snapshot).toEqual({ ...rustInitial, seq: 3 })
  })

  it('derives failure/closed status without forcing item or queue transitions not present in the stream', () => {
    let state = run([
      { type: 'turnStarted', turn: 'trn_1', inputs: [], origin: 'submit' },
      { type: 'turnCompleted', turn: 'trn_1', usage: zeroUsage, status: { kind: 'failed', error: { code: 'AUTH_REQUIRED', message: 'Sign in' } } }
    ])
    expect(selectStatus(state)).toBe('failed')
    state = run([
      { type: 'turnStarted', turn: 'trn_2', inputs: [], origin: 'queue' },
      { type: 'interactionOpened', interaction: permission() },
      { type: 'sessionClosed', reason: { kind: 'shutdown' } }
    ], state)
    expect(selectStatus(state)).toBe('closed')
    expect(state.snapshot.turn).toBeUndefined()
    expect(state.snapshot.interactions).toEqual([])
    // SDK session_closed does not rewrite the summary's busy flag; busy derives from turn.
    expect(state.snapshot.summary.busy).toBe(true)
  })
})

describe('transport sequencing and recovery', () => {
  it('accepts sparse durable replay but detects a gap on a fresh live attachment without losing its cursor', () => {
    const state = createSessionProjection(rustSnapshots[4]) // seq 5, assistant started
    const completion = rustFrames[6] // seq 7; seq 6 was an ephemeral delta
    const live = projectFrame(state, completion)
    expect(live.resync).toEqual({ reason: 'gap', since: 5 })
    expect(live.snapshot).toBe(state.snapshot)
    expect(selectStatus(live)).toBe('resyncing')
    const replay = projectFrame(state, completion, 'replay')
    expect(replay.resync).toBeNull()
    expect(replay.snapshot).toEqual(rustSnapshots[6])
  })

  it('leaves seq unchanged on Lagged, including a lag marker below the current cursor', () => {
    const state = base({ seq: 20 })
    const lagged = projectFrame(state, frame(10, { type: 'lagged', from: 2, to: 9 }))
    expect(lagged.resync).toEqual({ reason: 'lagged', since: 20 })
    expect(lagged.snapshot.seq).toBe(20)
    expect(projectFrame(lagged, frame(21, { type: 'notice', level: 'info', code: 'X', text: 'later' }))).toBe(lagged)
    const reopened = createSessionProjection({ ...rustInitial, seq: 23 })
    expect(reopened.resync).toBeNull()
    expect(projectFrame(reopened, frame(24, { type: 'notice', level: 'info', code: 'X', text: 'later' })).snapshot.seq).toBe(24)
  })

  it('demultiplexes descendant/foreign frames before checking their independent cursors', () => {
    const state = base({ seq: 20 })
    expect(projectFrame(state, { ...frame(300, { type: 'lagged', from: 1, to: 299 }), session: 'child', root: 'ses_1' })).toBe(state)
  })

  it('deduplicates transient frames by seq, not the per-source delta n field', () => {
    let state = base({ items: [item('a', { kind: 'assistant', text: '' }, 'running')] })
    const delta = frame(1, { type: 'itemDelta', item: 'a', n: 0, kind: 'text', data: 'first' })
    state = projectFrame(state, delta)
    expect(projectFrame(state, delta)).toBe(state)
    state = projectFrame(state, frame(2, { ...delta.event, type: 'itemDelta', item: 'a', n: 0, kind: 'text', data: ' second' }))
    expect(itemText(state.snapshot.items[0])).toBe('first second')
  })

  it('keeps the SDK durable/transient classification', () => {
    const ephemeral = new Set(['itemDelta', 'notice', 'signal', 'lagged'])
    for (const current of rustFrames) expect(isDurableEvent(current.event)).toBe(!ephemeral.has(current.event.type))
  })
})

describe('history backfill', () => {
  it('prepends chronological pages while preserving live versions and the live seq', () => {
    const live = item('m', { kind: 'assistant', text: 'live' }, 'running')
    let state = base({ seq: 40, items: [live, item('a')] })
    expect(state.history).toEqual({ before: 'm', complete: false })
    state = projectHistory(state, { items: [item('z'), item('b'), item('m', { kind: 'assistant', text: 'stale' })], next: 'z', generation: 0 }, 'm')
    expect(state.snapshot.items.map((entry) => entry.id)).toEqual(['z', 'b', 'm', 'a'])
    expect(state.snapshot.items[2]).toBe(live)
    expect(state.snapshot.seq).toBe(40)
    expect(state.snapshot.summary.messages).toBeUndefined()
    state = projectHistory(state, { items: [item('oldest')], generation: 0 }, 'z')
    expect(state.snapshot.items.map((entry) => entry.id)).toEqual(['oldest', 'z', 'b', 'm', 'a'])
    expect(state.history).toEqual({ before: undefined, complete: true })
  })

  it('stitches overlapping pages around shared item anchors instead of sorting timestamps or IDs', () => {
    const state = base({ items: [item('b'), item('d')] })
    const filled = projectHistory(state, { items: [item('a'), item('b'), item('c')], generation: 0 }, 'b')
    expect(filled.snapshot.items.map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ignores late or repeated page responses after the requested cursor has advanced', () => {
    const state = base({ items: [item('new')] })
    const chunk = { items: [item('old')], next: 'old', generation: 0 }
    const loaded = projectHistory(state, chunk, 'new')
    expect(projectHistory(loaded, chunk, 'new')).toBe(loaded)
  })

  it('rejects old-generation pages after a rewind and resyncs if history is newer than the snapshot', () => {
    const original = base({ seq: 10, items: [item('old'), item('removed')], historyGeneration: 4 })
    const state = projectFrame(original, frame(11, { type: 'rewound', generation: 5, toTurn: 'trn_1', dropped: ['removed'], filesRestored: [] }))
    expect(state.snapshot.items.map((entry) => entry.id)).toEqual(['old'])
    expect(projectHistory(state, { items: [item('removed')], generation: 4 }, 'old')).toBe(state)
    const newer = projectHistory(state, { items: [item('new')], generation: 6 }, 'old')
    expect(newer.resync).toEqual({ reason: 'history-generation', since: 11 })
    expect(newer.snapshot).toBe(state.snapshot)
  })

  it('compaction advances generation without deleting kept or compacted transcript items', () => {
    const state = run([{ type: 'compacted', generation: 1, boundary: 'b', summary: 's', kept: ['c'] }], base({ items: [item('a'), item('b'), item('c')] }))
    expect(state.snapshot.historyGeneration).toBe(1)
    expect(state.snapshot.items.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('derived presentation', () => {
  it('uses canonical titles before a first-user fallback without mutating the summary', () => {
    expect(selectSessionTitle(base())).toBe('hello')
    const state = base({ summary: { ...rustInitial.summary, title: null }, items: [item('u', { kind: 'user', parts: [{ type: 'text', text: '  Fix\n the parser ' }], origin: { surface: 'desktop' } })] })
    expect(selectSessionTitle(state)).toBe('Fix the parser')
    expect(state.snapshot.summary.title).toBeNull()
    expect(selectSessionTitle(base({ summary: { ...rustInitial.summary, title: null } }))).toBe('New session')
  })

  it('renders all content parts without treating image bytes or tool inputs as prose', () => {
    expect(contentText([
      { type: 'text', text: 'Look at this' },
      { type: 'image', mediaType: 'image/png', data: 'base64' },
      { type: 'toolUse', id: 'call', name: 'Read', input: { file_path: 'x' } },
      { type: 'toolResult', toolUseId: 'call', parts: [{ type: 'text', text: 'ok' }] },
      { type: 'reasoning', text: 'Inspect the output' }
    ])).toBe('Look at this\n[Image]\nRead\nok\nInspect the output')
  })

  it('folds every SDK View variant including custom elements and nested structure', () => {
    const view: View = { kind: 'stack', children: [
      { kind: 'text', text: 'Text' }, { kind: 'markdown', text: '**markdown**' }, { kind: 'code', lang: 'ts', text: 'x()' },
      { kind: 'diff', unified: '-old\n+new' }, { kind: 'list', items: ['one', 'two'] },
      { kind: 'table', headers: ['A', 'B'], rows: [['1', '2']] },
      { kind: 'keyValue', rows: [['model', 'fake']] }, { kind: 'progress', value: 3, total: 10, label: 'Build' },
      { kind: 'badge', text: 'done', tone: 'good' },
      { kind: 'tree', nodes: [{ label: 'root', badge: '2', children: [{ label: 'leaf' }] }] },
      { kind: 'columns', children: [{ kind: 'panel', title: 'Result', child: { kind: 'custom', customKind: 'demo.sparkline', data: [1, 2], fold: '1 → 2' } }] },
      { kind: 'actions', items: [{ label: 'Retry', action: { name: 'retry' } }] }
    ] }
    expect(viewText(view)).toBe('Text\n**markdown**\nx()\n-old\n+new\n- one\n- two\nA · B\n1 · 2\nmodel: fake\nBuild 30 %\n[done]\nroot [2]\n  leaf\nResult\n1 → 2\n[Retry]')
    expect(viewText({ kind: 'progress', value: 3, total: 0 })).toBe('3')
    expect(viewText({ kind: 'progress', value: 3 })).toBe('3')
  })
})
