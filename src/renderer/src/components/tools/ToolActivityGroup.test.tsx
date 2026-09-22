// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '../../../../shared/rpc'
import type { ToolCallItem } from '../../state/session'
import { groupTimelineItems, ToolActivityGroup } from './ToolActivityGroup'
import { ToolCallCard } from './ToolCallCard'

afterEach(cleanup)
export function activityFixture(id: string, status: ToolCallItem['status'] = 'completed', turn = 'turn-a'): ToolCallItem {
  return { id, turn, status, startedAt: '', body: { kind: 'toolCall', name: 'Bash', callId: id, input: { command: `echo ${id}` }, ...(status === 'completed' ? { output: { parts: [{ type: 'text' as const, text: `$ echo ${id}\n${id}\n[Exited with code 0]` }] } } : {}) } }
}
const renderTool = (item: ToolCallItem) => <ToolCallCard item={item} openLink={vi.fn()} runAction={vi.fn()} />

describe('Timeline activity contract', () => {
  it('groups adjacent tools in one turn and preserves all other boundaries', () => {
    const notice: Item = { id: 'notice', status: 'completed', startedAt: '', body: { kind: 'notice', level: 'info', code: 'fixture', text: 'boundary' } }
    const entries = groupTimelineItems([activityFixture('a'), activityFixture('b'), notice, activityFixture('c'), activityFixture('d', 'completed', 'turn-b')])
    expect(entries.map(entry => [entry.kind, entry.key])).toEqual([['tools', 'a'], ['item', 'notice'], ['tools', 'c'], ['tools', 'd']])
    expect(entries[0].kind === 'tools' && entries[0].items.map(item => item.id)).toEqual(['a', 'b'])
    expect(groupTimelineItems([activityFixture('a')])[0].key).toBe(entries[0].key)
  })
  it('collapses successful history without hiding failure or stale running states', () => {
    const { rerender, container } = render(<ToolActivityGroup items={[activityFixture('a'), activityFixture('b')]} connected renderTool={renderTool} />)
    expect(screen.getByRole('button', { name: 'Show tool activity' }).getAttribute('aria-expanded')).toBe('false')
    rerender(<ToolActivityGroup items={[activityFixture('a'), activityFixture('b', 'failed'), activityFixture('c', 'running')]} connected={false} renderTool={renderTool} />)
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(container.querySelector('[data-tool-name="Bash"].tool-card--running .tool-state-spin')).toBeNull()
    expect(screen.getAllByText('Disconnected').length).toBeGreaterThan(0)
  })
  it('compacts an untouched streaming run only after every tool succeeds', () => {
    const { rerender } = render(<ToolActivityGroup items={[activityFixture('a', 'running')]} connected renderTool={renderTool} />)
    expect(screen.queryByRole('button', { name: /tool activity/ })).toBeNull()
    rerender(<ToolActivityGroup items={[activityFixture('a'), activityFixture('b', 'running')]} connected renderTool={renderTool} />)
    expect(screen.getByRole('button', { name: 'Hide tool activity' })).toBeTruthy()
    rerender(<ToolActivityGroup items={[activityFixture('a'), activityFixture('b')]} connected renderTool={renderTool} />)
    expect(screen.getByRole('button', { name: 'Show tool activity' }).getAttribute('aria-expanded')).toBe('false')
  })
  it('does not compact an inspected streaming run when all tools succeed', () => {
    const { rerender } = render(<ToolActivityGroup items={[activityFixture('a', 'running')]} connected renderTool={renderTool} />)
    fireEvent.click(screen.getByRole('button', { name: /^Show tool details:/ }))
    rerender(<ToolActivityGroup items={[activityFixture('a'), activityFixture('b')]} connected renderTool={renderTool} />)
    expect(screen.getByRole('button', { name: 'Hide tool activity' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /^Hide tool details:/ })).toBeTruthy()
  })
  it('preserves text selection and copy while another tool finishes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const first = activityFixture('a')
    const { rerender, container } = render(<ToolActivityGroup items={[first, activityFixture('b', 'running')]} connected renderTool={renderTool} />)
    fireEvent.click(screen.getAllByRole('button', { name: /^Show tool details:/ })[0])
    const source = container.querySelector('.tool-recorded-text pre')!
    fireEvent.pointerDown(source)
    const range = document.createRange()
    range.selectNodeContents(source)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy recorded output' })))
    rerender(<ToolActivityGroup items={[first, activityFixture('b')]} connected renderTool={renderTool} />)
    expect(screen.getByRole('button', { name: 'Hide tool activity' }).getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.tool-recorded-text pre')).toBe(source)
    expect(window.getSelection()!.toString()).toBe('a')
    expect(writeText).toHaveBeenCalledWith('a')
  })
  it('pins keyboard-focused rows before they complete', () => {
    const { rerender } = render(<ToolActivityGroup items={[activityFixture('a', 'running')]} connected renderTool={renderTool} />)
    fireEvent.focus(screen.getByRole('button', { name: /^Show tool details:/ }))
    rerender(<ToolActivityGroup items={[activityFixture('a'), activityFixture('b')]} connected renderTool={renderTool} />)
    expect(screen.getByRole('button', { name: 'Hide tool activity' })).toBeTruthy()
  })
  it('keeps the same mounted and expanded row when the run grows, collapses, and reopens', () => {
    const first = activityFixture('a')
    const { rerender } = render(<ToolActivityGroup items={[first]} connected renderTool={renderTool} />)
    expect(screen.queryByRole('button', { name: /tool activity/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Show tool details:/ }))
    const row = screen.getByRole('button', { name: /^Hide tool details:/ })
    row.focus()
    rerender(<ToolActivityGroup items={[first, activityFixture('b')]} connected renderTool={renderTool} />)
    expect(screen.getByRole('button', { name: /^Hide tool details:/ })).toBe(row)
    expect(document.activeElement).toBe(row)
    fireEvent.click(screen.getByRole('button', { name: 'Hide tool activity' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show tool activity' }))
    expect(screen.getByRole('button', { name: /^Hide tool details:/ })).toBe(row)
  })
})
