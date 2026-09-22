import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronRight } from './icons'
import type { Collaborator } from '../state/collaboration'
import { useI18n } from '../i18n'
import { CollaborationAvatar } from './CollaborationAvatar'
import './collaboration-dock.css'

export interface CollaborationDockProps {
  entries: Collaborator[]
  activeId: string | null
  onSelect: (id: string) => void
  disabled?: boolean
  compact?: boolean
}

const statusLabels: Record<string, string> = {
  ready: 'Ready', working: 'Working', retrying: 'Retrying', waiting: 'Waiting for you',
  failed: 'Failed', interrupted: 'Interrupted', closed: 'Closed', resyncing: 'Reconnecting…', loading: 'Loading activity…'
}

function useDockDisclosure() {
  const [open, setOpen] = useState(false)
  const region = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointer = useRef(false)
  const restoringFocus = useRef(false)
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  const show = () => { clear(); setOpen(true) }
  const close = () => { clear(); setOpen(false) }
  const enter = () => { clear(); timer.current = setTimeout(() => setOpen(true), 120) }
  const leave = () => {
    clear()
    timer.current = setTimeout(() => {
      if (!region.current?.contains(document.activeElement)) setOpen(false)
    }, 250)
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
    restoringFocus.current = true
    trigger.current?.focus()
    restoringFocus.current = false
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !region.current?.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return { open, region, trigger, pointer, restoringFocus, clear, show, close, enter, leave, escape }
}

function displayName(entry: Collaborator): string { return entry.main ? 'Bingo' : entry.name }

function CollaboratorRow({ entry, selected, disabled, onSelect, compact }: { entry: Collaborator; selected: boolean; disabled?: boolean; onSelect: () => void; compact?: boolean }): React.JSX.Element {
  const { t } = useI18n()
  const role = t(entry.main ? 'Main' : entry.kind === 'room' ? 'Room' : 'Agent')
  const status = t(statusLabels[entry.status] ?? 'Unknown status')
  const activity = entry.activity
  return <button type="button" className="collaboration-row" data-session-id={entry.id} disabled={disabled} aria-current={selected ? 'page' : undefined} aria-label={`${displayName(entry)} · ${role} · ${status}`} onClick={onSelect}>
    <CollaborationAvatar name={displayName(entry)} kind={entry.kind} main={entry.main} status={entry.status} variant={compact ? 'glyph' : 'initial'} />
    <span className="collaboration-row-body">
      <span className="collaboration-row-heading"><strong title={entry.name}>{displayName(entry)}</strong>{entry.main && <span className="collaboration-role">{role}</span>}<span className="collaboration-row-status" data-status={entry.status}>{status}</span></span>
      <span className="collaboration-activity" title={activity?.text}>{activity?.text || t(entry.status === 'loading' ? 'Loading activity…' : 'No activity yet')}</span>
      <span className="collaboration-activity-detail" title={activity?.detail}>{activity?.detail || '\u00a0'}</span>
    </span>
    <ChevronRight className="collaboration-row-chevron" size={14} aria-hidden="true" />
  </button>
}

export function CollaborationDock({ entries, activeId, onSelect, disabled = false, compact = false }: CollaborationDockProps): React.JSX.Element | null {
  const { t } = useI18n()
  const panelId = useId()
  const dock = useDockDisclosure()
  if (entries.length === 0) return null
  const preview = entries.filter((entry) => entry.kind === 'agent' && (!compact || !entry.main)).slice(0, 4)
  const room = entries.find((entry) => entry.kind === 'room')
  return <div className={`collaboration-dock ${compact ? 'collaboration-dock-compact' : ''}`} ref={dock.region} onPointerEnter={(event) => { if (event.pointerType !== 'touch' && !disabled) dock.enter() }} onPointerLeave={dock.leave} onKeyDown={dock.escape}
    onFocus={() => { if (!dock.pointer.current && !dock.restoringFocus.current && !disabled) dock.show() }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) dock.leave(); dock.pointer.current = false }}>
    <div className="collaboration-stack">
      <button ref={dock.trigger} type="button" className="collaboration-stack-toggle" aria-label={t('Collaborators')} aria-expanded={dock.open && !disabled} aria-controls={dock.open && !disabled ? panelId : undefined} disabled={disabled}
        onPointerDown={() => { dock.pointer.current = true }} onPointerCancel={() => { dock.pointer.current = false }}
        onClick={() => { if (dock.open) dock.close(); else dock.show(); dock.pointer.current = false }}>
        {preview.map((entry) => <span key={entry.id} className={`collaboration-stack-slot ${entry.id === activeId ? 'is-selected' : ''}`}><CollaborationAvatar name={displayName(entry)} kind={entry.kind} main={entry.main} status={entry.status} variant={compact ? 'glyph' : 'initial'} /></span>)}
      </button>
      {!compact && room && <button type="button" className={`collaboration-stack-slot collaboration-stack-room ${room.id === activeId ? 'is-selected' : ''}`} disabled={disabled} aria-label={t('Open room {name}', { name: room.name })} aria-current={room.id === activeId ? 'page' : undefined}
        onClick={() => { dock.close(); onSelect(room.id) }}><CollaborationAvatar name={room.name} kind="room" status={room.status} /></button>}
    </div>
    {dock.open && !disabled && <div className="collaboration-panel-bridge">
      <nav id={panelId} className="collaboration-panel" aria-label={t('Collaborators')}>
        <div className="collaboration-panel-heading">{t('Latest activity')}</div>
        <div className="collaboration-rows">{entries.map((entry) => <CollaboratorRow key={entry.id} entry={entry} selected={entry.id === activeId} disabled={disabled} compact={compact} onSelect={() => { dock.close(); onSelect(entry.id) }} />)}</div>
      </nav>
    </div>}
  </div>
}
