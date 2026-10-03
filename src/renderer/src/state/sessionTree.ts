import type { Frame, SessionSummary } from '../../../shared/rpc'
import { createSessionProjection, projectFrames, type SessionProjection } from './session'

export function isDescendantFrame(frame: Frame): boolean {
  return !!frame.root && frame.root !== frame.session
}

/** A tree replays stored descendants without reopening their actors. Durable
 * replay omits transient sequence numbers and has no end-of-replay marker. */
export function projectTreeFrames(summary: SessionSummary, frames: Frame[]): SessionProjection {
  return projectFrames(createSessionProjection({ seq: 0, summary, items: [] }), [...frames].sort((a, b) => a.seq - b.seq), 'replay')
}

/** Find the nearest missing ancestor first; never choose a root through a cycle. */
export function treeAttachmentTarget(sessions: SessionSummary[], activeId: string | null): string | null {
  const index = new Map(sessions.map((summary) => [summary.id, summary]))
  const seen = new Set<string>()
  let id = activeId
  while (id && !seen.has(id)) {
    seen.add(id)
    const summary = index.get(id)
    if (!summary || !summary.parent) return id
    id = summary.parent.session
  }
  return null
}
