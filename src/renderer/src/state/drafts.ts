import { useCallback, useEffect, useRef } from 'react'

export const draftStorageKey = 'rei.drafts.v1'
export const draftLimit = 100

/** Re-inserts the key so object order is recency order and the trim evicts the least recently edited. */
export function withDraft<T>(drafts: Record<string, T>, key: string, draft: T): Record<string, T> {
  const { [key]: _, ...rest } = drafts
  return { ...rest, [key]: draft }
}

export function serializeDrafts(drafts: Record<string, { text: string }>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(drafts).filter(([, draft]) => draft.text).slice(-draftLimit).map(([key, draft]) => [key, draft.text])))
}

/** Debounced draft saving that still flushes on pagehide, beforeunload and unmount. */
export function useDraftPersistence(drafts: Record<string, { text: string }>, onResult: (saved: boolean) => void, delay = 350): void {
  const latest = useRef({ drafts, onResult, dirty: false })
  latest.current.onResult = onResult
  const save = useCallback(() => {
    const current = latest.current
    if (!current.dirty) return
    current.dirty = false
    try { localStorage.setItem(draftStorageKey, serializeDrafts(current.drafts)); current.onResult(true) } catch { current.onResult(false) }
  }, [])
  useEffect(() => {
    latest.current.drafts = drafts; latest.current.dirty = true
    const timer = setTimeout(save, delay)
    return () => clearTimeout(timer)
  }, [drafts, delay, save])
  useEffect(() => {
    window.addEventListener('pagehide', save); window.addEventListener('beforeunload', save)
    return () => { window.removeEventListener('pagehide', save); window.removeEventListener('beforeunload', save); save() }
  }, [save])
}
