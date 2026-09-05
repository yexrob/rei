import { useEffect, useRef, useState } from 'react'
import { RotateCw, Square, TerminalSquare, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalState } from '../../../shared/panels'
import { useI18n } from '../i18n'
import { IconButton } from './primitives'
import '@xterm/xterm/css/xterm.css'
import './panels.css'

const initial: TerminalState = { id: null, status: 'idle', cwd: null, exitCode: null, error: null }
export function TerminalPanel({ visible, onClose }: { visible: boolean; onClose(): void }): React.JSX.Element {
  const { t } = useI18n()
  const [state, setState] = useState<TerminalState>(initial)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<(() => void) | null>(null)
  const current = useRef(state)
  const automaticAttempted = useRef(false)
  const alive = useRef(true)
  const update = (next: TerminalState): void => {
    if (next.id !== current.current.id) terminal.current?.reset()
    current.current = next
    setState(next)
  }
  useEffect(() => {
    alive.current = true
    const api = window.bingoPanels, element = host.current
    if (!api || !element) return
    const term = new Terminal({ fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', fontSize: 12, lineHeight: 1.25, cursorBlink: false, scrollback: 3000, screenReaderMode: true, allowProposedApi: false })
    const addon = new FitAddon()
    term.loadAddon(addon)
    term.open(element)
    terminal.current = term
    const setTheme = (): void => {
      const style = getComputedStyle(document.documentElement)
      term.options.theme = { background: style.getPropertyValue('--surface').trim() || '#ffffff', foreground: style.getPropertyValue('--text').trim() || '#282a25', cursor: style.getPropertyValue('--accent').trim() || '#405c4c', selectionBackground: style.getPropertyValue('--selected').trim() || '#e2e5de' }
    }
    setTheme()
    const theme = new MutationObserver(setTheme)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    const resize = (): void => {
      if (!element.clientWidth || !element.clientHeight) return
      const proposed = addon.proposeDimensions()
      if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return
      const cols = Math.max(2, Math.min(500, proposed.cols)), rows = Math.max(1, Math.min(300, proposed.rows))
      if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows)
      const id = current.current.id
      if (id && current.current.status === 'running') void api.terminalResize({ id, cols, rows })
    }
    fit.current = resize
    let frame = 0
    const queueResize = (): void => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; resize() }) }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(queueResize)
    observer?.observe(element)
    window.addEventListener('resize', queueResize)
    let queued: { id: string; data: string }[] = [], queuedSize = 0, writing = false
    const write = async (): Promise<void> => {
      if (writing) return
      writing = true
      try {
        while (alive.current && queued.length) {
          const chunk = queued.shift()!
          queuedSize -= chunk.data.length
          if (chunk.id !== current.current.id || current.current.status !== 'running') continue
          const result = await api.terminalWrite(chunk)
          if (!result.ok) { if (alive.current) setError(result.error.message); queued = []; queuedSize = 0; break }
        }
      } finally { writing = false }
    }
    const input = term.onData((data) => {
      const id = current.current.id
      if (!id || current.current.status !== 'running') return
      if (queuedSize + data.length > 1024 * 1024) { setError('Terminal input is too large. Paste a smaller amount.'); return }
      for (let offset = 0; offset < data.length;) {
        let end = Math.min(offset + 16384, data.length)
        const last = data.charCodeAt(end - 1)
        if (last >= 0xd800 && last <= 0xdbff && end < data.length) end--
        const chunk = data.slice(offset, end)
        queued.push({ id, data: chunk }); queuedSize += chunk.length; offset = end
      }
      void write()
    })
    // F6 leaves the shell without consuming shell shortcuts such as Tab/Ctrl+C.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.key === 'F6') { event.preventDefault(); element.closest('section')?.querySelector<HTMLButtonElement>('button')?.focus(); return false }
      return true
    })
    let updated = false
    const unsubscribe = api.onEvent((event) => {
      if (event.type === 'terminal') { updated = true; update(event.state); resize() }
      if (event.type === 'terminal-data') {
        if (event.id === current.current.id) term.write(event.data, () => { void api.terminalAck({ id: event.id, sequence: event.sequence }) })
        else void api.terminalAck({ id: event.id, sequence: event.sequence })
      }
    })
    void api.snapshot().then((result) => { if (alive.current && result.ok && !updated) { update(result.value.terminal); resize() } })
    resize()
    return () => {
      alive.current = false
      unsubscribe(); observer?.disconnect(); theme.disconnect(); input.dispose(); term.dispose()
      window.removeEventListener('resize', queueResize)
      if (frame) cancelAnimationFrame(frame)
      terminal.current = null; fit.current = null; queued = []
    }
  }, [])
  useEffect(() => {
    const textarea = host.current?.querySelector('textarea')
    if (textarea) textarea.setAttribute('aria-label', t('Terminal input'))
  }, [t])
  const start = async (): Promise<void> => {
    const api = window.bingoPanels
    if (!api || starting) return
    setStarting(true); setError(null)
    try {
      const result = await api.terminalStart()
      if (!alive.current) return
      if (result.ok) { update(result.value); fit.current?.(); terminal.current?.focus() }
      else setError(result.error.message)
    } finally { if (alive.current) setStarting(false) }
  }
  useEffect(() => {
    if (!visible) return
    fit.current?.()
    if (automaticAttempted.current || !window.bingoPanels) return
    automaticAttempted.current = true
    // Opening the terminal is the user's explicit launch action. Never restart an
    // exited shell merely because the panel is shown again or the renderer reloads.
    void window.bingoPanels.snapshot().then((result) => {
      if (!alive.current || !result.ok) return
      if (result.value.terminal.status === 'idle') void start()
      else update(result.value.terminal)
    })
  }, [visible])
  const stop = async (): Promise<void> => {
    if (!state.id) return
    const result = await window.bingoPanels?.terminalStop(state.id)
    if (result && !result.ok) setError(result.error.message)
  }
  return <section className="native-panel terminal-panel" aria-label={t('Terminal')} hidden={!visible}>
    <header className="panel-heading"><span><TerminalSquare size={14} />{t('Terminal')}</span><span className="terminal-cwd" title={state.cwd || ''}>{state.cwd || t('Local shell · not sent to the agent')}</span>
      {state.status === 'running' || state.status === 'stopping' ? <IconButton label={t('Stop terminal')} disabled={state.status === 'stopping'} onClick={() => { void stop() }}><Square size={12} /></IconButton> : <IconButton label={t(state.status === 'exited' ? 'Restart terminal' : 'Start terminal')} disabled={starting || !window.bingoPanels} onClick={() => { void start() }}><RotateCw size={14} /></IconButton>}
      <IconButton label={t('Close terminal')} onClick={onClose}><X size={15} /></IconButton>
    </header>
    {(error || state.error) && <div className="panel-error" role="alert">{t(error || state.error!)}</div>}
    {starting && <div className="terminal-status" role="status">{t('Starting terminal…')}</div>}
    {state.status === 'stopping' && <div className="terminal-status" role="status">{t('Stopping terminal…')}</div>}
    {state.status === 'exited' && <div className="terminal-status" role="status">{state.exitCode === null ? t('Terminal exited') : t('Exit code {code}', { code: state.exitCode })}</div>}
    {!window.bingoPanels && <div className="terminal-status">{t('Terminal unavailable')}</div>}
    <div ref={host} className="terminal-host" aria-label={t('Terminal input')} />
  </section>
}
