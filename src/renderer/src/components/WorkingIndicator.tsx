import { memo } from 'react'
import { LoaderCircle } from './icons'
import type { Retry } from '../../../shared/rpc'
import { useI18n } from '../i18n'
import { formatSeconds, useElapsed } from './motion'
import './working-indicator.css'

export const WorkingIndicator = memo(function WorkingIndicator({ retrying, startedAt }: { retrying?: Retry | null; startedAt?: string }): React.JSX.Element {
  const { t } = useI18n()
  const elapsed = useElapsed(startedAt, true)
  const label = retrying ? t('Retrying · attempt {attempt} of {max}', { attempt: retrying.attempt, max: retrying.max }) : t('Working…')
  // The elapsed clock sits outside the live region so screen readers hear the step, not every second.
  return <div className="working-row" data-retrying={retrying ? true : undefined}>
    <div className="working-state live-working" role="status" aria-live="polite" aria-atomic="true">
      <LoaderCircle className="working-beam-icon" size={14} aria-hidden="true" />
      <span className="working-beam-label"><span>{label}</span><span className="beam-shimmer" data-label={label} aria-hidden="true" /></span>
    </div>
    {elapsed != null && elapsed >= 1 && elapsed < 86400 && <span className="working-elapsed" aria-hidden="true">{formatSeconds(elapsed)}</span>}
  </div>
})
