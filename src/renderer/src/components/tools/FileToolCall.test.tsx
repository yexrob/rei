// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ToolCallItem } from '../../state/session'
import { FileToolCall } from './FileToolCall'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(cleanup)
const actions = { openLink: vi.fn(), runAction: vi.fn() }
function item(name: string, input: unknown, output?: ToolCallItem['body']['output'], status: ToolCallItem['status'] = 'completed'): ToolCallItem {
  return { id: 'file', status, startedAt: '2026-09-17T00:00:00Z', body: { kind: 'toolCall', callId: 'call', name, input, output } }
}

describe('file tool interactions', () => {
  it('opens Read inline from the filename and reports returned lines rather than the requested range', () => {
    const { container } = render(<FileToolCall {...actions} item={item('Read', JSON.stringify({ file_path: '/work/a.rs', offset: 40, limit: 100 }), { parts: [{ type: 'text', text: '    40\tfirst\n    41\tsecond\n[truncated]' }] })} />)
    fireEvent.click(screen.getByText('a.rs'))
    expect(screen.getByText('first')).toBeTruthy()
    expect(screen.getByText('second')).toBeTruthy()
    expect(screen.getByText('Recorded lines 40–41')).toBeTruthy()
    expect(screen.getByText('[truncated]')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.querySelector('button button, .tool-card-disclosure')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Hide tool details: Read · /work/a.rs' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Preview a.rs' }))
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })
  it('shows attempted Write content inline and keeps empty content explicit', () => {
    const { rerender } = render(<FileToolCall {...actions} item={item('Write', { file_path: 'fail.txt', content: 'attempted' }, { isError: true, parts: [{ type: 'text', text: 'Permission denied' }] })} />)
    expect(screen.getByText('Permission denied')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Show tool details:/ }))
    expect(screen.getByText('Attempted content')).toBeTruthy()
    expect(screen.getByText('attempted')).toBeTruthy()
    expect(screen.queryByText('Written content')).toBeNull()
    rerender(<FileToolCall {...actions} item={item('Read', { file_path: 'empty.txt' }, { parts: [{ type: 'text', text: '' }] })} />)
    expect(screen.getByText('Empty recorded content.')).toBeTruthy()
    expect(screen.queryByText(/Recorded lines/)).toBeNull()
  })
  it('opens an inert recorded HTML source in one click without expanding diagnostics', () => {
    const html = '<script>window.pwned = true</script><img src="https://bad.test/track">'
    const { container } = render(<FileToolCall {...actions} item={item('Write', { file_path: '/work/site/index.html', content: html }, { parts: [{ type: 'text', text: 'Wrote 77 bytes to /work/site/index.html' }] })} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    const file = screen.getByRole('button', { name: 'Preview index.html' })
    file.focus()
    fireEvent.click(file)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Written content')).toBeTruthy()
    expect(screen.getByText(html)).toBeTruthy()
    expect(container.querySelector('script, img, iframe, object, svg script')).toBeNull()
    expect(screen.getByText(/not the current file on disk/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(file)
    expect(container.querySelector('button button')).toBeNull()
  })

  it('shows canonical diff counts and lets people switch to requested snippets', () => {
    render(<FileToolCall {...actions} item={item('Edit', { file_path: 'a.ts', old_string: 'old', new_string: 'new' }, { parts: [], display: { kind: 'diff', unified: '--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new\n' } })} />)
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('−1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview a.ts' }))
    expect(screen.getByText('+new')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Replacement snippet' }))
    expect(screen.getByText('new')).toBeTruthy()
    expect(screen.getByText(/not a complete file/)).toBeTruthy()
  })

  it('never labels a failed write as written and preserves the error receipt', () => {
    render(<FileToolCall {...actions} item={item('Write', { file_path: 'fail.txt', content: 'requested' }, { isError: true, parts: [{ type: 'text', text: 'permission denied' }] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview fail.txt' }))
    expect(screen.getByText('Attempted content')).toBeTruthy()
    expect(screen.queryByText('Written content')).toBeNull()
  })

  it('offers a raster image preview and no unsafe SVG or filesystem link', () => {
    const { container } = render(<FileToolCall {...actions} item={item('Read', { file_path: 'picture.png' }, { parts: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' }] })} />)
    expect(screen.queryByRole('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Preview picture.png' }))
    expect(screen.getByRole('img', { name: 'Recorded image' }).getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=')
    expect(container.querySelector('a[href^="file:"]')).toBeNull()
  })

  it('does not offer a fake preview for a pending Read with no journal output', () => {
    render(<FileToolCall {...actions} item={item('Read', { file_path: 'pending.rs' }, undefined, 'running')} />)
    expect(screen.queryByRole('button', { name: 'Preview pending.rs' })).toBeNull()
    expect(screen.getByText('pending.rs')).toBeTruthy()
  })
})
