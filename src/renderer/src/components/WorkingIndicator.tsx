import { memo } from 'react'
import { LoaderCircle } from './icons'
import type { Retry } from '../../../shared/rpc'
import { useI18n } from '../i18n'
import './working-indicator.css'

export const WorkingIndicator = memo(function WorkingIndicator({ retrying }: { retrying?: Retry | null }): React.JSX.Element {
  const { t } = useI18n()
  const label = retrying ? t('Retrying · attempt {attempt} of {max}', { attempt: retrying.attempt, max: retrying.max }) : t('Working…')
  return <div className="working-state live-working" role="status" aria-live="polite" aria-atomic="true">
    <LoaderCircle className="working-beam-icon" size={15} aria-hidden="true" />
    <span className="working-beam-label"><span>{label}</span><span className="beam-shimmer" data-label={label} aria-hidden="true" /></span>
  </div>
})
