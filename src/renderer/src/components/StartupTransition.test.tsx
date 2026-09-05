// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StartupTransition } from './StartupTransition'

let reduced = false
beforeEach(() => {
  reduced = false
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('startup handoff', () => {
  it('reveals the actual window and makes it interactive after readiness', () => {
    const { container } = render(<StartupTransition ready><button>Workspace action</button></StartupTransition>)
    expect(container.querySelector('.startup-stage')?.getAttribute('data-phase')).toBe('intro')
    expect(container.querySelector('.startup-content')?.hasAttribute('inert')).toBe(true)
    act(() => vi.advanceTimersByTime(400))
    expect(container.querySelector('.startup-stage')?.getAttribute('data-phase')).toBe('revealing')
    expect(container.querySelector('.startup-content')?.hasAttribute('inert')).toBe(false)
    act(() => vi.advanceTimersByTime(650))
    expect(container.querySelector('.startup-stage')?.getAttribute('data-phase')).toBe('settled')
  })
  it('never hides a slow or failed connection behind an endless animation', () => {
    const { container } = render(<StartupTransition ready={false}><p>Connection recovery</p></StartupTransition>)
    act(() => vi.advanceTimersByTime(1800))
    expect(container.querySelector('.startup-stage')?.getAttribute('data-phase')).toBe('revealing')
    act(() => vi.advanceTimersByTime(650))
    expect(container.querySelector('.startup-stage')?.getAttribute('data-phase')).toBe('settled')
  })
  it('lets the user skip without waiting for readiness', () => {
    const { container } = render(<StartupTransition ready={false}><p>Workspace</p></StartupTransition>)
    fireEvent.click(screen.getByRole('button', { name: 'Skip intro' }))
    expect(container.querySelector('.startup-stage')?.getAttribute('data-phase')).toBe('settled')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('shows no intro when reduced motion is requested', () => {
    reduced = true
    const { container } = render(<StartupTransition ready={false}><p>Workspace</p></StartupTransition>)
    expect(container.querySelector('.startup-stage')?.getAttribute('data-phase')).toBe('settled')
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
