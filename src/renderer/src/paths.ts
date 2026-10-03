import { useCallback } from 'react'
import { useI18n } from './i18n'

// Presentation-only path formatting. Never feed the result back into an
// operation: it is localized, abbreviated and possibly truncated.
export type DisplayPathOptions = {
  /** The desktop scratch workspace (bootstrap.scratchWorkspace). */
  scratch?: string | null
  /** The user's home directory, replaced with `~`. */
  home?: string | null
  /** Localized label for the scratch workspace. */
  personal?: string
  /** Maximum visible characters before middle truncation; 0 disables it. */
  max?: number
}

const SCRATCH = /^(.*?[\\/])?bingo-desktop-[0-9a-f]{8,64}(?=$|[\\/])/i
const trim = (path: string) => path.length > 1 ? path.replace(/[\\/]+$/, '') || path : path

function within(path: string, root: string): string | null {
  const base = trim(root), windows = /^[a-z]:[\\/]|^\\\\/i.test(base)
  const [a, b] = windows ? [path.toLowerCase(), base.toLowerCase()] : [path, base]
  if (a === b) return ''
  return a.startsWith(b) && /[\\/]/.test(path.charAt(base.length)) ? path.slice(base.length) : null
}

/** Middle-truncates a path, always keeping its final segment (the file name). */
export function truncateMiddle(path: string, max: number): string {
  if (!max || path.length <= max) return path
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const parts = path.split(/[\\/]/), name = parts.at(-1) ?? path
  if (name.length + 2 >= max) return `…${name.slice(-(max - 1))}`
  let head = '', index = 0
  const budget = max - name.length - 2
  while (index < parts.length - 1) {
    const next = head + parts[index] + separator
    if (next.length > budget) break
    head = next; index += 1
  }
  if (!head) head = path.slice(0, Math.max(1, budget))
  return `${head}…${separator}${name}`
}

/** Formats a path for display: Personal space, `~` for home, middle truncation. */
export function displayPath(path: string | null | undefined, { scratch, home, personal = 'Personal space', max = 0 }: DisplayPathOptions = {}): string {
  if (!path) return ''
  let value = path
  const inScratch = scratch ? within(path, scratch) : null
  const match = inScratch === null ? SCRATCH.exec(path) : null
  if (inScratch !== null) value = personal + inScratch
  else if (match) value = personal + path.slice(match[0].length)
  else if (home && trim(home).length > 1) {
    const rest = within(path, home)
    if (rest !== null) value = `~${rest}`
  }
  return truncateMiddle(value, max)
}

// The foreground scratch path arrives with the desktop bootstrap; components
// deep in the tree (terminal, tool cards) read it here instead of via props.
let knownScratch: string | null = null
export function configurePaths({ scratch }: { scratch?: string | null }): void { knownScratch = scratch ?? null }
export function homeDirectory(): string | null {
  const home = typeof window === 'undefined' ? null : window.bingoDesktop?.homeDirectory
  return typeof home === 'string' && home ? home : null
}
/** Localized `displayPath` bound to the current scratch workspace and home directory. */
export function useDisplayPath(): (path: string | null | undefined, max?: number) => string {
  const { t } = useI18n()
  return useCallback((path: string | null | undefined, max = 0) => displayPath(path, { scratch: knownScratch, home: homeDirectory(), personal: t('Personal space'), max }), [t])
}
