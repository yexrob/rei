import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalView, TerminalViewHandlers } from './terminal-controller'

function applyTheme(term: Terminal): void {
  const style = getComputedStyle(document.documentElement)
  term.options.theme = {
    background: style.getPropertyValue('--surface').trim() || '#ffffff',
    foreground: style.getPropertyValue('--text').trim() || '#282a25',
    cursor: style.getPropertyValue('--accent').trim() || '#405c4c',
    selectionBackground: style.getPropertyValue('--selected').trim() || '#e2e5de'
  }
}

function fitTerminal(term: Terminal, addon: FitAddon, element: HTMLElement, resize: TerminalViewHandlers['resize']): void {
  if (element.hidden || !element.clientWidth || !element.clientHeight) return
  const proposed = addon.proposeDimensions()
  if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return
  const cols = Math.max(2, Math.min(500, proposed.cols)), rows = Math.max(1, Math.min(300, proposed.rows))
  if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows)
  resize(cols, rows)
}

function observeSize(term: Terminal, addon: FitAddon, element: HTMLElement, resize: TerminalViewHandlers['resize']): { fit(): void; dispose(): void } {
  let frame = 0
  const fit = (): void => fitTerminal(term, addon, element, resize)
  const queue = (): void => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; fit() }) }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(queue)
  observer?.observe(element)
  window.addEventListener('resize', queue)
  return { fit, dispose: () => { observer?.disconnect(); window.removeEventListener('resize', queue); if (frame) cancelAnimationFrame(frame) } }
}

function terminalHost(parent: HTMLElement, id: string): HTMLDivElement {
  const element = document.createElement('div')
  element.className = 'terminal-host'
  element.id = `terminal-content-${id}`
  element.setAttribute('role', 'tabpanel')
  element.setAttribute('aria-labelledby', `terminal-tab-${id}`)
  element.hidden = true
  parent.append(element)
  return element
}

export function createTerminalView(parent: HTMLElement, id: string, handlers: TerminalViewHandlers, inputLabel: string): TerminalView {
  const element = terminalHost(parent, id)
  const term = new Terminal({ fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', fontSize: 12, lineHeight: 1.25, cursorBlink: false, scrollback: 3000, screenReaderMode: true, allowProposedApi: false })
  const addon = new FitAddon()
  term.loadAddon(addon)
  term.open(element)
  term.textarea?.setAttribute('aria-label', inputLabel)
  applyTheme(term)
  const theme = new MutationObserver(() => applyTheme(term))
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
  const size = observeSize(term, addon, element, handlers.resize)
  const input = term.onData(handlers.input)
  // F6 leaves the shell; Tab, Ctrl+C and paste remain shell-owned shortcuts.
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || event.key !== 'F6') return true
    event.preventDefault()
    element.closest('section')?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus()
    return false
  })
  return {
    write: (data, consumed) => term.write(data, consumed),
    activate: (active) => { element.hidden = !active; if (active) size.fit() },
    focus: () => term.focus(),
    dispose: () => { size.dispose(); theme.disconnect(); input.dispose(); term.dispose(); element.remove() }
  }
}
