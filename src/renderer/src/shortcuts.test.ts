import { describe, expect, it } from 'vitest'
import { ariaKeys, keyLabel, matches, SHORTCUTS } from './shortcuts'

const key = (init: Partial<KeyboardEvent>) => ({ key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init })

describe('shortcuts', () => {
  it('labels chords per platform', () => {
    expect(keyLabel('darwin', SHORTCUTS.review)).toBe('⌘⇧G')
    expect(keyLabel('linux', SHORTCUTS.review)).toBe('Ctrl+Shift+G')
    expect(keyLabel('win32', SHORTCUTS.terminal)).toBe('Ctrl+`')
    expect(keyLabel('darwin', SHORTCUTS.stop)).toBe('Esc')
    expect(ariaKeys('darwin', SHORTCUTS.browser)).toBe('Meta+Shift+B')
    expect(ariaKeys('linux', SHORTCUTS.sidebar)).toBe('Control+B')
  })
  it('keeps Shift chords distinct from their unshifted siblings', () => {
    expect(matches(key({ key: 'B', ctrlKey: true, shiftKey: true }), SHORTCUTS.browser)).toBe(true)
    expect(matches(key({ key: 'B', ctrlKey: true, shiftKey: true }), SHORTCUTS.sidebar)).toBe(false)
    expect(matches(key({ key: 'b', metaKey: true }), SHORTCUTS.sidebar)).toBe(true)
    expect(matches(key({ key: 'Dead', code: 'Backquote', ctrlKey: true }), SHORTCUTS.terminal)).toBe(true)
    expect(matches(key({ key: 'g', ctrlKey: true, altKey: true, shiftKey: true }), SHORTCUTS.review)).toBe(false)
  })
})
