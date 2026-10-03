import { useContext, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, CirclePause, LoaderCircle, TriangleAlert, type IconComponent } from '../icons'
import type { ToolCallItem } from '../../state/session'
import { useI18n } from '../../i18n'
import { RecordedText } from './ToolResult'
import { compactValue, inputRecord, prettyJson, toolState } from './toolPresentation'
import { ToolConnectionContext } from './ToolActivityGroup'
import { contentText } from '../../state/session'
import { formatSeconds, useElapsed } from '../motion'
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
  // Details mount on first open and stay mounted so collapsing can animate out.
  const [opened, setOpened] = useState(defaultExpanded)
  const id = useId()
  const status = toolState(item)
  const connected = useContext(ToolConnectionContext)
  const active = status === 'running' || status === 'pending'
  const live = active && connected
  const elapsed = useElapsed(item.startedAt, live)
  // Celebrate only a completion witnessed live, never history that arrives already done.
  const wasActive = useRef(active)
  if (active) wasActive.current = true
  const settled = wasActive.current && status === 'completed'
  const StatusIcon = active ? (connected ? LoaderCircle : CirclePause) : status === 'completed' ? Check : status === 'interrupted' ? CirclePause : TriangleAlert
  const label = t(active && !connected ? 'Disconnected' : status === 'running' ? 'Running' : status === 'pending' ? 'Pending' : status === 'completed' ? 'Done' : status === 'interrupted' ? 'Interrupted' : 'Failed')
  const duration = item.body.durationMs
  const input = inputRecord(item.body.input)
  const target = compactValue(input.file_path ?? input.command ?? input.pattern ?? input.query ?? input.url ?? input.to ?? input.name ?? input.id)
  const accessibleName = `${t(expanded ? 'Hide tool details' : 'Show tool details')}: ${item.body.name}${target ? ` · ${target}` : ''}`
  const error = status === 'failed' ? contentText(item.body.output?.parts ?? []).split('\n').find(line => line.trim()) : undefined
  return <article className={`tool-card tool-card--${status}`} data-tool-name={item.body.name} data-live={live || undefined}>
    <div className="tool-card-header">
      <button type="button" className="tool-card-toggle" aria-label={accessibleName} aria-expanded={expanded} aria-controls={id} onClick={() => { setOpened(true); setExpanded(value => !value) }}>
        <span className="tool-family-icon"><Icon size={16} aria-hidden="true" /></span>
        <span className="tool-card-identity"><span className="tool-card-name">{title ?? item.body.name}</span>{summary != null && <span className="tool-card-summary">{summary}</span>}</span>
        <span className="tool-card-state"><StatusIcon size={12} className={live ? 'tool-state-spin' : settled ? 'tool-state-done' : undefined} aria-hidden="true" /><span className={status === 'completed' || live ? 'sr-only' : undefined}>{label}</span>{elapsed != null && elapsed >= 1 && elapsed < 86400 && <span className="tool-duration tool-elapsed" aria-hidden="true">{formatSeconds(elapsed)}</span>}{typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 && !active && <span className="tool-duration">{formatSeconds(duration / 1000)}</span>}</span>
        <ChevronRight className="tool-card-chevron" size={13} aria-hidden="true" />
      </button>
      {actions && <div className="tool-card-actions">{actions}</div>}
    </div>
    {!expanded && error && <p className="tool-error-preview">{error.slice(0, 240)}{error.length > 240 ? '…' : ''}</p>}
    <div id={id} className="tool-card-reveal" hidden={!expanded}>{(expanded || opened) && <div className="tool-card-body">{children}<ToolDiagnostics item={item} /></div>}</div>
  </article>
}
