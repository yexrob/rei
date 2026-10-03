import type {
  ConfigView, ContentPart, Event, EventRefParams, Frame, HistoryChunk, HistoryResult, Interaction, Item, ItemBody,
  OmittedField, OpenHistory, SessionState, SessionSummary, TreeNode, TreeSnapshot, Usage, View, WireOversizedItem
} from '../../../shared/rpc'

export type { Frame, HistoryChunk, Interaction, Item, SessionState, SessionSummary } from '../../../shared/rpc'

export interface SessionProjection {
  snapshot: SessionState
  history: { before?: string; complete: boolean }
  /** `failed` is set once automatic recovery gave up; reopening retries. */
  resync: { reason: 'gap' | 'lagged' | 'history-generation'; since: number; failed?: boolean } | null
  /** Last accepted activity event; row text/status are derived from the snapshot. */
  activityFrame?: Frame
  /** Transport continuity can advance past a deferred event without applying its body. */
  transportSeq?: number
  provisional?: boolean
  historyPending?: boolean
  omittedFields?: OmittedField[]
  tree?: TreeSnapshot
  unloaded?: EventRefParams[]
  unloadedHistory?: (WireOversizedItem & { generation: number })[]
  rawPreview?: { id: string; text: string; totalBytes: number; nextOffset: number | null }
}

export type MessageItem = Item & { body: Extract<ItemBody, { kind: 'user' | 'assistant' }> }
export type ToolCallItem = Item & { body: Extract<ItemBody, { kind: 'toolCall' }> }
export type SessionStatus = 'ready' | 'working' | 'retrying' | 'waiting' | 'failed' | 'interrupted' | 'closed' | 'resyncing'

const zeroUsage: Usage = {
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0
}

export function createSessionProjection(snapshot: SessionState, history?: OpenHistory): SessionProjection {
  return {
    snapshot: {
      config: { kernel: null, plugins: {} }, historyGeneration: 0,
      queue: [], interactions: [], unread: false, closed: false,
      ...snapshot
    },
    history: history ? { before: history.before ?? undefined, complete: !history.hasMore } : { before: snapshot.items[0]?.id, complete: snapshot.items.length === 0 },
    resync: null
  }
}

/** A transport reference advances stream continuity, not the canonical fold. */
export function projectEventReference(state: SessionProjection, ref: EventRefParams): SessionProjection {
  if (ref.session !== state.snapshot.summary.id || state.resync) return state
  const received = state.transportSeq ?? state.snapshot.seq
  if (ref.seq <= received) return state
  if (ref.seq > received + 1) return requireSnapshot(state, 'gap')
  return { ...state, transportSeq: ref.seq, unloaded: boundedUnloaded(state.unloaded ?? [], ref) }
}

/** Uncertain references gate intents and are never aged out; plain ones are capped oldest-first. */
export const unloadedLimit = 1000
function boundedUnloaded(current: EventRefParams[], ref: EventRefParams): EventRefParams[] {
  const next = [...current, ref]
  if (next.length <= unloadedLimit) return next
  const index = next.findIndex((entry) => !entry.stateUncertain)
  if (index >= 0) next.splice(index, 1)
  return next
}

/** Arrays copied during one fold may be written in place; inputs never are. */
export type FoldDraft = { owned: WeakSet<Item[]>; writes: number }
export const foldDraft = (): FoldDraft => ({ owned: new WeakSet(), writes: 0 })
function writable(items: Item[], draft?: FoldDraft): Item[] {
  if (draft) draft.writes += 1
  if (draft?.owned.has(items)) return items
  const next = items.slice()
  draft?.owned.add(next)
  return next
}

/** Exact SDK SessionState::apply fold. Transport recovery belongs to projectFrame. */
export function foldSessionFrame(snapshot: SessionState, frame: Frame, draft?: FoldDraft): SessionState {
  if (frame.event.type === 'lagged') return snapshot
  if (snapshot.seq !== 0 && frame.seq <= snapshot.seq) return snapshot
  let next = { ...snapshot, seq: frame.seq }
  if (frame.event.type === 'itemCompleted' && isMessage(frame.event.item)) {
    next = { ...next, summary: { ...next.summary, messages: (next.summary.messages ?? 0) + 1 } }
  }
  return applyEvent(next, frame.event, frame.ts, draft)
}

/** Open attachments are live/contiguous; session/events replay legally omits transient seqs. */
export function projectFrame(
  state: SessionProjection,
  frame: Frame,
  mode: 'live' | 'replay' = 'live',
  draft?: FoldDraft
): SessionProjection {
  if (frame.session !== state.snapshot.summary.id || state.resync) return state
  if (frame.event.type === 'lagged') return requireSnapshot(state, 'lagged')
  const received = state.transportSeq ?? state.snapshot.seq
  if (received !== 0 && frame.seq <= received) return state
  if (mode === 'live' && frame.seq > received + 1) return requireSnapshot(state, 'gap')
  const writes = draft?.writes ?? 0
  const snapshot = foldSessionFrame(state.snapshot, frame, draft)
  if (snapshot === state.snapshot) return state
  const changedHistory = (snapshot.historyGeneration ?? 0) !== (state.snapshot.historyGeneration ?? 0)
  const { activityFrame, ...rest } = state
  const activity = changedHistory ? undefined : activityEvent(frame, snapshot.items !== state.snapshot.items || (draft?.writes ?? 0) !== writes) ? frame : activityFrame
  return {
    ...rest, snapshot,
    ...(state.transportSeq !== undefined ? { transportSeq: frame.seq } : {}),
    ...(activity ? { activityFrame: activity } : {}),
    history: changedHistory
      ? { before: snapshot.items[0]?.id, complete: snapshot.items.length === 0 }
      : state.history
  }
}

/** Folds a run of frames copying the transcript at most once instead of once per delta. */
export function projectFrames(state: SessionProjection, frames: Iterable<Frame>, mode: 'live' | 'replay' = 'live'): SessionProjection {
  const draft = foldDraft()
  for (const frame of frames) state = projectFrame(state, frame, mode, draft)
  return state
}

function activityEvent(frame: Frame, changedItems: boolean): boolean {
  if (['itemStarted', 'itemUpdated', 'itemCompleted', 'itemDelta'].includes(frame.event.type)) return changedItems
  return ['notice', 'interactionOpened', 'interactionResolved', 'interactionCancelled', 'turnRetrying', 'turnCompleted', 'sessionClosed'].includes(frame.event.type)
}

function requireSnapshot(state: SessionProjection, reason: NonNullable<SessionProjection['resync']>['reason']): SessionProjection {
  return { ...state, resync: { reason, since: state.snapshot.seq } }
}

/** Pass the before cursor captured when requesting this page, not the current cursor. */
export function projectHistory(state: SessionProjection, chunk: HistoryResult, requestedBefore?: string): SessionProjection {
  if (state.resync) return state
  const generation = state.snapshot.historyGeneration ?? 0
  if (chunk.generation < generation) return state
  if (chunk.generation > generation) return requireSnapshot(state, 'history-generation')
  if (state.history.complete || requestedBefore !== state.history.before) return state
  return {
    ...state,
    snapshot: { ...state.snapshot, items: mergeHistory(state.snapshot.items, chunk.items, requestedBefore) },
    history: { before: chunk.next ?? undefined, complete: chunk.next == null },
    ...(chunk.oversized ? { unloadedHistory: [...state.unloadedHistory ?? [], { ...chunk.oversized, generation: chunk.generation }] } : {})
  }
}

function mergeHistory(current: Item[], page: Item[], before?: string): Item[] {
  // Pages are already in transcript order. IDs/timestamps do not define that order.
  // Insert relative to shared anchors and always retain the newer live version.
  // One linear pass: each new item follows its page predecessor; a leading run
  // precedes the first shared anchor (or the requested cursor), else the start.
  const known = new Set(current.map((item) => item.id))
  const after = new Map<string, Item[]>()
  let head: Item | undefined, headAnchor: string | undefined, previous: string | undefined
  for (const item of page) {
    if (!known.has(item.id)) {
      if (previous === undefined) { head = item; headAnchor = page.find((entry) => known.has(entry.id))?.id ?? before }
      else after.set(previous, [...after.get(previous) ?? [], item])
      known.add(item.id)
    }
    previous = item.id
  }
  if (!head && !after.size) return current.slice()
  const items: Item[] = []
  const emit = (item: Item) => {
    items.push(item)
    const run = after.get(item.id)
    if (run) { after.delete(item.id); for (const next of run) emit(next) }
  }
  const anchored = head !== undefined && current.some((item) => item.id === headAnchor)
  if (head && !anchored) emit(head)
  for (const item of current) { if (head && anchored && item.id === headAnchor) { emit(head); head = undefined } emit(item) }
  return items
}

export function isDurableEvent(event: Event): boolean {
  return !['itemDelta', 'notice', 'signal', 'lagged'].includes(event.type)
}

export function isTerminal(item: Item): boolean {
  return item.status === 'completed' || item.status === 'failed' || item.status === 'interrupted'
}

function isMessage(item: Item): item is MessageItem {
  return item.body.kind === 'user' || item.body.kind === 'assistant'
}

function upsert(items: Item[], item: Item, draft?: FoldDraft): Item[] {
  const index = lastItemIndex(items, item.id)
  const next = writable(items, draft)
  if (index < 0) next.push(item)
  else next[index] = item
  return next
}

function lastItemIndex(items: Item[], id: string): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].id === id) return index
  }
  return -1
}

function applyDelta(items: Item[], event: Extract<Event, { type: 'itemDelta' }>, draft?: FoldDraft): Item[] {
  const index = lastItemIndex(items, event.item)
  const item = items[index]
  if (!item || isTerminal(item)) return items
  let body = item.body
  if (body.kind === 'assistant' && event.kind === 'text') body = { ...body, text: body.text + event.data }
  else if (body.kind === 'reasoning' && event.kind === 'reasoning') body = { ...body, text: body.text + event.data }
  else if (body.kind === 'toolCall' && event.kind === 'tail') body = { ...body, progress: event.data }
  else return items
  const next = writable(items, draft)
  next[index] = { ...item, body }
  return next
}

function addUsage(left: Usage = zeroUsage, right: Usage = zeroUsage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: (left.cacheReadTokens ?? 0) + (right.cacheReadTokens ?? 0),
    cacheWriteTokens: (left.cacheWriteTokens ?? 0) + (right.cacheWriteTokens ?? 0),
    reasoningTokens: (left.reasoningTokens ?? 0) + (right.reasoningTokens ?? 0)
  }
}

function applyUsage(state: SessionState, event: Extract<Event, { type: 'turnUsage' }>): SessionState {
  const next = {
    ...state, context: event.context,
    summary: { ...state.summary, usage: addUsage(state.summary.usage, event.usage) }
  }
  if (!state.turn) return next
  const { retrying: _, ...turn } = state.turn
  return { ...next, turn: { ...turn, round: (turn.round ?? 0) + 1, usage: addUsage(turn.usage, event.usage) } }
}

function applySignal(state: SessionState, event: Extract<Event, { type: 'signal' }>): SessionState {
  let signals = { ...state.signals }
  const kinds = { ...signals[event.plugin] }
  if (event.payload === null) {
    delete kinds[event.kind]
    if (Object.keys(kinds).length === 0) delete signals[event.plugin]
    else signals = { ...signals, [event.plugin]: kinds }
  } else {
    signals = { ...signals, [event.plugin]: { ...kinds, [event.kind]: event.payload } }
  }
  const { signals: _, ...withoutSignals } = state
  return Object.keys(signals).length === 0 ? withoutSignals : { ...state, signals }
}

function applyEvent(state: SessionState, event: Event, ts: string, draft?: FoldDraft): SessionState {
  switch (event.type) {
    case 'sessionUpdated': return { ...state, summary: event.summary }
    case 'sessionClosed': {
      const { turn: _, ...rest } = state
      return { ...rest, closed: true, interactions: [] }
    }
    case 'turnStarted': return {
      ...state, summary: { ...state.summary, busy: true },
      turn: { id: event.turn, startedAt: ts, origin: event.origin, round: 0, usage: { ...zeroUsage } }
    }
    case 'turnRetrying': return {
      ...state, items: state.items.filter((item) => !event.dropped.includes(item.id)),
      ...(state.turn ? { turn: { ...state.turn, retrying: { attempt: event.attempt, max: event.max } } } : {})
    }
    case 'turnUsage': return applyUsage(state, event)
    case 'turnCompleted': {
      const { turn, ...rest } = state
      const lastTurn = { id: event.turn, status: event.status, startedAt: turn?.id === event.turn ? turn.startedAt : ts, endedAt: ts, usage: event.usage }
      return { ...rest, summary: { ...state.summary, busy: false }, lastTurn, unread: true }
    }
    case 'itemStarted':
    case 'itemUpdated':
    case 'itemCompleted': return { ...state, items: upsert(state.items, event.item, draft) }
    case 'itemDelta': return { ...state, items: applyDelta(state.items, event, draft) }
    case 'queueChanged': return { ...state, queue: event.entries }
    case 'interactionOpened': return {
      ...state, interactions: [...(state.interactions ?? []).filter((item) => item.id !== event.interaction.id), event.interaction]
    }
    case 'interactionResolved':
    case 'interactionCancelled': return { ...state, interactions: (state.interactions ?? []).filter((item) => item.id !== event.id) }
    case 'compacted': return { ...state, historyGeneration: event.generation }
    case 'rewound': return {
      ...state, historyGeneration: event.generation, items: state.items.filter((item) => !event.dropped.includes(item.id))
    }
    case 'configChanged': return { ...state, config: event.config }
    case 'extension': return {
      ...state, extensions: {
        ...state.extensions,
        [event.plugin]: { ...state.extensions?.[event.plugin], [event.kind]: event.payload }
      }
    }
    case 'signal': return applySignal(state, event)
    case 'intentAck':
    case 'catalogChanged':
    case 'notice':
    case 'lagged': return state
    default: return unreachable(event)
  }
}

function unreachable(value: never): never {
  throw new Error(`Unsupported protocol variant: ${JSON.stringify(value)}`)
}

export function selectWorkspaceThreads(sessions: SessionSummary[], workspace: string | null): SessionSummary[] {
  // Opening or streaming a thread must not move the row under the pointer.
  return sessions.filter((session) => !session.parent && session.driver !== 'log' && session.cwd === workspace)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
}

export function selectMessages(state: SessionProjection): MessageItem[] {
  return state.snapshot.items.filter(isMessage)
}

export function selectToolRuns(state: SessionProjection): ToolCallItem[] {
  return state.snapshot.items.filter((item): item is ToolCallItem => item.body.kind === 'toolCall')
}

export function selectPendingInteractions(state: SessionProjection): Interaction[] {
  return state.snapshot.interactions ?? []
}

export function selectConfig(state: SessionProjection): ConfigView {
  return state.snapshot.config ?? { kernel: null, plugins: {} }
}

export function selectUsage(state: SessionProjection): Usage {
  return state.snapshot.summary.usage ?? zeroUsage
}

export function selectStatus(state: SessionProjection): SessionStatus {
  if (state.resync) return state.resync.failed ? 'failed' : 'resyncing'
  if (state.snapshot.closed) return 'closed'
  if (selectPendingInteractions(state).length > 0) return 'waiting'
  if (state.snapshot.turn?.retrying) return 'retrying'
  if (state.snapshot.turn) return 'working'
  if (state.snapshot.lastTurn?.status.kind === 'failed') return 'failed'
  if (state.snapshot.lastTurn?.status.kind === 'interrupted') return 'interrupted'
  return 'ready'
}

export function selectSessionTitle(state: SessionProjection): string {
  const summary = state.snapshot.summary
  if (summary.title?.trim()) return summary.title
  const first = selectMessages(state).find((item) => item.body.kind === 'user')
  return (first ? itemText(first).replace(/\s+/g, ' ').trim().slice(0, 80) : '') || summary.key || 'New session'
}

export function contentText(parts: ContentPart[]): string {
  return parts.map((part) => {
    switch (part.type) {
      case 'text':
      case 'reasoning': return part.text
      case 'toolResult': return contentText(part.parts)
      case 'image': return '[Image]'
      case 'toolUse': return part.name
      default: return unreachable(part)
    }
  }).join('\n')
}

export function itemText(item: Item): string {
  const body = item.body
  switch (body.kind) {
    case 'user': return contentText(body.parts)
    case 'assistant':
    case 'reasoning':
    case 'notice': return body.text
    case 'toolCall': return body.output?.display ? viewText(body.output.display) : body.output ? contentText(body.output.parts) : body.progress ?? ''
    case 'shell': return body.output
    case 'action': return typeof body.result === 'string' ? body.result : body.result === undefined ? body.name : JSON.stringify(body.result)
    case 'compaction': return body.summary
    case 'rewind': return `Rewound ${body.dropped} items`
    case 'interruption': return body.marker
    case 'questionAnswer': return `${body.question}\n${body.answer}`
    case 'permissionReceipt': return `${body.tool}: ${body.decision}${body.feedback ? ` — ${body.feedback}` : ''}`
    case 'asset': return body.label ?? body.asset
    default: return unreachable(body)
  }
}

/** The SDK View::fold fallback, also used for plain-text export and custom nodes. */
export function viewText(view: View): string {
  switch (view.kind) {
    case 'text':
    case 'markdown':
    case 'code': return view.text
    case 'diff': return view.unified
    case 'list': return view.items.map((item) => `- ${item}`).join('\n')
    case 'table': return [view.headers, ...view.rows].map((row) => row.join(' · ')).join('\n')
    case 'keyValue': return view.rows.map(([key, value]) => `${key}: ${value}`).join('\n')
    case 'progress': {
      const amount = view.total && view.total > 0 ? `${Math.floor(view.value * 100 / view.total)} %` : String(view.value)
      return view.label == null ? amount : `${view.label} ${amount}`
    }
    case 'badge': return `[${view.text}]`
    case 'tree': return view.nodes.map((node) => treeText(node, 0)).join('\n')
    case 'stack':
    case 'columns': return view.children.map(viewText).join('\n')
    case 'panel': return `${view.title}\n${viewText(view.child)}`
    case 'actions': return view.items.map((item) => `[${item.label}]`).join(' ')
    case 'custom': return view.fold
    default: return unreachable(view)
  }
}

function treeText(node: TreeNode, depth: number): string {
  return [
    `${'  '.repeat(depth)}${node.label}${node.badge == null ? '' : ` [${node.badge}]`}`,
    ...(node.children ?? []).map((child) => treeText(child, depth + 1))
  ].join('\n')
}
