// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { useWorkspace } from '../state/useWorkspace'
import { SkillsPage } from './SkillsPage'

afterEach(cleanup)
const skill = { id: 'project-review', label: 'Review the current project.', meta: { family: 'skill', hint: 'Review the current project.' } }
function workspace(overrides: object = {}) {
  return { connection: { status: 'ready', connectionId: 'c1' }, catalogs: { commands: { kind: 'commands', entries: [skill] } }, readCatalog: vi.fn().mockResolvedValue({ kind: 'commands', entries: [skill] }), ...overrides } as unknown as ReturnType<typeof useWorkspace>
}
it('reads the real catalog and prepares a skill without submitting it', async () => {
  const w = workspace(), compose = vi.fn()
  render(<SkillsPage workspace={w} onCompose={compose} openLink={vi.fn()} />)
  await waitFor(() => expect(w.readCatalog).toHaveBeenCalledWith('commands'))
  fireEvent.click(await screen.findByRole('button', { name: 'Use project-review' }))
  expect(compose).toHaveBeenCalledWith('/project-review ')
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'nothing' } })
  expect(screen.getByText('No matching skills.')).toBeTruthy()
})
it('uses only runtime skill-family commands and preserves canonical command identities', async () => {
  const commands = { kind: 'commands', entries: [{ id: 'guide', label: 'Read the product guide', meta: { name: 'guide', family: 'skill', hint: 'Read the product guide' } }, { id: 'schedule', label: 'Schedules', meta: { family: 'schedule' } }] }
  const readCatalog = vi.fn().mockResolvedValue(commands)
  const compose = vi.fn()
  render(<SkillsPage workspace={workspace({ readCatalog, catalogs: { commands } })} onCompose={compose} openLink={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Use guide' }))
  expect(compose).toHaveBeenCalledWith('/guide ')
  expect(readCatalog).toHaveBeenCalledExactlyOnceWith('commands')
  expect(screen.queryByRole('button', { name: 'Use schedule' })).toBeNull()
})
it('distinguishes disconnected, empty, and failed catalog reads', async () => {
  const { unmount } = render(<SkillsPage workspace={workspace({ connection: { status: 'disconnected' } })} onCompose={vi.fn()} openLink={vi.fn()} />)
  expect(screen.getByText('Connect to bingo to discover skills.')).toBeTruthy()
  unmount()
  const empty = workspace({ catalogs: {}, readCatalog: vi.fn().mockResolvedValue({ kind: 'commands', entries: [] }) })
  const second = render(<SkillsPage workspace={empty} onCompose={vi.fn()} openLink={vi.fn()} />)
  expect(await screen.findByText('No skills are available.')).toBeTruthy()
  second.unmount()
  render(<SkillsPage workspace={workspace({ readCatalog: vi.fn().mockRejectedValue(new Error('Catalog unavailable')) })} onCompose={vi.fn()} openLink={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Catalog unavailable'))
  expect(screen.queryByRole('button', { name: 'Use project-review' })).toBeNull()
})
