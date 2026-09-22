// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionMetrics } from './SessionMetrics'

afterEach(cleanup)

describe('session usage charts', () => {
  it('plots actual token proportions and context with accessible numeric equivalents', () => {
    render(<SessionMetrics inputTokens={750} outputTokens={250} context={{ used: 1200, window: 4000, trigger: 3200 }} />)
    expect(screen.getByRole('img', { name: '750 in · 250 out' }).querySelector('.metric-input')?.getAttribute('width')).toBe('120')
    expect(screen.getByRole('img', { name: '1,200 of 4,000 context tokens' })).toBeTruthy()
    expect(screen.getByText('30%')).toBeTruthy()
  })
  it('does not invent context or proportions before usage is reported', () => {
    const { container } = render(<SessionMetrics inputTokens={0} outputTokens={0} />)
    expect(screen.queryByText('Context')).toBeNull()
    expect(container.querySelector('.metric-input')?.getAttribute('width')).toBe('0')
    expect(container.querySelector('.metric-output')?.getAttribute('width')).toBe('0')
  })
  it('clamps the drawing, keeps real over-capacity counts and marks a near limit', () => {
    const { container } = render(<SessionMetrics inputTokens={25} outputTokens={75} context={{ used: 5000, window: 4000, trigger: 3200 }} />)
    expect(container.querySelector('.context-arc')?.getAttribute('stroke-dasharray')).toBe('100 100')
    expect(container.querySelector('.context-arc')?.classList.contains('near-limit')).toBe(true)
    expect(screen.getByRole('img', { name: '5,000 of 4,000 context tokens' })).toBeTruthy()
  })
  it('handles unavailable capacity and invalid counts without NaN graphics', () => {
    const { container } = render(<SessionMetrics inputTokens={NaN} outputTokens={-10} context={{ used: 10, window: 0, trigger: 0 }} />)
    expect(screen.getByRole('img', { name: 'Context capacity unavailable' })).toBeTruthy()
    expect(container.innerHTML).not.toContain('NaN')
    expect(container.innerHTML).not.toContain('Infinity')
  })
})
