// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { useWorkspace } from '../state/useWorkspace'
import { Settings } from './Settings'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function workspace() {
  return { connection: { status: 'ready', workspace: '/work', binary: '/bin/bingo' }, preferences: { theme: 'system' }, runtimeSelection: { model: 'provider/model', thinking: 'high' }, active: null, catalogs: { providers: { entries: [{ id: 'provider', label: 'Provider', meta: { auth: { kind: 'ready' } } }] } }, savePreferences: vi.fn().mockResolvedValue(undefined), readCatalog: vi.fn().mockResolvedValue({ entries: [] }), runAction: vi.fn().mockResolvedValue(null), report: vi.fn(), setError: vi.fn() } as unknown as ReturnType<typeof useWorkspace>
}
it('preserves native dialog semantics, focus return and real appearance preferences', async () => {
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  const w = workspace(), close = vi.fn()
  const result = render(<Settings workspace={w} onClose={close} openLink={vi.fn()} clearDrafts={vi.fn()} />)
  const dialog = screen.getByRole('dialog', { name: 'Settings' })
  expect(dialog.hasAttribute('open')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
  await waitFor(() => expect(w.savePreferences).toHaveBeenCalledWith({ theme: 'dark' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
  expect(close).toHaveBeenCalledOnce()
  result.unmount()
  expect(document.activeElement).toBe(opener)
  opener.remove()
})
it('clears an optional runtime override before reconnecting through default discovery', async () => {
  const w = workspace()
  w.preferences = { ...w.preferences!, binaryPath: '/custom/bingo' }
  w.connect = vi.fn().mockResolvedValue(undefined)
  render(<Settings workspace={w} onClose={vi.fn()} openLink={vi.fn()} clearDrafts={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Use default runtime' }))
  await waitFor(() => expect(w.connect).toHaveBeenCalledWith('/work'))
  expect(w.savePreferences).toHaveBeenCalledWith({ binaryPath: null })
  expect(vi.mocked(w.savePreferences).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(w.connect).mock.invocationCallOrder[0])
})
it('selects catalog models from the compact primary row', async () => {
  const w = workspace()
  w.catalogs.models = { kind: 'models', entries: [{ id: 'provider/next', label: 'Next model', meta: { provider: 'provider' } }] }
  render(<Settings workspace={w} onClose={vi.fn()} openLink={vi.fn()} clearDrafts={vi.fn()} initialPage="models" />)
  expect(screen.getByText('Custom model').closest('details')?.open).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Model' }))
  fireEvent.click(await screen.findByRole('option', { name: /^Next model\s*provider\/next$/ }))
  await waitFor(() => expect(w.runAction).toHaveBeenCalledWith('model', 'provider/next'))
})
it('clears the old model on provider changes and rejects conflicting qualified identities', async () => {
  const w = workspace()
  w.catalogs.providers?.entries.push({ id: 'other', label: 'Other', meta: { auth: { kind: 'ready' } } })
  render(<Settings workspace={w} onClose={vi.fn()} openLink={vi.fn()} clearDrafts={vi.fn()} initialPage="models" />)
  fireEvent.click(screen.getByText('Custom model'))
  expect(screen.getByLabelText('Provider model ID')).toHaveProperty('value', 'model')
  const trigger = screen.getByRole('combobox', { name: 'Provider' })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter' })
  const choice = await screen.findByRole('option', { name: 'Other' })
  choice.focus()
  fireEvent.keyDown(choice, { key: 'Enter' })
  expect(screen.getByLabelText('Provider model ID')).toHaveProperty('value', '')
  fireEvent.change(screen.getByLabelText('Provider model ID'), { target: { value: 'provider/old-model' } })
  expect(screen.getByRole('button', { name: 'Use this model' })).toHaveProperty('disabled', true)
  expect(w.runAction).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Provider model ID'), { target: { value: 'family/new-model' } })
  fireEvent.click(screen.getByRole('button', { name: 'Use this model' }))
  await waitFor(() => expect(w.runAction).toHaveBeenCalledWith('model', 'other/family/new-model'))
})
it('keeps model changes on canonical actions and credentials out of conversations', async () => {
  const w = workspace()
  render(<Settings workspace={w} onClose={vi.fn()} openLink={vi.fn()} clearDrafts={vi.fn()} initialPage="models" />)
  expect(screen.getByText('Ready')).toBeTruthy()
  expect(screen.getByText(/Credentials stay in bingo’s credential store/)).toBeTruthy()
  fireEvent.click(screen.getByText('Custom model'))
  fireEvent.change(screen.getByLabelText('Provider model ID'), { target: { value: 'provider/new-model' } })
  fireEvent.click(screen.getByRole('button', { name: 'Use this model' }))
  await waitFor(() => expect(w.runAction).toHaveBeenCalledWith('model', 'provider/new-model'))
  fireEvent.click(screen.getByRole('button', { name: 'Add API provider' }))
  expect(screen.getByLabelText('API key')).toHaveProperty('type', 'password')
  expect(w.runAction).toHaveBeenCalledTimes(1)
})
