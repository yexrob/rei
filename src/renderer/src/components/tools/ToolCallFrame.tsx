import { useId, useState, type ReactNode } from 'react'
import { Check, ChevronRight, CirclePause, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ToolCallItem } from '../../state/session'
import { useI18n } from '../../i18n'
import { RecordedText } from './ToolResult'
import { prettyJson, toolState } from './toolPresentation'
import './tools.css'

export type ToolCallFrameProps = {
  item: ToolCallItem
  icon: LucideIcon
  title?: ReactNode
  summary?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  defaultExpanded?: boolean
}

function ToolDiagnostics({ item }: { item: ToolCallItem }): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return <details className="tool-diagnostics" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t('Raw input and result')}</summary>
    {open && <><section className="tool-request-block"><h4>{t('Input')}</h4><RecordedText text={prettyJson(item.body.input)} /></section>{item.body.output && <section className="tool-request-block"><h4>{t('Recorded result')}</h4><RecordedText text={prettyJson(item.body.output)} /></section>}</>}
  </details>
}

export function ToolCallFrame({ item, icon: Icon, title, summary, actions, children, defaultExpanded = false }: ToolCallFrameProps): React.JSX.Element {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const id = useId()
  const status = toolState(item)
  const active = status === 'running' || status === 'pending'
  const StatusIcon = active ? LoaderCircle : status === 'completed' ? Check : status === 'interrupted' ? CirclePause : TriangleAlert
  const label = t(status === 'running' ? 'Running' : status === 'pending' ? 'Pending' : status === 'completed' ? 'Done' : status === 'interrupted' ? 'Interrupted' : 'Failed')
  const duration = item.body.durationMs
  return <article className={`tool-card tool-card--${status}`} data-tool-name={item.body.name}>
    <div className="tool-card-header">
      <span className="tool-family-icon"><Icon size={16} aria-hidden="true" /></span>
      <div className="tool-card-identity"><span className="tool-card-name">{title ?? item.body.name}</span>{summary != null && <div className="tool-card-summary">{summary}</div>}</div>
      {actions && <div className="tool-card-actions">{actions}</div>}
      <span className="tool-card-state"><StatusIcon size={12} className={active ? 'tool-state-spin' : undefined} aria-hidden="true" /><span>{label}</span>{typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 && !active && <span className="tool-duration">{(duration / 1000).toFixed(1)}s</span>}</span>
      <button type="button" className="tool-card-disclosure" aria-label={t(expanded ? 'Hide tool details' : 'Show tool details')} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}><ChevronRight size={15} aria-hidden="true" /></button>
    </div>
    {expanded && <div className="tool-card-body" id={id}>{children}<ToolDiagnostics item={item} /></div>}
  </article>
}
