import { useCallback, useRef, useState } from 'react'
import { useI18n } from '../i18n'

/** A per-viewer UI size remembered in localStorage (null means the CSS default). */
export function useStoredSize(key: string): [number | null, (size: number | null) => void] {
  const [size, setSize] = useState<number | null>(() => {
    try { const value = Number(localStorage.getItem(key)); return Number.isFinite(value) && value > 0 ? value : null } catch { return null }
  })
  const update = useCallback((next: number | null) => {
    setSize(next)
    try { if (next === null) localStorage.removeItem(key); else localStorage.setItem(key, String(Math.round(next))) } catch { /* Size applies to this window only. */ }
  }, [key])
  return [size, update]
}

type Props = {
  label: string
  /** 'vertical' separates side-by-side panes (drag left/right); 'horizontal' stacks (drag up/down). */
  orientation: 'vertical' | 'horizontal'
  /** Current size of the controlled pane in px. */
  value: number; min: number; max: number
  onChange(size: number): void
  onReset?(): void
  /** The pane sits after the splitter (to its right/below), so dragging toward it shrinks it. */
  paneAfter?: boolean
  step?: number
}
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

/** Keyboard- and pointer-resizable separator (WAI-ARIA window splitter). */
export function Splitter({ label, orientation, value, min, max, onChange, onReset, paneAfter = true, step = 24 }: Props): React.JSX.Element {
  const { t } = useI18n()
  const drag = useRef<{ start: number; size: number } | null>(null)
  const vertical = orientation === 'vertical'
  const sign = paneAfter ? -1 : 1
  const set = (size: number) => onChange(clamp(size, min, max))
  return <div role="separator" tabIndex={0} className={`splitter splitter-${orientation}`} aria-label={t(label)} aria-orientation={orientation} aria-valuenow={Math.round(value)} aria-valuemin={Math.round(min)} aria-valuemax={Math.round(Math.max(min, max))}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId)
      drag.current = { start: vertical ? event.clientX : event.clientY, size: value }
      document.documentElement.dataset.resizing = orientation
    }}
    onPointerMove={(event) => { const state = drag.current; if (state) set(state.size + sign * ((vertical ? event.clientX : event.clientY) - state.start)) }}
    onPointerUp={(event) => { drag.current = null; delete document.documentElement.dataset.resizing; event.currentTarget.releasePointerCapture?.(event.pointerId) }}
    onPointerCancel={() => { drag.current = null; delete document.documentElement.dataset.resizing }}
    onDoubleClick={onReset}
    onKeyDown={(event) => {
      const amount = event.shiftKey ? step * 4 : step
      const grow: Record<string, number> = vertical ? { ArrowLeft: -sign, ArrowRight: sign } : { ArrowUp: -sign, ArrowDown: sign }
      const direction = grow[event.key]
      if (direction) { event.preventDefault(); set(value + direction * amount) }
      else if (event.key === 'Home') { event.preventDefault(); set(min) }
      else if (event.key === 'End') { event.preventDefault(); set(max) }
      else if (event.key === 'Enter' && onReset) { event.preventDefault(); onReset() }
    }} />
}
