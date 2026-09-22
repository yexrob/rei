import { useContext, useId, useState, type ReactNode } from 'react'
import { Check, CirclePause, LoaderCircle, TriangleAlert, type IconComponent } from '../icons'
import type { ToolCallItem } from '../../state/session'
import { useI18n } from '../../i18n'
import { RecordedText } from './ToolResult'
import { compactValue, inputRecord, prettyJson, toolState } from './toolPresentation'
import { ToolConnectionContext } from './ToolActivityGroup'
import { contentText } from '../../state/session'
import './tools.css'

export type ToolCallFrameProps = {
  item: ToolCallItem
  icon: IconComponent
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
  const connected = useContext(ToolConnectionContext)
  const active = status === 'running' || status === 'pending'
  const StatusIcon = active ? (connected ? LoaderCircle : CirclePause) : status === 'completed' ? Check : status === 'interrupted' ? CirclePause : TriangleAlert
  const label = t(active && !connected ? 'Disconnected' : status === 'running' ? 'Running' : status === 'pending' ? 'Pending' : status === 'completed' ? 'Done' : status === 'interrupted' ? 'Interrupted' : 'Failed')
  const duration = item.body.durationMs
  const input = inputRecord(item.body.input)
  const target = compactValue(input.file_path ?? input.command ?? input.pattern ?? input.query ?? input.url ?? input.to ?? input.name ?? input.id)
  const accessibleName = `${t(expanded ? 'Hide tool details' : 'Show tool details')}: ${item.body.name}${target ? ` · ${target}` : ''}`
  const error = status === 'failed' ? contentText(item.body.output?.parts ?? []).split('\n').find(line => line.trim()) : undefined
  return <article className={`tool-card tool-card--${status}`} data-tool-name={item.body.name}>
    <div className="tool-card-header">
      <button type="button" className="tool-card-toggle" aria-label={accessibleName} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
        <span className="tool-family-icon"><Icon size={16} aria-hidden="true" /></span>
        <span className="tool-card-identity"><span className="tool-card-name">{title ?? item.body.name}</span>{summary != null && <span className="tool-card-summary">{summary}</span>}</span>
        <span className="tool-card-state"><StatusIcon size={12} className={active && connected ? 'tool-state-spin' : undefined} aria-hidden="true" /><span className={status === 'completed' ? 'sr-only' : undefined}>{label}</span>{typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 && !active && <span className="tool-duration">{(duration / 1000).toFixed(1)}s</span>}</span>
      </button>
      {actions && <div className="tool-card-actions">{actions}</div>}
    </div>
    {!expanded && error && <p className="tool-error-preview">{error.slice(0, 240)}{error.length > 240 ? '…' : ''}</p>}
    <div id={id} hidden={!expanded}>{expanded && <div className="tool-card-body">{children}<ToolDiagnostics item={item} /></div>}</div>
  </article>
}
