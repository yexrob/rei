import { describe, expect, it } from 'vitest'
import type { ToolCallItem } from '../../state/session'
import { boundedLines, parseRecordedDiff, recordedFile } from './recordedFile'

function call(name: string, input: unknown, output?: ToolCallItem['body']['output'], status: ToolCallItem['status'] = 'completed'): ToolCallItem {
  return { id: 'file', status, startedAt: '2026-09-17T00:00:00Z', body: { kind: 'toolCall', callId: 'call', name, input, output } }
}
const diff = '--- a/page.html\n+++ b/page.html\n@@ -3,2 +3,3 @@\n keep\n-old\n+new\n+extra\n'

describe('journal-backed file preview contracts', () => {
  it('uses the canonical applied diff and never fabricates a complete Edit file', () => {
    const record = recordedFile(call('Edit', { file_path: '/work/page.html', old_string: 'old', new_string: 'new' }, { parts: [], display: { kind: 'diff', unified: diff } }))
    expect(record.path).toBe('/work/page.html')
    expect(record.tabs.map((tab) => tab.label)).toEqual(['Recorded diff', 'Match snippet', 'Replacement snippet'])
    expect(record.tabs[0].text).toBe(diff)
    expect(parseRecordedDiff(diff).counts).toEqual({ added: 2, removed: 1 })
    expect(parseRecordedDiff(diff).rows.filter((row) => row.kind === 'addition').map((row) => row.newLine)).toEqual([4, 5])
  })

  it('treats a successful new Write as recorded content, not an invented diff', () => {
    const record = recordedFile(call('Write', { file_path: 'page.html', content: '<script>bad()</script>' }, { parts: [{ type: 'text', text: 'Wrote 22 bytes to page.html' }] }))
    expect(record.tabs.map((tab) => tab.label)).toEqual(['Written content'])
    expect(record.tabs[0].text).toBe('<script>bad()</script>')
  })

  it.each(['pending', 'running', 'failed', 'interrupted'] as const)('does not claim %s input was written', (status) => {
    const record = recordedFile(call('Write', { file_path: 'a', content: 'hello' }, undefined, status))
    expect(record.tabs[0].label).toBe(status === 'pending' || status === 'running' ? 'Requested content' : 'Attempted content')
  })

  it('honors isError over completed item status and missing receipts', () => {
    expect(recordedFile(call('Write', { content: 'hello' }, { parts: [], isError: true })).tabs[0].label).toBe('Attempted content')
    expect(recordedFile(call('Write', { content: 'hello' })).tabs[0].label).toBe('Requested content')
  })

  it('preserves Read window numbers and truncation notes without inventing source', () => {
    const record = recordedFile(call('Read', { file_path: 'C:\\src\\a.ts' }, { parts: [{ type: 'text', text: '    21\tfirst\n    22\t\tsecond\n[truncated: more lines]' }] }))
    expect(record.tabs[0].rows).toEqual([{ text: 'first', number: 21 }, { text: '\tsecond', number: 22 }, { text: '[truncated: more lines]' }])
    expect(record.tabs[0].text).toBe('first\n\tsecond\n[truncated: more lines]')
  })

  it('retains successful empty Read windows as recorded content', () => {
    const record = recordedFile(call('Read', { file_path: 'empty.txt' }, { parts: [{ type: 'text', text: '' }] }))
    expect(record.tabs[0].label).toBe('Recorded read')
    expect(record.tabs[0].text).toBe('')
  })

  it('keeps accurate canonical counts when only long display rows are clipped', () => {
    const result = parseRecordedDiff(`@@ -0,0 +1 @@\n+${'x'.repeat(10_000)}\n`)
    expect(result.counts).toEqual({ added: 1, removed: 0 })
    expect(result.truncated).toBe(true)
    expect(result.rows[1].text.length).toBe(4001)
  })

  it('only allows bounded raster image parts, never SVG or external images', () => {
    const record = recordedFile(call('Read', {}, { parts: [
      { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' },
      { type: 'image', mediaType: 'image/svg+xml', data: 'aGVsbG8=' },
      { type: 'image', mediaType: 'image/png', data: 'https://bad.test/a.png' }
    ] }))
    expect(record.tabs).toHaveLength(1)
    expect(record.tabs[0].image).toBe('data:image/png;base64,aGVsbG8=')
  })

  it('handles malformed payloads and binary text without interpreting either', () => {
    expect(recordedFile(call('Write', '{bad')).tabs).toEqual([])
    expect(recordedFile(call('Write', { content: { bad: true } })).tabs).toEqual([])
    expect(recordedFile(call('Read', {}, { parts: [{ type: 'text', text: '\u0000binary' }] })).tabs).toEqual([])
    expect(recordedFile(call('mcp__files__Write', { content: 'not builtin' })).tabs).toEqual([])
  })

  it('bounds giant lines and many lines while making clipping explicit', () => {
    expect(boundedLines('x'.repeat(200_000)).truncated).toBe(true)
    expect(boundedLines('x'.repeat(200_000)).rows[0].text.length).toBeLessThanOrEqual(4001)
    expect(boundedLines('x\n'.repeat(5000)).rows.length).toBeLessThanOrEqual(1200)
  })

  it('never reports exact counts for malformed, incomplete or oversized diffs', () => {
    for (const value of ['+not a diff', '@@ -1 +1 @@\n-old', '@@ -1 +1 @@\n-old\n+new\n[truncated]', 'x'.repeat(1_100_000)]) {
      expect(parseRecordedDiff(value).counts).toBeUndefined()
    }
    expect(parseRecordedDiff('@@ -1 +1 @@\n---literal\n+++literal\n').counts).toEqual({ added: 1, removed: 1 })
  })
})
