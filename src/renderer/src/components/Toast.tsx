import { useEffect, useRef, useState } from 'react'
import { X } from './icons'
import { IconButton } from './primitives'
import type { Translator } from '../i18n'
import { useI18n } from '../i18n'

const EFFORTS: Record<string, string> = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum' }

/** Runtime acknowledgements arrive as protocol text; present the known ones in the UI language. */
export function localizeNotice(text: string, t: Translator): string {
  const thinking = /^thinking:\s*([a-z]+)\s*$/i.exec(text.trim())
  const label = thinking ? EFFORTS[thinking[1].toLowerCase()] : undefined
  return label ? t('Thinking effort: {level}', { level: t(label) }) : text
}

export type ToastAction = { label: string; run: () => void }
/** Auto-dismissing status toast that pauses while hovered or focused. */
export function Toast({ message, onDismiss, action, duration = 7000 }: { message: string; onDismiss: () => void; action?: ToastAction; duration?: number }): React.JSX.Element {
  const { t } = useI18n()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const dismiss = useRef(onDismiss); dismiss.current = onDismiss
  const paused = hovered || focused
  useEffect(() => {
    if (paused) return
    const timer = setTimeout(() => dismiss.current(), duration)
    return () => clearTimeout(timer)
  }, [message, paused, duration])
  return <div className="toast" role="status" data-paused={paused || undefined} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false) }}>
    <span>{message}</span>
    {action && <button type="button" className="toast-action" onClick={() => { action.run(); dismiss.current() }}>{t(action.label)}</button>}
    <IconButton label="Dismiss notification" onClick={onDismiss}><X size={14} /></IconButton>
  </div>
}
