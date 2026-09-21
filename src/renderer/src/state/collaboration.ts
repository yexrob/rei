import type { Event, InteractionKind, Item, SessionState, SessionSummary } from '../../../shared/rpc'
import { itemText, selectStatus, type SessionProjection, type SessionStatus } from './session'

export interface Collaborator {
  id: string
  kind: 'agent' | 'room'
  name: string
  main: boolean
  status: SessionStatus | 'loading'
  activity: { kind: string; text: string; detail?: string } | null
  projection?: SessionProjection
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function isRoomSession(summary: SessionSummary): boolean {
  return summary.driver === 'log' && !!summary.key?.startsWith('rooms/') && !!summary.parent && !!summary.title?.trim()
}

export function isAgentSession(summary: SessionSummary): boolean {
  if (!summary.parent || summary.driver === 'log' || !summary.title?.trim()) return false
  const prefix = `agent/${summary.parent.session}/`
  return !!summary.key?.startsWith(prefix) && summary.key.length > prefix.length
}

export function roomMetadata(snapshot: SessionState): { purpose: string; members: string[]; closed: boolean } {
  const extension = record(snapshot.extensions?.['bingo.rooms'])
  const purpose = record(extension.opened).purpose
  const members = record(extension.members).members
  return {
    purpose: typeof purpose === 'string' ? purpose : '',
    members: Array.isArray(members) ? members.filter((member): member is string => typeof member === 'string') : [],
    // The room plugin tests presence, not the shape/truthiness of the payload.
    closed: extension.closed !== undefined && extension.closed !== null
  }
}

export function rootSessionId(sessions: SessionSummary[], activeId: string | null): string | null {
  const index = new Map(sessions.map((session) => [session.id, session]))
  const seen = new Set<string>()
  let id = activeId
  while (id && !seen.has(id)) {
    seen.add(id)
    const session = index.get(id)
    if (!session) return null
    if (!session.parent) return id
    id = session.parent.session
  }
  return null
}

function activityItem(projection: SessionProjection): Item | undefined {
  const event = projection.activityFrame?.event
  const id = event?.type === 'itemDelta' ? event.item
    : event?.type === 'itemStarted' || event?.type === 'itemUpdated' || event?.type === 'itemCompleted' ? event.item.id : undefined
  const referenced = id ? projection.snapshot.items.find((item) => item.id === id) : undefined
  if (referenced) return referenced
  // Snapshots have no item updatedAt. Completion/start time is only a fallback;
  // a live event reference, when present, is the actual activity authority.
  return projection.snapshot.items.reduce<Item | undefined>((latest, item) => {
    const time = item.completedAt ?? item.startedAt
    const previous = latest?.completedAt ?? latest?.startedAt ?? ''
    return time >= previous ? item : latest
  }, undefined)
}

function itemActivity(item: Item): Collaborator['activity'] {
  if (item.body.kind !== 'toolCall') return { kind: item.body.kind, text: itemText(item) }
  const input = record(item.body.input)
  const target = [input.file_path, input.path, input.command, input.url, input.query, input.to].find((value) => typeof value === 'string')
  const detail = [target, item.body.progress || itemText(item)].filter((value) => typeof value === 'string' && value.trim()).join(' · ')
  return { kind: 'toolCall', text: item.body.name, ...(detail ? { detail } : {}) }
}

function interactionText(kind: InteractionKind): string {
  switch (kind.kind) {
    case 'permission': return kind.summary
    case 'question': return kind.question
    case 'form': return kind.title || kind.questions.map((question) => question.question).join(' · ')
    case 'confirm': return `${kind.title} · ${kind.detail}`
    case 'login': return kind.provider
  }
}

function eventActivity(event?: Event): Collaborator['activity'] {
  if (!event) return null
  const kind = event.type
  switch (event.type) {
    case 'notice': return { kind, text: event.text }
    case 'interactionOpened': return { kind, text: interactionText(event.interaction.kind) }
    case 'interactionResolved': return { kind, text: `Answered: ${event.answer.kind}` }
    case 'interactionCancelled': return { kind, text: `Interaction cancelled: ${event.reason}` }
    case 'turnRetrying': return { kind, text: event.reason, detail: `${event.attempt}/${event.max}` }
    case 'turnCompleted': return { kind, text: event.status.kind === 'failed' ? event.status.error.message : event.status.kind === 'interrupted' ? 'Interrupted' : 'Completed' }
    case 'sessionClosed': return { kind, text: event.reason.kind === 'error' ? event.reason.message : 'Closed' }
    default: return null
  }
}

function collaborator(summary: SessionSummary, rootId: string, projection?: SessionProjection): Collaborator {
  const room = isRoomSession(summary)
  const latest = projection && !projection.resync ? activityItem(projection) : undefined
  return {
    id: summary.id, kind: room ? 'room' : 'agent', name: summary.title?.trim() || summary.id, main: summary.id === rootId,
    status: projection ? room && roomMetadata(projection.snapshot).closed ? 'closed' : selectStatus(projection) : summary.busy ? 'working' : 'loading',
    activity: projection?.resync ? null : eventActivity(projection?.activityFrame?.event) ?? (latest ? itemActivity(latest) : null),
    ...(projection ? { projection } : {})
  }
}

export function selectCollaboration(sessions: SessionSummary[], projections: Record<string, SessionProjection>, activeId: string | null): { rootId: string | null; root: SessionSummary | null; entries: Collaborator[] } {
  const rootId = rootSessionId(sessions, activeId)
  const root = sessions.find((session) => session.id === rootId) ?? null
  if (!root || !rootId) return { rootId: null, root: null, entries: [] }
  const descendants = sessions.filter((session) => session.id !== rootId && (isRoomSession(session) || isAgentSession(session)) && rootSessionId(sessions, session.id) === rootId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return { rootId, root, entries: [root, ...descendants].map((summary) => collaborator(summary, rootId, projections[summary.id])) }
}
