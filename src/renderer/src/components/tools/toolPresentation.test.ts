import { describe, expect, it } from 'vitest'
import { classifyTool, parseTerminal, resultLines, safeWebUrl, toolState, inputRecord } from './toolPresentation'
import type { ToolCallItem } from '../../state/session'

export function toolFixture(name: string, input: unknown = {}, text?: string): ToolCallItem {
  return { id: 'tool-1', startedAt: '2026-09-17T00:00:00Z', status: 'completed', body: {
    kind: 'toolCall', callId: 'call-1', name, input,
    ...(text == null ? {} : { output: { parts: [{ type: 'text', text }] } })
  } }
}

describe('tool presentation contracts', () => {
  it.each([
    ['Read', 'file'], ['Write', 'file'], ['Edit', 'file'], ['Bash', 'terminal'], ['BashOutput', 'terminal'],
    ['KillShell', 'terminal'], ['Glob', 'search'], ['Grep', 'search'], ['WebFetch', 'web'], ['WebSearch', 'web'],
    ['ShowPage', 'web'], ['SpawnAgent', 'collaboration'], ['SendMessage', 'collaboration'], ['OpenRoom', 'collaboration'],
    ['TaskCreate', 'task'], ['TaskList', 'task'], ['Skill', 'knowledge'], ['ExperienceQuery', 'knowledge'],
    ['ScheduleList', 'schedule'], ['Wake', 'schedule'], ['AskUserQuestion', 'question'],
    ['mcp__fs__Write', 'generic'], ['mcp__Bash__Read', 'generic'], ['ReadFile', 'generic'], ['write', 'generic'],
    ['ExperienceUnknown', 'generic'], ['ScheduleUnknown', 'generic']
  ])('dispatches exact tool %s as %s', (name, family) => expect(classifyTool(name)).toBe(family))

  it('uses tool error payload even when the call completed', () => {
    const item = toolFixture('Bash')
    item.body.output = { parts: [], isError: true }
    expect(toolState(item)).toBe('failed')
    item.status = 'interrupted'
    expect(toolState(item)).toBe('interrupted')
  })

  it('parses only the final canonical terminal receipt, without guessing exit from prose', () => {
    expect(parseTerminal('$ cargo test\nhello\n[Exited with code 7]')).toEqual({ command: 'cargo test', output: 'hello', receipt: '[Exited with code 7]', exit: 7 })
    expect(parseTerminal('$ test\n[Exited with code 0]\nnot a receipt').exit).toBeUndefined()
    expect(parseTerminal('$ test\n[job abc · running · cursor 8]').receipt).toBe('[job abc · running · cursor 8]')
    expect(parseTerminal('completed successfully').exit).toBeUndefined()
  })

  it('keeps Windows paths, colons, and source truncation notices untouched', () => {
    expect(resultLines('C:\\work\\main.ts:12:const url = "https://x"\n[… 9 lines truncated …]')).toEqual([
      'C:\\work\\main.ts:12:const url = "https://x"', '[… 9 lines truncated …]'
    ])
  })

  it('handles malformed inputs and limits URL schemes', () => {
    expect(inputRecord('{not json')).toEqual({})
    expect(inputRecord('{"query":"bingo"}')).toEqual({ query: 'bingo' })
    expect(inputRecord(['query'])).toEqual({})
    expect(safeWebUrl('https://example.com/a')).toBe('https://example.com/a')
    for (const value of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '//example.com']) expect(safeWebUrl(value)).toBeNull()
  })
})
