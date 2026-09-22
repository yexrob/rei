// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { useWorkspace } from '../state/useWorkspace'
import { AutomationsPage } from './AutomationsPage'

afterEach(cleanup)
function workspace(overrides: object = {}) {
  return { connection: { status: 'ready', connectionId: 'c1' }, catalogs: { commands: { kind: 'commands', entries: [{ id: 'schedule', label: '/schedule' }] } }, readCatalog: vi.fn().mockResolvedValue({ kind: 'commands', entries: [{ id: 'schedule', label: '/schedule' }] }), runActionView: vi.fn().mockResolvedValue({ kind: 'stack', children: [{ kind: 'text', text: 'no schedules yet' }, { kind: 'text', text: 'schedules: dormant — no runner holds this store' }] }), ...overrides } as unknown as ReturnType<typeof useWorkspace>
}
it('renders the actual schedule view, including empty and runner status', async () => {
  const w = workspace()
  render(<AutomationsPage workspace={w} openLink={vi.fn()} onCompose={vi.fn()} />)
  expect(await screen.findByText('no schedules yet')).toBeTruthy()
  expect(screen.getByText('schedules: dormant — no runner holds this store')).toBeTruthy()
  expect(w.runActionView).toHaveBeenCalledWith('schedule')
})
it('only prepares an automation draft after explicit form submission', async () => {
  const compose = vi.fn(), w = workspace()
  render(<AutomationsPage workspace={w} openLink={vi.fn()} onCompose={compose} />)
  await screen.findByText('no schedules yet')
  const toggle = screen.getByRole('button', { name: 'New automation' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  fireEvent.change(screen.getByLabelText('When'), { target: { value: 'daily at 09:00' } })
  fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Check test failures' } })
  expect(compose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare draft' }))
  expect(compose).toHaveBeenCalledWith(expect.stringContaining('daily at 09:00'))
  expect(compose).toHaveBeenCalledWith(expect.stringContaining('Check test failures'))
  expect(w.runActionView).toHaveBeenCalledTimes(1)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByLabelText('When')).toBeNull()
})
it('does not invent schedules when the command is unavailable or fails', async () => {
  const first = render(<AutomationsPage workspace={workspace({ readCatalog: vi.fn().mockResolvedValue({ kind: 'commands', entries: [] }) })} openLink={vi.fn()} onCompose={vi.fn()} />)
  expect(await screen.findByText('This runtime does not provide the /schedule command.')).toBeTruthy()
  first.unmount()
  render(<AutomationsPage workspace={workspace({ runActionView: vi.fn().mockRejectedValue(new Error('Read failed')) })} openLink={vi.fn()} onCompose={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Read failed'))
  expect(screen.queryByText('no schedules yet')).toBeNull()
})
