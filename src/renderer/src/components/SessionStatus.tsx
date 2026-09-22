import { CheckCircle, CirclePause, LoaderCircle, TriangleAlert } from './icons'
import { useI18n } from '../i18n'

export function SessionStatus({ status }: { status: string }): React.JSX.Element {
  const { t } = useI18n()
  const working = status === 'working' || status === 'retrying' || status === 'resyncing'
  const Icon = working ? LoaderCircle : status === 'waiting' || status === 'connecting' || status === 'disconnected' ? CirclePause : status === 'failed' || status === 'interrupted' ? TriangleAlert : CheckCircle
  const label = status === 'ready' ? 'Ready' : status === 'waiting' ? 'Needs attention' : status === 'disconnected' ? 'Not connected' : status === 'connecting' ? 'Connecting…' : status.charAt(0).toUpperCase() + status.slice(1)
  return <span className={`session-status ${status}`} role="status" aria-live="polite" aria-atomic="true">
    <span className="status-symbol" key={status}><Icon size={13} className={working ? 'spin' : undefined} /></span><span>{t(label)}</span>
  </span>
}
