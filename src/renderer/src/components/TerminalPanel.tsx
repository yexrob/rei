import { Plus, TerminalSquare, X } from './icons'
import { useI18n } from '../i18n'
import { IconButton } from './primitives'
import { TerminalTabs } from './terminal/TerminalTabs'
import { useTerminalController } from './terminal/useTerminalController'
import '@xterm/xterm/css/xterm.css'
import './panels.css'
import './terminal/terminal.css'

export function TerminalPanel({ visible, onClose }: { visible: boolean; onClose(): void }): React.JSX.Element {
  const { t } = useI18n()
  const { host, controller, state } = useTerminalController(visible, onClose)
  const active = state.tabs.find((tab) => tab.id === state.activeId)
  const error = state.error || active?.error
  const retry = (): void => {
    if (active?.error && active.status === 'running' && active.id) void controller.current?.close(active.id)
    else void controller.current?.start()
  }
  return <section className="native-panel terminal-panel" aria-label={t('Terminal')} hidden={!visible}>
    <header className="panel-heading terminal-heading">
      <span><TerminalSquare size={14} />{t('Terminal')}</span>
      <span className="terminal-cwd" title={active?.cwd || ''}>{active?.cwd || t('Local shell · not sent to the agent')}</span>
      <IconButton label={t('New terminal')} disabled={state.starting || !state.ready || state.tabs.length >= 8 || !window.bingoPanels} onClick={() => { void controller.current?.start() }}><Plus size={15} /></IconButton>
      <IconButton label={t('Hide terminal area')} onClick={onClose}><X size={15} /></IconButton>
    </header>
    {!!state.tabs.length && <TerminalTabs tabs={state.tabs} activeId={state.activeId} select={(id) => controller.current?.select(id)} close={(id) => { void controller.current?.close(id) }} />}
    {error && <div className="panel-error terminal-error" role="alert"><span>{t(error)}</span><button type="button" className="text-button" disabled={state.starting || active?.status === 'stopping'} onClick={retry}>{t('Retry')}</button></div>}
    {state.starting && <div className="terminal-status" role="status">{t('Starting terminal…')}</div>}
    {active?.status === 'stopping' && <div className="terminal-status" role="status">{t('Stopping terminal…')}</div>}
    {!window.bingoPanels && <div className="terminal-status">{t('Terminal unavailable')}</div>}
    <div ref={host} className="terminal-views" />
  </section>
}
