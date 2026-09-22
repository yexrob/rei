import { createContext, useId, useState, type ReactNode } from 'react'
import type { Item } from '../../../../shared/rpc'
import type { ToolCallItem } from '../../state/session'
import { useI18n } from '../../i18n'
import { toolState } from './toolPresentation'
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
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.body.name, (counts.get(item.body.name) ?? 0) + 1)
  return <ToolConnectionContext value={connected}><section className="tool-activity" aria-label={t('Tool activity')} data-connected={connected}>
    {items.length > 1 && <button type="button" className="tool-activity-toggle" aria-label={t(expanded ? 'Hide tool activity' : 'Show tool activity')} aria-expanded={expanded} aria-controls={id} onClick={() => setChoice(!expanded)}>
      <span>{t('{count} tools', { count: items.length })}</span><span className="tool-activity-summary">{[...counts].map(([name, count]) => `${name}${count > 1 ? ` ×${count}` : ''}`).join(' · ')}</span>
    </button>}
    <div id={id} className="tool-activity-rows" onFocusCapture={() => setChoice(true)} onClickCapture={() => setChoice(true)} onPointerDownCapture={() => setChoice(true)}>{items.map(item => <div key={item.id} hidden={!expanded && toolState(item) === 'completed'}>{renderTool(item)}</div>)}</div>
  </section></ToolConnectionContext>
}
