// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WelcomeHeading } from './Welcome'

afterEach(cleanup)

describe('new-thread heading', () => {
  it('shows a compact invitation with no generic task shortcuts or claimed activity', () => {
    render(<WelcomeHeading />)
    expect(screen.getByRole('heading', { name: 'What would you like to work on?' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })
})
