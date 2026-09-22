import type { ContextUsage } from '../../../shared/rpc'
import { useI18n } from '../i18n'
import { number } from './primitives'
import './session-metrics.css'

function count(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0 }

/** Small, data-backed charts. Never substitute example usage when the runtime has none. */
export function SessionMetrics({ inputTokens, outputTokens, context }: { inputTokens: number; outputTokens: number; context?: ContextUsage | null }): React.JSX.Element {
  const { t, locale } = useI18n()
  const input = count(inputTokens), output = count(outputTokens), total = input + output
  const inputWidth = total > 0 ? input / total * 160 : 0
  const used = count(context?.used ?? 0), window = count(context?.window ?? 0)
  const percent = window > 0 ? Math.min(100, used / window * 100) : null
  const format = new Intl.NumberFormat(locale)
  const tokenLabel = t('{input} in · {output} out', { input: format.format(input), output: format.format(output) })
  const contextLabel = t('{used} of {total} context tokens', { used: format.format(used), total: format.format(window) })
  return <div className="session-metrics">
    <div className="usage-stat">
      <span className="metric-label">{t('Total tokens')}</span>
      <strong className="metric-value">{number(total)}</strong>
      <svg className="token-chart" viewBox="0 0 160 6" role="img" aria-label={tokenLabel}>
        <rect width="160" height="6" rx="3" className="metric-track" />
        <rect width={inputWidth} height="6" rx="2" className="metric-input" />
        <rect x={inputWidth} width={total > 0 ? 160 - inputWidth : 0} height="6" rx="2" className="metric-output" />
      </svg>
      <span className="metric-caption">{t('{input} in · {output} out', { input: number(input), output: number(output) })}</span>
    </div>
    {context && <div className="context-stat">
      <svg className="context-chart" viewBox="0 0 40 40" role="img" aria-label={window > 0 ? contextLabel : t('Context capacity unavailable')}>
        <circle cx="20" cy="20" r="16" className="metric-track" />
        <circle cx="20" cy="20" r="16" pathLength="100" strokeDasharray={`${percent ?? 0} 100`} transform="rotate(-90 20 20)" className={`context-arc ${percent !== null && percent >= 85 ? 'near-limit' : ''}`} />
      </svg>
      <div><span className="metric-label">{t('Context')}</span><strong className="metric-value">{percent === null ? '—' : `${Math.round(percent)}%`}</strong><span className="metric-caption">{number(used)} / {window > 0 ? number(window) : '—'}</span></div>
    </div>}
  </div>
}
