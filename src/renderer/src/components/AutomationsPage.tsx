import { useEffect, useState } from 'react'
import { Clock3, Plus, RefreshCw } from 'lucide-react'
import type { View } from '../../../shared/rpc'
import type { useWorkspace } from '../state/useWorkspace'
import { StructuredView, type OpenLink } from './Content'
import { ErrorBanner, errorMessage } from './primitives'
import { useI18n } from '../i18n'
import './capability-pages.css'

type Props = { workspace: ReturnType<typeof useWorkspace>; openLink: OpenLink; onCompose: (text: string) => void }
type Result = { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'failed'; error: string } | { kind: 'ready'; view: View | null }

export function AutomationsPage({ workspace: w, openLink, onCompose }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [result, setResult] = useState<Result>({ kind: 'loading' })
  const [revision, setRevision] = useState(0)
  const [creating, setCreating] = useState(false)
  const ready = w.connection.status === 'ready'
  useEffect(() => {
    if (!ready) return
    let current = true
    setResult({ kind: 'loading' })
    const load = async () => {
      const catalog = await w.readCatalog('commands')
      if (!current) return
      if (!catalog.entries.some((entry) => entry.id === 'schedule')) { setResult({ kind: 'unavailable' }); return }
      const view = await w.runActionView('schedule')
      if (current) setResult({ kind: 'ready', view })
    }
    void load().catch((error: unknown) => { if (current) setResult({ kind: 'failed', error: errorMessage(error) }) })
    return () => { current = false }
  }, [ready, w.connection.connectionId, w.readCatalog, w.runActionView, revision])
  const refresh = () => setRevision((value) => value + 1)
  return <section className="capability-page" aria-labelledby="automations-title">
    <header className="capability-heading"><div><h1 id="automations-title">{t('Automations')}</h1><p>{t('Give recurring work a place on the calendar.')}</p></div><div className="button-row"><button disabled={!ready || result.kind === 'loading'} onClick={refresh} aria-label={t('Refresh automations')}><RefreshCw size={15} /></button><button className="primary" disabled={!ready || result.kind !== 'ready'} onClick={() => setCreating(!creating)}><Plus size={15} />{t('New automation')}</button></div></header>
    <p className="capability-note">{t('Schedules are managed by bingo. They run only while a bingo process holds the schedule store.')}</p>
    {creating && ready && result.kind === 'ready' && <AutomationDraft onCompose={onCompose} onCancel={() => setCreating(false)} />}
    {!ready ? <div className="capability-empty"><Clock3 size={24} /><p>{t('Connect to bingo to view automations.')}</p></div>
      : result.kind === 'loading' ? <p className="capability-empty" role="status">{t('Loading automations…')}</p>
      : result.kind === 'unavailable' ? <p className="capability-empty">{t('This runtime does not provide the /schedule command.')}</p>
      : result.kind === 'failed' ? <ErrorBanner message={result.error} onRetry={refresh} />
      : result.view ? <div className="automation-result"><StructuredView view={result.view} openLink={openLink} runAction={(action) => { setResult({ kind: 'loading' }); void w.runActionView(action.name, action.args).then((view) => setResult({ kind: 'ready', view }), (error: unknown) => setResult({ kind: 'failed', error: errorMessage(error) })) }} /></div>
      : <p className="capability-empty">{t('The runtime returned no schedule display. Refresh to try again.')}</p>}
  </section>
}

function AutomationDraft({ onCompose, onCancel }: { onCompose: (text: string) => void; onCancel: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [when, setWhen] = useState('')
  const [task, setTask] = useState('')
  return <form className="automation-draft" onSubmit={(event) => {
    event.preventDefault()
    if (!when.trim() || !task.trim()) return
    onCompose(t('Create a bingo schedule for this workspace. When: {when}\nTask: {task}\nCheck the schedule specification and ask me to confirm before saving it.', { when: when.trim(), task: task.trim() }))
    onCancel()
  }}><h2>{t('New automation')}</h2><p>{t('This prepares a message for the agent, not a saved schedule. Review the draft and send it yourself; bingo will ask before saving.')}</p><label>{t('When')}<input required value={when} onChange={(event) => setWhen(event.target.value)} placeholder="daily at 09:00" /></label><small>{t('Examples: every 30m · daily at 09:00 · once at 2026-12-01T09:00:00+08:00')}</small><label>{t('Task')}<textarea required rows={3} value={task} onChange={(event) => setTask(event.target.value)} placeholder={t('What should the agent do?')} /></label><div className="button-row"><button type="button" onClick={onCancel}>{t('Cancel')}</button><button className="primary" disabled={!when.trim() || !task.trim()}>{t('Prepare draft')}</button></div></form>
}
