import { useEffect, useState, useSyncExternalStore } from 'react'

const reducedQuery = '(prefers-reduced-motion: reduce)'
function subscribeReduced(notify: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const query = window.matchMedia(reducedQuery)
  query.addEventListener?.('change', notify)
  return () => query.removeEventListener?.('change', notify)
}
const reducedSnapshot = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(reducedQuery).matches)
/** JS-driven motion (stream pacing, carets) must honor the same preference CSS does. */
export function useReducedMotion(): boolean { return useSyncExternalStore(subscribeReduced, reducedSnapshot, () => false) }

/** Wall-clock seconds since `since` while `active`; frozen (null) otherwise. One shared 1s cadence per consumer. */
export function useElapsed(since: string | undefined, active: boolean): number | null {
  const start = since ? Date.parse(since) : NaN
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || !Number.isFinite(start)) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active, start])
  if (!active || !Number.isFinite(start)) return null
  return Math.max(0, Math.floor((now - start) / 1000))
}

export function durationBetween(start: string | undefined, end: string | null | undefined): number | null {
  const from = start ? Date.parse(start) : NaN, to = end ? Date.parse(end) : NaN
  return Number.isFinite(from) && Number.isFinite(to) && to >= from ? (to - from) / 1000 : null
}

/** Compact human duration: 0.4s, 12s, 2m 05s, 1h 03m. */
export function formatSeconds(seconds: number): string {
  if (seconds < 0.1) return '<0.1s'
  if (seconds < 10 && !Number.isInteger(seconds)) return `${seconds.toFixed(1)}s`
  const whole = Math.round(seconds)
  if (whole < 60) return `${whole}s`
  if (whole < 3600) return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`
  return `${Math.floor(whole / 3600)}h ${String(Math.floor(whole / 60) % 60).padStart(2, '0')}m`
}
