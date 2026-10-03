import { describe, expect, it } from 'vitest'
import { displayPath, truncateMiddle } from './paths'

describe('displayPath', () => {
  const scratch = '/tmp/bingo-desktop-0123456789abcdef01234567'
  it('names the scratch workspace and keeps paths inside it', () => {
    expect(displayPath(scratch, { scratch })).toBe('Personal space')
    expect(displayPath(`${scratch}/notes/a.md`, { scratch, personal: '个人空间' })).toBe('个人空间/notes/a.md')
    expect(displayPath('/private/var/folders/x/T/bingo-desktop-0123456789abcdef01234567/a.txt')).toBe('Personal space/a.txt')
    expect(displayPath(`${scratch}-other/a`, { scratch })).toBe(`${scratch}-other/a`)
  })
  it('abbreviates the home directory only on a segment boundary', () => {
    expect(displayPath('/Users/ada/code/rei', { home: '/Users/ada' })).toBe('~/code/rei')
    expect(displayPath('/Users/ada', { home: '/Users/ada/' })).toBe('~')
    expect(displayPath('/Users/adam/code', { home: '/Users/ada' })).toBe('/Users/adam/code')
    expect(displayPath('C:\\Users\\Ada\\src', { home: 'c:\\users\\ada' })).toBe('~\\src')
    expect(displayPath('/srv/x', { home: '/' })).toBe('/srv/x')
  })
  it('middle-truncates long paths but keeps the file name', () => {
    const path = '/Users/ada/projects/very/deeply/nested/source/tree/component.tsx'
    const short = displayPath(path, { home: '/Users/ada', max: 28 })
    expect(short.length).toBeLessThanOrEqual(28)
    expect(short.startsWith('~/')).toBe(true)
    expect(short.endsWith('/component.tsx')).toBe(true)
    expect(short).toContain('…')
    expect(truncateMiddle('/a/b', 40)).toBe('/a/b')
    expect(truncateMiddle('/a/an-extremely-long-file-name.txt', 12).startsWith('…')).toBe(true)
    expect(truncateMiddle('/a/an-extremely-long-file-name.txt', 12)).toHaveLength(12)
    expect(displayPath('', {})).toBe('')
  })
})
