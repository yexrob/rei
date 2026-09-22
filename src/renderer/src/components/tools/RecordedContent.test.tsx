// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolCallItem } from '../../state/session'
import { ToolCallCard } from './ToolCallCard'

const actions = { openLink: vi.fn(), runAction: vi.fn() }
afterEach(cleanup)
function fixture(name: string, input: unknown, text: string): ToolCallItem {
  return { id: 'recorded', status: 'completed', startedAt: '', body: { kind: 'toolCall', callId: 'recorded', name, input, output: { parts: [{ type: 'text', text }] } } }
}
function expectKeyboardRegion(element: HTMLElement, label: string) {
  expect(element.getAttribute('role')).toBe('region')
  expect(element.getAttribute('aria-label')).toBe(label)
  expect(element.tabIndex).toBe(0)
  element.focus()
  expect(document.activeElement).toBe(element)
}

describe('recorded content keyboard access', () => {
  it.each([1, 150])('keeps a %i-line Read named, focusable, and intact', count => {
    const text = Array.from({ length: count }, (_, i) => `${i + 40}\tline ${i + 40}`).join('\n')
    const { container } = render(<ToolCallCard item={fixture('Read', { file_path: 'file.ts', offset: 40, limit: count }, text)} {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: /^Show tool details:/ }))
    const source = screen.getByRole('region', { name: 'Recorded read' })
    expectKeyboardRegion(source, 'Recorded read')
    expect(container.querySelectorAll('.recorded-line')).toHaveLength(count)
    expect(source.textContent).toContain(`line ${count + 39}`)
  })

  it.each([1, 150])('keeps a %i-line canonical diff named, focusable, and intact', count => {
    const rows = Array.from({ length: count }, (_, i) => `-old ${i}\n+new ${i}`).join('\n')
    const item = fixture('Edit', { file_path: 'file.ts', old_string: 'old', new_string: 'new' }, '')
    item.body.output!.display = { kind: 'diff', unified: `--- file.ts\n+++ file.ts\n@@ -1,${count} +1,${count} @@\n${rows}\n` }
    const { container } = render(<ToolCallCard item={item} {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: /^Show tool details:/ }))
    const diff = screen.getByRole('region', { name: 'Recorded diff' })
    expectKeyboardRegion(diff, 'Recorded diff')
    expect(container.querySelectorAll('.recorded-line.addition')).toHaveLength(count)
    expect(diff.textContent).toContain(`+new ${count - 1}`)
  })

  it('makes the actual long stdout scroll container focusable, not merely its sibling copy action', () => {
    const stdout = Array.from({ length: 150 }, (_, i) => `stdout ${i}`).join('\n')
    const { container } = render(<ToolCallCard item={fixture('Bash', { command: 'run' }, `$ run\n${stdout}\n[Exited with code 0]`)} {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: /^Show tool details:/ }))
    const pre = container.querySelector<HTMLElement>('.tool-recorded-text pre')!
    expectKeyboardRegion(pre, 'Recorded result')
    expect(pre.textContent).toBe(stdout)
    expect(screen.getByText('Exit 0')).toBeTruthy()
  })

  it('keeps the bounded JSON preview lazy and keyboard-scrollable without an internal copy button', () => {
    const text = JSON.stringify({ rows: 'x'.repeat(100000) })
    const { container } = render(<ToolCallCard item={fixture('mcp__server__report', {}, text)} {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: /^Show tool details:/ }))
    expect(container.querySelector('.tool-recorded-text pre')).toBeNull()
    fireEvent.click(screen.getByText('Inspect recorded content'))
    fireEvent(container.querySelector('.tool-structured-fallback details')!, new Event('toggle'))
    const pre = container.querySelector<HTMLElement>('.tool-recorded-text pre')!
    expectKeyboardRegion(pre, 'Recorded result')
    expect(pre.textContent).toBe(text.slice(0, 64000))
    expect(screen.getByText('Preview limited to 64000 characters. Copy preserves the recorded text.')).toBeTruthy()
    expect(container.querySelector('.tool-structured-fallback details button')).toBeNull()
  })
})
