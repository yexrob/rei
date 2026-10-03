import { describe, expect, it } from 'vitest'
import { durationBetween, formatSeconds } from './motion'
import { toolVerb } from './tools/toolPresentation'

describe('conversation motion helpers', () => {
  it('formats durations compactly at every scale', () => {
    expect(formatSeconds(0.04)).toBe('<0.1s')
    expect(formatSeconds(0.18)).toBe('0.2s')
    expect(formatSeconds(4.2)).toBe('4.2s')
    expect(formatSeconds(12)).toBe('12s')
    expect(formatSeconds(125)).toBe('2m 05s')
    expect(formatSeconds(3780)).toBe('1h 03m')
  })
  it('measures only well-ordered timestamps', () => {
    expect(durationBetween('2026-09-17T00:00:00Z', '2026-09-17T00:00:04.200Z')).toBe(4.2)
    expect(durationBetween('2026-09-17T00:00:05Z', '2026-09-17T00:00:04Z')).toBeNull()
    expect(durationBetween('2026-09-17T00:00:00Z', null)).toBeNull()
  })
  it('describes live and finished tool work, keeping unknown and MCP names', () => {
    expect(toolVerb('Read', true)).toEqual({ key: 'Reading' })
    expect(toolVerb('Bash', false)).toEqual({ key: 'Ran command' })
    expect(toolVerb('mcp__github__search', true)).toEqual({ key: 'Using {name}', vars: { name: 'github · search' } })
    expect(toolVerb('Custom', false)).toEqual({ key: 'Used {name}', vars: { name: 'Custom' } })
  })
})
