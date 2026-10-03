// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translate } from '../i18n'
import { localizeNotice, Toast } from './Toast'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Toast', () => {
  it('pauses auto-dismiss while hovered or focused and resumes afterwards', () => {
    const dismiss = vi.fn()
    render(<Toast message="Saved" onDismiss={dismiss} duration={1000} />)
    const toast = screen.getByRole('status')
    fireEvent.pointerEnter(toast)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(dismiss).not.toHaveBeenCalled()
    fireEvent.pointerLeave(toast)
    fireEvent.focus(screen.getByRole('button', { name: 'Dismiss notification' }))
    act(() => { vi.advanceTimersByTime(5000) })
    expect(dismiss).not.toHaveBeenCalled()
    fireEvent.blur(screen.getByRole('button', { name: 'Dismiss notification' }))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(dismiss).toHaveBeenCalledOnce()
  })
  it('runs an optional action and then dismisses', () => {
    const dismiss = vi.fn(), run = vi.fn()
    render(<Toast message="Draft cleared" onDismiss={dismiss} action={{ label: 'Undo', run }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(run).toHaveBeenCalledOnce(); expect(dismiss).toHaveBeenCalledOnce()
  })
  it('localizes runtime thinking acknowledgements and leaves other notices intact', () => {
    const zh = (text: string, vars?: Record<string, string | number>) => translate(text, 'zh-CN', vars)
    expect(localizeNotice('thinking: xHigh', zh)).toBe('思考强度：极高')
    expect(localizeNotice('thinking: xHigh', (text, vars) => translate(text, 'en', vars))).toBe('Thinking effort: Extra high')
    expect(localizeNotice('thinking: turbo', zh)).toBe('thinking: turbo')
    expect(localizeNotice('Finished while away', zh)).toBe('Finished while away')
  })
})
