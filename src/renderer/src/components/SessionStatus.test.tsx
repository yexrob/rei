// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionStatus } from './SessionStatus'

afterEach(cleanup)
describe('accessible session status', () => {
  it.each([['ready', 'Ready'], ['working', 'Working'], ['retrying', 'Retrying'], ['waiting', 'Needs attention'], ['failed', 'Failed'], ['disconnected', 'Not connected'], ['connecting', 'Connecting…']])('announces %s once with text rather than color alone', (status, label) => {
    const { container } = render(<SessionStatus status={status} />)
    expect(screen.getByRole('status').textContent).toBe(label)
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
    expect(screen.getByRole('status').getAttribute('aria-atomic')).toBe('true')
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(Boolean(container.querySelector('.spin'))).toBe(['working', 'retrying'].includes(status))
  })
})
