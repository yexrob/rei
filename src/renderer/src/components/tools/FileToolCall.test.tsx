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
  it('opens an inert recorded HTML source in one click without expanding diagnostics', () => {
    const html = '<script>window.pwned = true</script><img src="https://bad.test/track">'
    const { container } = render(<FileToolCall {...actions} item={item('Write', { file_path: '/work/site/index.html', content: html }, { parts: [{ type: 'text', text: 'Wrote 77 bytes to /work/site/index.html' }] })} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    const file = screen.getByRole('button', { name: /index.html/ })
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
    fireEvent.click(screen.getByRole('button', { name: /a.ts/ }))
    expect(screen.getByText('+new')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Replacement snippet' }))
    expect(screen.getByText('new')).toBeTruthy()
    expect(screen.getByText(/not a complete file/)).toBeTruthy()
  })

  it('never labels a failed write as written and preserves the error receipt', () => {
    render(<FileToolCall {...actions} item={item('Write', { file_path: 'fail.txt', content: 'requested' }, { isError: true, parts: [{ type: 'text', text: 'permission denied' }] })} />)
    fireEvent.click(screen.getByRole('button', { name: /fail.txt/ }))
    expect(screen.getByText('Attempted content')).toBeTruthy()
    expect(screen.queryByText('Written content')).toBeNull()
  })

  it('offers a raster image preview and no unsafe SVG or filesystem link', () => {
    const { container } = render(<FileToolCall {...actions} item={item('Read', { file_path: 'picture.png' }, { parts: [{ type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' }] })} />)
    expect(screen.getByRole('img', { name: 'picture.png' }).getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=')
    fireEvent.click(screen.getByRole('button', { name: 'Recorded image' }))
    expect(screen.getByRole('img', { name: 'Recorded image' }).getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=')
    expect(container.querySelector('a[href^="file:"]')).toBeNull()
  })

  it('does not offer a fake preview for a pending Read with no journal output', () => {
    render(<FileToolCall {...actions} item={item('Read', { file_path: 'pending.rs' }, undefined, 'running')} />)
    expect(screen.queryByRole('button', { name: /pending.rs/ })).toBeNull()
    expect(screen.getByText('pending.rs')).toBeTruthy()
  })
})
