import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, GitCompareArrows, RotateCw, X } from './icons'
import type { ReviewFile, ReviewScope, ReviewSnapshot } from '../../../shared/review'
import { useI18n } from '../i18n'
import { IconButton } from './primitives'
import { DiffView } from './DiffView'
import './review.css'

type Props = { visible: boolean; workspace: string | null; onClose(): void; onCompose(text: string): void; onCount?(count: number | null): void; width?: number | null }
type Loaded = { workspace: string | null; scope: ReviewScope; value: ReviewSnapshot }
export function ReviewPanel({ visible, workspace, onClose, onCompose, onCount, width }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [scope, setScope] = useState<ReviewScope>('unstaged')
  const [revision, setRevision] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const value = loaded?.workspace === workspace && loaded.scope === scope ? loaded.value : null
  // The header toggle shows the last loaded unstaged count; no extra Git work is done for it.
  const count = value?.status === 'ready' && scope === 'unstaged' ? value.totalFiles : null
  const report = useRef(onCount); report.current = onCount
  useEffect(() => { if (count !== null) report.current?.(count) }, [count])
  useEffect(() => { report.current?.(null) }, [workspace])
  useEffect(() => {
    if (!visible) return
    let alive = true
    setLoaded(null); setError(null)
    const api = window.bingoReview
    if (!api) { setLoading(false); return }
    setLoading(true)
    void api.snapshot({ scope }).then((result) => {
      if (!alive) return
      if (result.ok) setLoaded({ workspace, scope, value: result.value })
      else setError(result.error.message)
    }).catch(() => { if (alive) setError('Git review could not be loaded. Refresh to try again.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [visible, workspace, scope, revision])
  return <section className="review-panel" aria-label={t('Review changes')} hidden={!visible} style={width ? { '--review-width': `${width}px` } as React.CSSProperties : undefined}>
    <header className="review-heading"><span><GitCompareArrows size={16} />{t('Changes')}</span><div>
      <IconButton label={t('Refresh changes')} disabled={loading || !window.bingoReview} onClick={() => setRevision((value) => value + 1)}><RotateCw size={15} /></IconButton>
      <IconButton label={t('Close changes')} onClick={onClose}><X size={16} /></IconButton>
    </div></header>
    <div className="review-toolbar"><div className="review-scopes" aria-label={t('Change scope')}>
      {(['unstaged', 'staged'] as const).map((item) => <button type="button" key={item} aria-pressed={scope === item} disabled={loading} onClick={() => setScope(item)}>{t(item === 'unstaged' ? 'Unstaged' : 'Staged')}</button>)}
    </div>{value?.status === 'ready' && <span className="review-total">{t(value.totalFiles === 1 ? '1 file' : '{count} files', { count: value.totalFiles })}<span className="review-added">+{value.additions}</span><span className="review-removed">−{value.deletions}</span></span>}</div>
    <div className="review-body" aria-busy={loading}>
      {!window.bingoReview && <p className="review-empty">{t('Git review is available in the desktop app.')}</p>}
      {loading && <p className="review-empty" role="status">{t('Loading changes…')}</p>}
      {error && <p className="review-error" role="alert">{t(error)}</p>}
      {value?.status === 'no-workspace' && <p className="review-empty">{t('Choose a workspace to review changes.')}</p>}
      {value?.status === 'not-repository' && <p className="review-empty">{t('This workspace is not a Git repository.')}</p>}
      {value?.status === 'ready' && <>
        {value.totalFiles === 0 && <p className="review-empty">{t(scope === 'unstaged' ? 'No unstaged changes.' : 'No staged changes.')}</p>}
        {value.truncated && <p className="review-notice" role="status">{t('Preview limit reached. Some files or patches are omitted.')}</p>}
        {value.files.map((file, index) => <FileDiff key={`${workspace}:${scope}:${revision}:${file.path}`} file={file} scope={scope} initiallyOpen={index === 0} onCompose={onCompose} />)}
      </>}
    </div>
    <footer className="review-footer">{t('Read-only · Tracked files only. Untracked files are not included.')}</footer>
  </section>
}

function FileDiff({ file, scope, initiallyOpen, onCompose }: { file: ReviewFile; scope: ReviewScope; initiallyOpen: boolean; onCompose(text: string): void }): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(initiallyOpen)
  const [feedback, setFeedback] = useState('')
  const [line, setLine] = useState('')
  const validLine = !line || (/^[1-9]\d{0,6}$/.test(line))
  const draft = (): void => {
    if (!feedback.trim() || !validLine) return
    const scopeLabel = t(scope === 'unstaged' ? 'Unstaged' : 'Staged').toLowerCase()
    onCompose(`${line ? t('Please review {path} ({scope}, new line {line}).', { path: file.path, scope: scopeLabel, line }) : t('Please review {path} ({scope}).', { path: file.path, scope: scopeLabel })}\n\n${feedback.trim()}`)
    setFeedback(''); setLine('')
  }
  return <article className="review-file">
    <button type="button" className="review-file-heading" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span className="review-path" title={file.path}>{file.path}</span>
      {file.binary ? <span className="review-file-count">{t('Binary')}</span> : <span className="review-file-count"><span className="review-added">+{file.additions}</span><span className="review-removed">−{file.deletions}</span></span>}
    </button>
    {open && <div className="review-file-content">
      {file.binary ? <p className="review-notice">{t('Binary file — preview unavailable.')}</p> : file.truncated ? <p className="review-notice">{t('This patch exceeds the preview limit.')}</p> : file.patch ? <DiffView className="review-diff" text={file.patch} lineNumbers label={t('Diff for {path}', { path: file.path })} /> : <p className="review-notice">{t('No text patch available.')}</p>}
      <form className="review-feedback" onSubmit={(event) => { event.preventDefault(); draft() }}>
        <textarea aria-label={t('Feedback for {path}', { path: file.path })} placeholder={t('Leave feedback for Bingo…')} value={feedback} maxLength={8000} rows={2} onChange={(event) => setFeedback(event.target.value)} />
        <div><input type="number" min={1} max={9999999} step={1} aria-label={t('New line number (optional)')} placeholder={t('Line (optional)')} value={line} onChange={(event) => setLine(event.target.value)} /><button type="submit" disabled={!feedback.trim() || !validLine}>{t('Add to thread')}</button></div>
        <small>{t('Adds an unsent draft. No files will be changed.')}</small>
      </form>
    </div>}
  </article>
}
