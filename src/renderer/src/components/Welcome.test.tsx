// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptStarters, WelcomeHeading } from './Welcome'

afterEach(cleanup)

describe('workspace starting points', () => {
  it('offers a quiet introduction without suggesting work has already run', () => {
    render(<WelcomeHeading />)
    expect(screen.getByRole('heading', { name: 'A little space. A lot of possibility.' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('prepares an editable prompt only when a starting point is chosen', () => {
    const onChoose = vi.fn()
    render(<PromptStarters onChoose={onChoose} />)
    expect(onChoose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Understand code' }))
    expect(onChoose).toHaveBeenCalledWith('Help me understand a codebase. Ask me which project or code I want to explore first.')
  })
  it('does not change the draft while sending or unavailable', () => {
    const onChoose = vi.fn()
    render(<PromptStarters onChoose={onChoose} disabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Make a plan' }))
    expect(onChoose).not.toHaveBeenCalled()
  })
})
