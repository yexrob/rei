// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { WorkingIndicator } from './WorkingIndicator'

afterEach(cleanup)

it('announces processing once while the beam stays decorative', () => {
  const { container } = render(<WorkingIndicator />)
  expect(screen.getByRole('status').textContent).toBe('Working…')
  expect(screen.getAllByText('Working…')).toHaveLength(1)
  expect(container.querySelector('.beam-shimmer')?.getAttribute('aria-hidden')).toBe('true')
  expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
})

it('shows actual retry state without claiming a fabricated completion percentage', () => {
  render(<WorkingIndicator retrying={{ attempt: 2, max: 4 }} />)
  expect(screen.getByRole('status').textContent).toBe('Retrying · attempt 2 of 4')
  expect(screen.queryByRole('progressbar')).toBeNull()
})
