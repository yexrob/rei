import { useEffect, useState } from 'react'
import { ArrowUpRight, BookOpen, RefreshCw, Search } from 'lucide-react'
import type { useWorkspace } from '../state/useWorkspace'
import type { OpenLink } from './Content'
import { ErrorBanner, errorMessage, object } from './primitives'
import { useI18n } from '../i18n'
import './capability-pages.css'

type Props = { workspace: ReturnType<typeof useWorkspace>; openLink: OpenLink; onCompose: (text: string) => void }

export function SkillsPage({ workspace: w, onCompose }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ loading: boolean; error: string }>({ loading: true, error: '' })
  const ready = w.connection.status === 'ready'
  useEffect(() => {
    if (!ready) return
    let current = true
    setState({ loading: true, error: '' })
    void w.readCatalog('commands').then(() => {
      if (current) setState({ loading: false, error: '' })
    }, (error: unknown) => { if (current) setState({ loading: false, error: errorMessage(error) }) })
    return () => { current = false }
  }, [ready, w.connection.connectionId, w.readCatalog, revision])
  const entries = (w.catalogs.commands?.entries ?? []).filter((entry) => object(entry.meta).family === 'skill').map((entry) => ({ ...entry, label: entry.id }))
  const filtered = entries.filter((entry) => `${entry.label} ${entry.id} ${String(object(entry.meta).description ?? object(entry.meta).hint ?? '')}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <section className="capability-page" aria-labelledby="skills-title">
    <header className="capability-heading"><div><h1 id="skills-title">{t('Skills')}</h1><p>{t('Reusable instructions, discovered from your runtime.')}</p></div><button disabled={!ready || state.loading} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={15} />{t('Refresh skills')}</button></header>
    <div className="capability-search"><Search size={16} /><input type="search" aria-label={t('Search skills')} placeholder={t('Search skills…')} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <p className="capability-note">{t('Choose a skill to add its command to your draft. Nothing runs until you send.')}</p>
    {!ready ? <div className="capability-empty"><BookOpen size={24} /><p>{t('Connect to bingo to discover skills.')}</p></div>
      : state.loading ? <p role="status" className="capability-empty">{t('Loading skills…')}</p>
      : state.error ? <ErrorBanner message={state.error} onRetry={() => setRevision((value) => value + 1)} />
      : !entries.length ? <p className="capability-empty">{t('No skills are available.')}</p>
      : !filtered.length ? <p className="capability-empty">{t('No matching skills.')}</p>
      : <div className="skill-grid">{filtered.map((entry) => <article className="skill-card" key={entry.id}><div className="skill-card-icon"><BookOpen size={19} /></div><div className="skill-card-body"><h2>{entry.label}</h2><p>{String(object(entry.meta).description ?? object(entry.meta).hint ?? t('Provided by the bingo runtime.'))}</p><code>/{entry.id}</code></div><button aria-label={t('Use {skill}', { skill: entry.label })} title={t('Add to draft')} onClick={() => onCompose(`/${entry.id} `)}><ArrowUpRight size={16} /></button></article>)}</div>}
  </section>
}
