// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ModelPicker } from './Picker'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('filters provider names without fuzzy matches across unrelated repeated keywords', async () => {
  const change = vi.fn()
  render(<ModelPicker value="" models={[
    { id: 'anthropic/claude-opus-5', label: 'claude-opus-5', meta: { provider: 'anthropic' } },
    { id: 'Road-anti/gpt-test', label: 'gpt-test', meta: { provider: 'Road-anti' } }
  ]} onValueChange={change} />)
  fireEvent.click(screen.getByRole('button', { name: 'Model' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Search models' }), { target: { value: 'road-ANTI' } })
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
  fireEvent.click(screen.getByRole('option'))
  expect(change).toHaveBeenCalledWith('Road-anti/gpt-test')
})
