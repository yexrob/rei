// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Splitter, useStoredSize } from './Splitter'

afterEach(() => { cleanup(); localStorage.clear() })

describe('Splitter', () => {
  it('exposes separator semantics and resizes a trailing pane with the keyboard', () => {
    const onChange = vi.fn(), onReset = vi.fn()
    render(<Splitter label="Resize browser panel" orientation="vertical" value={400} min={300} max={600} onChange={onChange} onReset={onReset} />)
    const separator = screen.getByRole('separator', { name: 'Resize browser panel' })
    expect(separator.getAttribute('aria-orientation')).toBe('vertical')
    expect(separator.getAttribute('aria-valuenow')).toBe('400')
    expect(separator.tabIndex).toBe(0)
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith(424)
    fireEvent.keyDown(separator, { key: 'ArrowRight', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith(304)
    fireEvent.keyDown(separator, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith(600)
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    fireEvent.keyDown(separator, { key: 'Enter' })
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('drags a pane below a horizontal splitter and marks the document while resizing', () => {
    const onChange = vi.fn()
    render(<Splitter label="Resize terminal" orientation="horizontal" value={200} min={140} max={500} onChange={onChange} />)
    const separator = screen.getByRole('separator')
    fireEvent.pointerDown(separator, { button: 0, clientY: 500, pointerId: 1 })
    expect(document.documentElement.dataset.resizing).toBe('horizontal')
    fireEvent.pointerMove(separator, { clientY: 400, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(300)
    fireEvent.pointerMove(separator, { clientY: 900, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(140)
    fireEvent.pointerUp(separator, { pointerId: 1 })
    expect(document.documentElement.dataset.resizing).toBeUndefined()
  })

  it('persists sizes per viewer and can reset to the layout default', () => {
    const { result } = renderHook(() => useStoredSize('rei.test-size'))
    expect(result.current[0]).toBeNull()
    act(() => result.current[1](333.6))
    expect(localStorage.getItem('rei.test-size')).toBe('334')
    act(() => result.current[1](null))
    expect(localStorage.getItem('rei.test-size')).toBeNull()
  })
})
