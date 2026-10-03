// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WelcomeHeading, WelcomeHero, WelcomeSuggestions } from './Welcome'

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

describe('new-conversation hero', () => {
  it('names the workspace and lets the person choose another folder', () => {
    const choose = vi.fn()
    render(<WelcomeHero workspaceName="rei" workspacePath="/work/rei" chooseProject={choose} />)
    const chip = screen.getByRole('button', { name: 'Workspace: rei. Choose another folder' })
    expect(chip.getAttribute('title')).toBe('/work/rei')
    fireEvent.click(chip)
    expect(choose).toHaveBeenCalledOnce()
  })
  it('offers suggestions that fill a prompt and up to the given recent conversations', () => {
    const fill = vi.fn(), open = vi.fn()
    render(<WelcomeSuggestions onSuggestion={fill} recent={[{ key: 'a', title: 'Fix login', when: '2 hr. ago', open }]} />)
    const suggestions = screen.getByRole('group', { name: 'Suggestions' })
    expect(within(suggestions).getAllByRole('button').map(button => button.textContent)).toEqual(['Explain this project', 'Find and fix a bug', 'Write tests for…', 'Review my changes'])
    fireEvent.click(within(suggestions).getByRole('button', { name: 'Write tests for…' }))
    expect(fill).toHaveBeenCalledWith('Write tests for ')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Recent conversations' })).getByRole('button', { name: /Fix login/ }))
    expect(open).toHaveBeenCalledOnce()
  })
})
