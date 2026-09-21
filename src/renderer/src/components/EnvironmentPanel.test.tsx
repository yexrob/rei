// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentPanel, summarizeAgents } from './EnvironmentPanel'
import type { Collaborator } from '../state/collaboration'
import { createSessionProjection } from '../state/session'
import { rustInitial } from '../state/fixtures'

const agent = (id: string, status: Collaborator['status'] = 'ready'): Collaborator => ({ id, name: id, kind: 'agent', main: false, status, activity: null })
const completed = (): Collaborator => ({ ...agent('Reviewer'), projection: createSessionProjection({ ...rustInitial, lastTurn: { id: 'done', status: { kind: 'completed' }, startedAt: '2026-09-17T00:00:00Z', endedAt: '2026-09-17T00:00:01Z' } }) })
const entries = [{ ...agent('Bingo', 'working'), main: true }, agent('Planner', 'working'), completed(), { ...agent('#review'), kind: 'room' as const }]
const props = () => ({ open: true, onOpenChange: vi.fn(), entries, activeId: 'Bingo', onSelect: vi.fn(), onReview: vi.fn(), workspaceName: 'bingo', workspacePath: '/projects/bingo', ready: true, canReview: true })

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('environment collaboration surface', () => {
  it('derives subagent counts and never calls an idle standby agent done', () => {
    expect(summarizeAgents([...entries, agent('Standby')])).toEqual({ working: 1, waiting: 0, done: 1, idle: 1, failed: 0 })
    expect(summarizeAgents([{ ...completed(), status: 'working' }]).done).toBe(0)
  })

  it('uses the reference-style subagent summary with separate room navigation', async () => {
    const p = props(); render(<EnvironmentPanel {...p} />)
    await screen.findByRole('dialog', { name: 'Environment' })
    expect(screen.getByText('Subagents')).toBeTruthy()
    expect(screen.getByText('1 working · 1 done')).toBeTruthy()
    expect(screen.getByText('Local')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open room #review' }))
    expect(p.onSelect).toHaveBeenCalledWith('#review')
    expect(p.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens real review via an explicit action without fake Git counts', async () => {
    const p = props(); render(<EnvironmentPanel {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review changes' }))
    expect(p.onReview).toHaveBeenCalledOnce()
    expect(screen.queryByText('+84')).toBeNull()
  })

  it('keeps the live collaborator list accessible by keyboard', async () => {
    render(<EnvironmentPanel {...props()} />)
    const trigger = await screen.findByRole('button', { name: 'Collaborators' })
    fireEvent.focus(trigger)
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Collaborators' })).toBeTruthy())
    expect(screen.getByRole('button', { name: /^Reviewer · Agent/ })).toBeTruthy()
  })
})
