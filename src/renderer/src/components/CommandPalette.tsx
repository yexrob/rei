import { Command } from 'cmdk'
import { useState, type ReactNode } from 'react'
import { ArrowUpRight, MessageSquare, Terminal } from './icons'
import { Modal } from './primitives'
import { useI18n } from '../i18n'

export type PaletteSession = { hostId: string; id: string; title: string; caption: string; path: string; project: string }
export type PaletteAction = { id: string; label: string; icon: ReactNode; shortcut?: string; disabled?: boolean; hint?: string; run: () => void }
type Props = {
  sessions: PaletteSession[]; actions: PaletteAction[]; commands: { id: string; label: string }[]
  onSession(hostId: string, id: string): void; onCommand(id: string): void; onClose(): void
}

// Every whitespace-separated term must appear in the value or a keyword.
function score(value: string, query: string, keywords: string[] = []): number {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return 1
  // Session/action values are internal ids; only their keywords are searchable.
  const haystack = [...(value.startsWith('/') ? [value] : []), ...keywords].map(item => item.toLowerCase())
  return terms.every(term => haystack.some(item => item.includes(term.replace(/^\//, '')))) ? 1 : 0
}

/** Search & commands: combobox + listbox with arrow keys; Enter runs the active (first) result. */
export function CommandPalette({ sessions, actions, commands, onSession, onCommand, onClose }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const recent = query.trim() ? sessions : sessions.slice(0, 8)
  return <Modal title={t('Search & commands')} onClose={onClose}>
    <Command className="palette" label={t('Search & commands')} loop filter={score}>
      <Command.Input className="palette-input" autoFocus aria-label={t('Search sessions and commands')} placeholder={t('Find a session or type a command…')} value={query} onValueChange={setQuery} />
      <Command.List className="palette-results" label={t('Results')}>
        <Command.Empty>{t('No matching sessions or commands.')}</Command.Empty>
        {recent.length > 0 && <Command.Group heading={t('Sessions')}>{recent.map(session => <Command.Item key={`${session.hostId}\u0000${session.id}`} value={`session ${session.hostId} ${session.id}`} keywords={[session.title, session.path, session.project]} onSelect={() => onSession(session.hostId, session.id)}>
          <MessageSquare size={16} /><span className="palette-copy"><span>{session.title}</span><small title={session.path}>{session.caption}</small></span><ArrowUpRight size={14} />
        </Command.Item>)}</Command.Group>}
        <Command.Group heading={t('Actions')}>{actions.map(action => <Command.Item key={action.id} value={`action ${action.id}`} keywords={[t(action.label), action.label]} disabled={action.disabled} onSelect={action.run}>
          {action.icon}<span className="palette-copy"><span>{t(action.label)}</span>{action.disabled && action.hint && <small>{t(action.hint)}</small>}</span>{action.shortcut && <kbd>{action.shortcut}</kbd>}
        </Command.Item>)}</Command.Group>
        {commands.length > 0 && <Command.Group heading={t('Commands')}>{commands.map(entry => <Command.Item key={entry.id} value={`/${entry.id}`} keywords={[entry.label]} onSelect={() => onCommand(entry.id)}>
          <Terminal size={16} /><span className="palette-copy"><span>/{entry.id}</span><small>{entry.label}</small></span>
        </Command.Item>)}</Command.Group>}
      </Command.List>
    </Command>
    <div className="palette-hint" aria-hidden="true"><span>{t('↑ ↓ to navigate')}</span><span>{t('↵ to choose')}</span></div>
  </Modal>
}
