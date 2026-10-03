import { useEffect, useRef } from 'react'
import type { AttentionNotice } from '../../shared/desktop'
import type { Translator } from './i18n'

export type AttentionSession = { hostId: string; sessionId: string; title: string; status: string }
const RUNNING = new Set(['working', 'retrying', 'resyncing'])

/** Pure transition rule: which status changes deserve an OS-level notice. */
export function attentionNotice(previous: string | undefined, next: AttentionSession, t: Translator): AttentionNotice | null {
  if (previous === undefined || previous === next.status) return null
  const body = next.title.slice(0, 240)
  const base = { hostId: next.hostId, sessionId: next.sessionId, body }
  if (next.status === 'waiting') return { ...base, kind: 'waiting', title: t('Bingo needs your input') }
  if (!RUNNING.has(previous) && previous !== 'waiting') return null
  if (next.status === 'failed') return { ...base, kind: 'failed', title: t('Task failed') }
  if (next.status === 'ready' || next.status === 'interrupted') return previous === 'waiting' ? null : { ...base, kind: 'completed', title: t('Task finished') }
  return null
}

/**
 * Notifies through Main (which shows nothing while the window is focused) and
 * mirrors the number of sessions waiting for a person onto the app badge.
 */
export function useAttentionNotifications(sessions: AttentionSession[], enabled: boolean, t: Translator): void {
  const previous = useRef(new Map<string, string>())
  const badge = useRef(-1)
  useEffect(() => {
    const api = window.bingoDesktop
    const seen = new Map<string, string>()
    for (const session of sessions) {
      const key = JSON.stringify([session.hostId, session.sessionId])
      seen.set(key, session.status)
      const notice = enabled && !document.hasFocus() ? attentionNotice(previous.current.get(key), session, t) : null
      if (notice && api?.notify) void api.notify(notice).catch(() => {})
    }
    previous.current = seen
    const waiting = enabled ? sessions.filter(session => session.status === 'waiting').length : 0
    if (waiting !== badge.current && api?.setBadgeCount) { badge.current = waiting; void api.setBadgeCount(Math.min(waiting, 999)).catch(() => {}) }
  }, [sessions, enabled, t])
}
