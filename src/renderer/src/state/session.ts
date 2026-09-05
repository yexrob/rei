import type {
  ConfigView, ContentPart, Event, Frame, HistoryChunk, Interaction, Item, ItemBody,
  SessionState, SessionSummary, TreeNode, Usage, View
} from '../../../shared/rpc'

export type { Frame, HistoryChunk, Interaction, Item, SessionState, SessionSummary } from '../../../shared/rpc'

export interface SessionProjection {
  snapshot: SessionState
  history: { before?: string; complete: boolean }
  resync: { reason: 'gap' | 'lagged' | 'history-generation'; since: number } | null
}

export type MessageItem = Item & { body: Extract<ItemBody, { kind: 'user' | 'assistant' }> }
export type ToolCallItem = Item & { body: Extract<ItemBody, { kind: 'toolCall' }> }
export type SessionStatus = 'ready' | 'working' | 'retrying' | 'waiting' | 'failed' | 'interrupted' | 'closed' | 'resyncing'

const zeroUsage: Usage = {
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0
}

export function createSessionProjection(snapshot: SessionState): SessionProjection {
  return {
    snapshot: {
      config: { kernel: null, plugins: {} }, historyGeneration: 0,
      queue: [], interactions: [], unread: false, closed: false,
      ...snapshot
    },
    history: { before: snapshot.items[0]?.id, complete: snapshot.items.length === 0 },
    resync: null
  }
}

/** Exact SDK SessionState::apply fold. Transport recovery belongs to projectFrame. */
export function foldSessionFrame(snapshot: SessionState, frame: Frame): SessionState {
  if (frame.event.type === 'lagged') return snapshot
  if (snapshot.seq !== 0 && frame.seq <= snapshot.seq) return snapshot
  let next = { ...snapshot, seq: frame.seq }
  if (frame.event.type === 'itemCompleted' && isMessage(frame.event.item)) {
    next = { ...next, summary: { ...next.summary, messages: (next.summary.messages ?? 0) + 1 } }
  }
  return applyEvent(next, frame.event, frame.ts)
}

/** Open attachments are live/contiguous; session/events replay legally omits transient seqs. */
export function projectFrame(
  state: SessionProjection,
  frame: Frame,
  mode: 'live' | 'replay' = 'live'
): SessionProjection {
  if (frame.session !== state.snapshot.summary.id || state.resync) return state
  if (frame.event.type === 'lagged') return requireSnapshot(state, 'lagged')
  if (state.snapshot.seq !== 0 && frame.seq <= state.snapshot.seq) return state
  if (mode === 'live' && frame.seq > state.snapshot.seq + 1) return requireSnapshot(state, 'gap')
  const snapshot = foldSessionFrame(state.snapshot, frame)
  if (snapshot === state.snapshot) return state
  const changedHistory = (snapshot.historyGeneration ?? 0) !== (state.snapshot.historyGeneration ?? 0)
  return {
    ...state, snapshot,
    history: changedHistory
      ? { before: snapshot.items[0]?.id, complete: snapshot.items.length === 0 }
      : state.history
  }
}

function requireSnapshot(state: SessionProjection, reason: NonNullable<SessionProjection['resync']>['reason']): SessionProjection {
  return { ...state, resync: { reason, since: state.snapshot.seq } }
}

/** Pass the before cursor captured when requesting this page, not the current cursor. */
export function projectHistory(state: SessionProjection, chunk: HistoryChunk, requestedBefore?: string): SessionProjection {
  if (state.resync) return state
  const generation = state.snapshot.historyGeneration ?? 0
  if (chunk.generation < generation) return state
  if (chunk.generation > generation) return requireSnapshot(state, 'history-generation')
  if (state.history.complete || requestedBefore !== state.history.before) return state
  return {
    ...state,
    snapshot: { ...state.snapshot, items: mergeHistory(state.snapshot.items, chunk.items, requestedBefore) },
    history: { before: chunk.next ?? undefined, complete: chunk.next == null }
  }
}

function mergeHistory(current: Item[], page: Item[], before?: string): Item[] {
  // Pages are already in transcript order. IDs/timestamps do not define that order.
  // Insert relative to shared anchors and always retain the newer live version.
  const items = current.slice()
  const known = new Set(current.map((item) => item.id))
  let previous: string | undefined
  for (let index = 0; index < page.length; index += 1) {
    const item = page[index]
    if (!known.has(item.id)) {
      const nextAnchor = page.slice(index + 1).find((entry) => known.has(entry.id))?.id ?? before
      const position = previous !== undefined
        ? items.findIndex((entry) => entry.id === previous) + 1
        : items.findIndex((entry) => entry.id === nextAnchor)
      items.splice(position < 0 ? 0 : position, 0, item)
      known.add(item.id)
    }
    previous = item.id
  }
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

function upsert(items: Item[], item: Item): Item[] {
  const index = lastItemIndex(items, item.id)
  if (index < 0) return [...items, item]
  const next = items.slice()
  next[index] = item
  return next
}

function lastItemIndex(items: Item[], id: string): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].id === id) return index
  }
  return -1
}

function applyDelta(items: Item[], event: Extract<Event, { type: 'itemDelta' }>): Item[] {
  const index = lastItemIndex(items, event.item)
  const item = items[index]
  if (!item || isTerminal(item)) return items
  let body = item.body
  if (body.kind === 'assistant' && event.kind === 'text') body = { ...body, text: body.text + event.data }
  else if (body.kind === 'reasoning' && event.kind === 'reasoning') body = { ...body, text: body.text + event.data }
  else if (body.kind === 'toolCall' && event.kind === 'tail') body = { ...body, progress: event.data }
  else return items
  const next = items.slice()
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

function applyEvent(state: SessionState, event: Event, ts: string): SessionState {
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
      const { turn: _, ...rest } = state
      return { ...rest, summary: { ...state.summary, busy: false }, lastTurn: event.status, unread: true }
    }
    case 'itemStarted':
    case 'itemUpdated':
    case 'itemCompleted': return { ...state, items: upsert(state.items, event.item) }
    case 'itemDelta': return { ...state, items: applyDelta(state.items, event) }
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
  if (state.resync) return 'resyncing'
  if (state.snapshot.closed) return 'closed'
  if (selectPendingInteractions(state).length > 0) return 'waiting'
  if (state.snapshot.turn?.retrying) return 'retrying'
  if (state.snapshot.turn) return 'working'
  if (state.snapshot.lastTurn?.kind === 'failed') return 'failed'
  if (state.snapshot.lastTurn?.kind === 'interrupted') return 'interrupted'
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
