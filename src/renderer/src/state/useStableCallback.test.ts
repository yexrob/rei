// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useStableCallback } from './useStableCallback'

describe('useStableCallback', () => {
  it('keeps one identity across renders while calling the latest closure', () => {
    const { result, rerender } = renderHook(({ suffix }) => useStableCallback((id: string) => `${id}:${suffix}`), { initialProps: { suffix: 'a' } })
    const first = result.current
    expect(first('x')).toBe('x:a')
    rerender({ suffix: 'b' })
    expect(result.current).toBe(first)
    expect(first('x')).toBe('x:b')
  })
})
