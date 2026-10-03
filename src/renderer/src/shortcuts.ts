// One source for shortcut chords, their platform labels and the Settings list.
// `Mod` is ⌘ on macOS and Ctrl elsewhere.
export const SHORTCUTS = {
  newSession: 'Mod+N', search: 'Mod+K', settings: 'Mod+,', sidebar: 'Mod+B', focusMessage: 'Mod+L',
  terminal: 'Mod+`', browser: 'Mod+Shift+B', review: 'Mod+Shift+G',
  send: 'Enter', newLine: 'Shift+Enter', stop: 'Escape', focusPage: 'F6', closeDialog: 'Escape'
} as const
export type ShortcutId = keyof typeof SHORTCUTS

export const SHORTCUT_LIST: Array<[label: string, id: ShortcutId]> = [
  ['New session', 'newSession'], ['Search & commands', 'search'], ['Settings', 'settings'], ['Toggle sidebar', 'sidebar'],
  ['Focus message', 'focusMessage'], ['Toggle terminal', 'terminal'], ['Toggle browser', 'browser'], ['Review changes', 'review'],
  ['Send message', 'send'], ['New line', 'newLine'], ['Stop the agent', 'stop'], ['Focus the browser page', 'focusPage'], ['Close dialog', 'closeDialog']
]

const MAC: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Enter: '↩', Escape: 'Esc' }
const OTHER: Record<string, string> = { Mod: 'Ctrl', Escape: 'Esc' }

/** Platform label for a chord, e.g. `⌘⇧G` on macOS and `Ctrl+Shift+G` elsewhere. */
export function keyLabel(platform: string, chord: string): string {
  const mac = platform === 'darwin', names = mac ? MAC : OTHER
  return chord.split('+').map(part => names[part] ?? part).join(mac ? '' : '+')
}

/** ARIA `aria-keyshortcuts` value for a chord. */
export function ariaKeys(platform: string, chord: string): string {
  return chord.split('+').map(part => part === 'Mod' ? platform === 'darwin' ? 'Meta' : 'Control' : part).join('+')
}

/** Matches a keydown against a `Mod+…` chord, requiring Shift exactly when listed. */
export function matches(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, chord: string): boolean {
  const parts = chord.split('+'), key = parts.at(-1)!
  if (parts.includes('Mod') !== (event.metaKey || event.ctrlKey) || event.altKey || parts.includes('Shift') !== event.shiftKey) return false
  if (key === '`') return event.code === 'Backquote' || event.key === '`'
  return event.key.toLowerCase() === key.toLowerCase()
}
