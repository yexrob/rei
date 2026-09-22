import { useRef } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ChevronDown, ChevronRight, Folder, GitCompareArrows, Hash, Monitor } from './icons'
import type { Collaborator } from '../state/collaboration'
import { roomMetadata } from '../state/collaboration'
import { CollaborationDock } from './CollaborationDock'
import { useI18n, type Translator } from '../i18n'
import './environment.css'

export function summarizeAgents(entries: Collaborator[]) {
  const counts = { working: 0, waiting: 0, done: 0, idle: 0, failed: 0 }
  for (const entry of entries) {
    if (entry.kind !== 'agent' || entry.main) continue
    if (entry.status === 'working' || entry.status === 'retrying') counts.working++
    else if (entry.status === 'waiting') counts.waiting++
    else if (entry.status === 'failed' || entry.status === 'interrupted') counts.failed++
    else if (entry.status === 'ready' && entry.projection?.snapshot.lastTurn?.status.kind === 'completed') counts.done++
    else if (entry.status === 'ready') counts.idle++
  }
  return counts
}

function countLabel(entries: Collaborator[], t: Translator): string {
  const counts = summarizeAgents(entries)
  const labels: [keyof typeof counts, string][] = [['working', '{count} working'], ['waiting', '{count} waiting'], ['failed', '{count} need attention'], ['done', '{count} done'], ['idle', '{count} idle']]
  return labels.flatMap(([key, label]) => counts[key] ? [t(label, { count: counts[key] })] : []).join(' · ')
}

type Props = {
  open: boolean; onOpenChange(open: boolean): void; entries: Collaborator[]; activeId: string | null;
  onSelect(id: string): void; onReview(): void; workspaceName: string; workspacePath?: string | null;
  ready: boolean; canReview: boolean; disabled?: boolean
}

export function EnvironmentPanel({ open, onOpenChange, entries, activeId, onSelect, onReview, workspaceName, workspacePath, ready, canReview, disabled = false }: Props): React.JSX.Element {
  const { t } = useI18n()
  const navigating = useRef(false)
  const agents = entries.filter((entry) => entry.kind === 'agent' && !entry.main)
  const rooms = entries.filter((entry) => entry.kind === 'room')
  const summary = countLabel(entries, t) || t('{count} agents', { count: agents.length })
  const select = (id: string) => { navigating.current = true; onOpenChange(false); onSelect(id) }
  return <Popover.Root open={open} onOpenChange={(value) => { navigating.current = false; onOpenChange(value) }}>
    <Popover.Trigger asChild><button className="environment-trigger" aria-label={t('Environment')} aria-expanded={open}><Monitor size={15} /><span>{t('Environment')}</span><ChevronDown size={12} /></button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="environment-popover" aria-label={t('Environment')} side="bottom" align="end" sideOffset={12} collisionPadding={16} onCloseAutoFocus={(event) => { if (navigating.current) event.preventDefault() }}>
      <header className="environment-heading"><strong>{t('Environment')}</strong><span><Monitor size={12} />{t(ready ? 'Local' : 'Not connected')}</span></header>
      <div className="environment-project" title={workspacePath ?? workspaceName}><Folder size={14} /><span>{workspaceName}</span></div>
      <button className="environment-action" disabled={!canReview} onClick={() => { navigating.current = true; onOpenChange(false); onReview() }}><GitCompareArrows size={15} /><span>{t('Review changes')}</span><ChevronRight size={13} /></button>
      <section className="environment-agents" aria-label={t('Subagents')}>
        <div className="environment-section-heading"><span>{t('Subagents')}</span></div>
        {agents.length > 0 && <div className="environment-agent-line"><CollaborationDock compact entries={entries} activeId={activeId} onSelect={select} disabled={disabled || !ready} /><span className="environment-count" title={summary}>{summary}</span></div>}
        {!agents.length && <p className="environment-empty">{t('Agents appear here when Bingo delegates work.')}</p>}
      </section>
      {rooms.length > 0 && <section className="environment-rooms" aria-label={t('Rooms')}><div className="environment-section-heading"><span>{t('Rooms')}</span><span className="environment-count">{rooms.length}</span></div>{rooms.map((room) => {
        const details = room.projection ? roomMetadata(room.projection.snapshot) : null
        return <button key={room.id} className="environment-room" disabled={disabled || !ready} aria-label={t('Open room {name}', { name: room.name })} aria-current={room.id === activeId ? 'page' : undefined} onClick={() => select(room.id)}>
          <span className="environment-room-icon"><Hash size={13} /></span><span>{room.name.replace(/^#/, '')}</span><small>{details?.closed ? t('Closed') : details ? t('{count} members', { count: details.members.length }) : t('Room')}</small><ChevronRight size={12} />
        </button>
      })}</section>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
