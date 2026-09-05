import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { useI18n } from '../i18n'

export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): React.JSX.Element {
  const { t } = useI18n()
  return <button type="button" className="icon-button" title={t(label)} aria-label={t(label)} {...props}>{children}</button>
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }): React.JSX.Element {
  const { t } = useI18n()
  const [status, setStatus] = useState('')
  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(''), 2400)
    return () => clearTimeout(timer)
  }, [status])
  return <span className="copy-control"><IconButton label={status || label} onClick={() => {
    void navigator.clipboard.writeText(text).then(() => setStatus('Copied'), () => setStatus('Could not copy'))
  }}>{status === 'Copied' ? <Check size={14} /> : <Copy size={14} />}</IconButton><span className="sr-only" role="status">{t(status)}</span></span>
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); previous?.focus() }
  }, [])
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby="modal-heading" onCancel={(event) => { event.preventDefault(); close.current() }}>
    <div className="modal-heading"><h2 id="modal-heading">{title}</h2><IconButton label="Close dialog" onClick={onClose}><X size={18} /></IconButton></div>
    {children}
  </dialog>
}

export function ErrorBanner({ message, onDismiss, onRetry }: { message: string; onDismiss?: () => void; onRetry?: () => void }): React.JSX.Element {
  const { t } = useI18n()
  return <div className="error-banner" role="alert"><span>{message}</span>{onRetry && <button onClick={onRetry}>{t('Retry')}</button>}{onDismiss && <IconButton label="Dismiss error" onClick={onDismiss}><X size={16} /></IconButton>}</div>
}

export function basename(path: string): string { return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'The operation could not be completed. Try again.' }
export function number(value: number): string { return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value) }
export function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
