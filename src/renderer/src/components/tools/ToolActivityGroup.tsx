import { createContext, useEffect, useId, useState, type ReactNode } from 'react'
import type { Item } from '../../../../shared/rpc'
import type { ToolCallItem } from '../../state/session'
import { useI18n } from '../../i18n'
import { ChevronRight } from '../icons'
import { toolState, toolVerb } from './toolPresentation'
import './tools.css'

export const ToolConnectionContext = createContext(true)
export type TimelineEntry = { kind: 'item'; key: string; item: Item } | { kind: 'tools'; key: string; items: ToolCallItem[] }
/** Only adjacent tool calls in the same turn belong together. Singletons use the same stable run key. */
export function groupTimelineItems(items: readonly Item[]): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (const item of items) {
    const previous = entries.at(-1)
    if (item.body.kind !== 'toolCall') entries.push({ kind: 'item', key: item.id, item })
    else if (previous?.kind === 'tools' && previous.items[0].turn === item.turn) previous.items.push(item as ToolCallItem)
    else entries.push({ kind: 'tools', key: item.id, items: [item as ToolCallItem] })
  }
  return entries
}

export function ToolActivityGroup({ items, connected, renderTool }: { items: readonly ToolCallItem[]; connected: boolean; renderTool: (item: ToolCallItem) => ReactNode }): React.JSX.Element {
  const { t } = useI18n()
  // Untouched successful runs compact automatically. Any row inspection pins them open;
  // focus capture also protects keyboard readers and independent preview/copy actions.
  const [choice, setChoice] = useState<boolean | null>(null)
  const expanded = choice ?? (items.length === 1 || items.some(item => toolState(item) !== 'completed'))
  const id = useId()
  // Rows present at first paint (history) appear in place; only later rows animate in.
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.body.name, (counts.get(item.body.name) ?? 0) + 1)
  const running = connected ? items.findLast(item => item.status === 'running' || item.status === 'pending') : undefined
  const failed = items.filter(item => toolState(item) === 'failed').length
  const verb = running && toolVerb(running.body.name, true)
  return <ToolConnectionContext value={connected}><section className="tool-activity" aria-label={t('Tool activity')} data-connected={connected} data-multi={items.length > 1 || undefined} data-ready={ready || undefined}>
    {items.length > 1 && <button type="button" className="tool-activity-toggle" aria-label={t(expanded ? 'Hide tool activity' : 'Show tool activity')} aria-expanded={expanded} aria-controls={id} onClick={() => setChoice(!expanded)}>
      <ChevronRight className="tool-activity-chevron" size={12} aria-hidden="true" />
      <span className={verb ? 'tool-activity-live' : undefined}>{verb ? `${t(verb.key, verb.vars)}…` : t('Used {count} tools', { count: items.length })}</span>
      {failed > 0 && <span className="tool-activity-failed">{t('{count} failed', { count: failed })}</span>}
      <span className="tool-activity-summary">{[...counts].map(([name, count]) => `${name}${count > 1 ? ` ×${count}` : ''}`).join(' · ')}</span>
    </button>}
    <div id={id} className="tool-activity-rows" onFocusCapture={() => setChoice(true)} onClickCapture={() => setChoice(true)} onPointerDownCapture={() => setChoice(true)}>{items.map(item => <div key={item.id} className="tool-activity-row" hidden={!expanded && toolState(item) === 'completed'}>{renderTool(item)}</div>)}</div>
  </section></ToolConnectionContext>
}
