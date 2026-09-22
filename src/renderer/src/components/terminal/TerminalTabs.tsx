import { X } from '../icons'
import { useI18n } from '../../i18n'
import { IconButton } from '../primitives'
import type { TerminalTab } from './terminal-controller'

export function TerminalTabs({ tabs, activeId, select, close }: { tabs: TerminalTab[]; activeId: string | null; select(id: string): void; close(id: string): void }): React.JSX.Element {
  const { t } = useI18n()
  const move = (event: React.KeyboardEvent, index: number): void => {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    const id = tabs[next]?.id
    if (id) { select(id); document.getElementById(`terminal-tab-${id}`)?.focus() }
  }
  return <div className="terminal-tabs" role="tablist" aria-label={t('Terminal tabs')}>
    {tabs.map((tab, index) => <div key={tab.id} className={`terminal-tab-item${tab.id === activeId ? ' is-active' : ''}`}>
      <button type="button" role="tab" id={`terminal-tab-${tab.id}`} aria-controls={`terminal-content-${tab.id}`} aria-selected={tab.id === activeId} tabIndex={tab.id === activeId ? 0 : -1} title={tab.cwd || ''} onClick={() => { if (tab.id) select(tab.id) }} onKeyDown={(event) => move(event, index)}>
        {t('Terminal {number}', { number: tab.number })}{tab.error && <span className="terminal-tab-error" aria-hidden="true">!</span>}
      </button>
      <IconButton label={t('Close terminal {number}', { number: tab.number })} disabled={tab.status === 'stopping'} onClick={() => { if (tab.id) close(tab.id) }}><X size={12} /></IconButton>
    </div>)}
  </div>
}
