// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownDiagram } from './MarkdownDiagram'
import * as diagram from './diagram'

const node = (code: string, loading = false) => ({ type: 'code_block' as const, language: 'mermaid', raw: code, code, loading })
const svg = (name: string) => `<svg xmlns="http://www.w3.org/2000/svg"><text>${name}</text></svg>`
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('async diagram lifecycle', () => {
  it('never submits partial nodes and falls back to preserved source on render failure', async () => {
    const renderDiagram = vi.spyOn(diagram, 'renderDiagram').mockRejectedValue(new Error('bad source'))
    const { rerender } = render(<MarkdownDiagram node={node('graph TD; A-->', true)} />)
    expect(renderDiagram).not.toHaveBeenCalled()
    await act(async () => rerender(<MarkdownDiagram node={node('graph TD; A-->')} />))
    expect(screen.getByText('Diagram preview unavailable. Source is preserved below.')).toBeTruthy()
    expect(screen.getByText('graph TD; A-->')).toBeTruthy()
  })
  it('ignores late results after replacement and unmount', async () => {
    const resolvers: ((value: string) => void)[] = []
    vi.spyOn(diagram, 'renderDiagram').mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)))
    const { rerender, unmount } = render(<MarkdownDiagram node={node('graph TD; A-->B')} />)
    rerender(<MarkdownDiagram node={node('graph TD; C-->D')} />)
    await act(async () => resolvers[1](svg('current')))
    expect(decodeURIComponent(screen.getByRole('img').getAttribute('src') ?? '')).toContain('current')
    await act(async () => resolvers[0](svg('stale')))
    expect(decodeURIComponent(screen.getByRole('img').getAttribute('src') ?? '')).not.toContain('stale')
    rerender(<MarkdownDiagram node={node('graph TD; E-->F')} />)
    unmount()
    await act(async () => resolvers[2](svg('unmounted')))
    expect(screen.queryByRole('img')).toBeNull()
  })
})
