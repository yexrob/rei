// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftLimit, draftStorageKey, serializeDrafts, useDraftPersistence, withDraft } from './drafts'

const saved = () => JSON.parse(localStorage.getItem(draftStorageKey) ?? '{}') as Record<string, string>

describe('draft persistence', () => {
  afterEach(() => { localStorage.clear(); vi.useRealTimers() })

  it('trims by last edit rather than first insertion', () => {
    let drafts: Record<string, { text: string }> = {}
    for (let index = 0; index <= draftLimit; index += 1) drafts = withDraft(drafts, `k${index}`, { text: `t${index}` })
    drafts = withDraft(drafts, 'k0', { text: 'edited' })
    const kept = JSON.parse(serializeDrafts(drafts)) as Record<string, string>
    expect(Object.keys(kept)).toHaveLength(draftLimit)
    expect(kept.k0).toBe('edited')
    expect(kept.k1).toBeUndefined()
  })

  it('debounces saves but flushes pending text on pagehide and on unmount', () => {
    vi.useFakeTimers()
    const onResult = vi.fn()
    const { rerender, unmount } = renderHook(({ drafts }) => useDraftPersistence(drafts, onResult), { initialProps: { drafts: { a: { text: 'one' } } } })
    vi.advanceTimersByTime(350)
    expect(saved()).toEqual({ a: 'one' })
    rerender({ drafts: { a: { text: 'two' } } })
    expect(saved()).toEqual({ a: 'one' })
    window.dispatchEvent(new Event('pagehide'))
    expect(saved()).toEqual({ a: 'two' })
    rerender({ drafts: { a: { text: 'three' } } })
    unmount()
    expect(saved()).toEqual({ a: 'three' })
    expect(onResult).toHaveBeenLastCalledWith(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
