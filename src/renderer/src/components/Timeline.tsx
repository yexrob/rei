import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ChevronRight, Terminal, Wrench } from './icons'
import type { ExportProgress } from '../../../shared/desktop'
import type { Item, SessionSummary, View } from '../../../shared/rpc'
import { contentText, itemText, type SessionProjection, type ToolCallItem } from '../state/session'
import { ToolCallCard } from './tools/ToolCallCard'
import { groupTimelineItems, ToolActivityGroup } from './tools/ToolActivityGroup'
import { WorkingIndicator } from './WorkingIndicator'
import { CodeBlock, RichText, StructuredView, type OpenLink, type RunAction } from './Content'
import { CopyButton, object } from './primitives'
import { useI18n } from '../i18n'

import { JournalMediaProvider, JournalPictures as Pictures } from './media/JournalMedia'

type ToolNavigation = { sessionId?: string; sessions?: SessionSummary[]; onSelectSession?: (id: string) => void }

export const TranscriptItem = memo(function TranscriptItem({ item, openLink, runAction, assistantName = 'Bingo', sessionId, sessions, onSelectSession, deferActions = false }: { item: Item; openLink: OpenLink; runAction: RunAction; assistantName?: string; deferActions?: boolean } & ToolNavigation): React.JSX.Element | null {
  const { t } = useI18n()
  const body = item.body
  const working = item.status === 'running' || item.status === 'pending'
  if (body.kind === 'user') {
    const source = body.origin.surface
    if (source === 'kernel' || source.startsWith('contributor:') || source.startsWith('hook:')) return null
    const delegated = body.origin.surface === 'agent' || body.origin.surface === 'room'
    const sender = body.origin.principal || (body.origin.surface === 'room' ? t('Room update') : t('Parent agent'))
    return <article className={`message ${delegated ? 'delegated-message' : 'user-message'}`}>
      <span className={delegated ? 'delegated-author' : 'sr-only'}>{delegated ? t('From {name}', { name: sender }) : t('You')}</span>
      {delegated && body.origin.conversation && <span className="delegated-room">{body.origin.conversation}</span>}
      <div className="user-prose">{contentText(body.parts)}</div><Pictures parts={body.parts} />
    </article>
  }
  if (body.kind === 'assistant') return <article className="message assistant-message"><span className="sr-only">{assistantName}</span><RichText text={body.text} openLink={openLink} final={!working} />{!working && !deferActions && <div className="message-actions"><CopyButton text={body.text} label={t('Copy response')} />{item.status === 'interrupted' && <span>{t('Interrupted')}</span>}{item.status === 'failed' && <span className="field-error">{t('Failed')}</span>}</div>}</article>
  if (body.kind === 'reasoning') return <details className="reasoning"><summary><ChevronRight size={14} />{t(working ? 'Thinking…' : 'Thinking')}</summary><div className="reasoning-content"><RichText text={body.text} openLink={openLink} final={!working} /></div></details>
  if (body.kind === 'toolCall') return <ToolCallCard item={item as ToolCallItem} openLink={openLink} runAction={runAction} sessionId={sessionId} sessions={sessions} onSelectSession={onSelectSession} />
  if (body.kind === 'shell') return <details className="tool-call"><summary><Terminal size={15} /><span className="tool-name">{t('Shell')}</span><span className="tool-target">{body.command}</span><span className="tool-status">{body.exit == null ? t('Interrupted') : t('Exit {code}', { code: body.exit })}</span></summary><CodeBlock text={`$ ${body.command}\n${body.output}`} language={body.cwd} /></details>
  if (body.kind === 'action') {
    const result = object(body.result)
    return <div className="action-result"><div className="activity-caption"><Wrench size={13} /> /{body.name}{working ? ` · ${t('Working…')}` : ''}</div>{object(result.view).kind ? <StructuredView view={result.view as View} openLink={openLink} runAction={runAction} /> : typeof result.message === 'string' ? <p>{result.message}</p> : body.result != null ? <pre>{JSON.stringify(body.result, null, 2)}</pre> : null}</div>
  }
  if (body.kind === 'compaction') return <details className="system-note"><summary>{t('Context compacted · {count} items summarized', { count: body.replaced })}</summary><RichText text={body.summary} openLink={openLink} /></details>
  if (body.kind === 'permissionReceipt') return <p className="system-note">{body.tool} · {t(body.decision === 'deny' ? 'Permission denied' : body.decision === 'allowSession' ? 'Allowed for this session' : 'Allowed once')}{body.feedback ? ` — ${body.feedback}` : ''}</p>
  if (body.kind === 'rewind') return <p className="system-note">{t('Rewound {count} items', { count: body.dropped })}</p>
  if (body.kind === 'notice') return <p className={`system-note ${body.level === 'error' ? 'field-error' : ''}`}>{body.text}</p>
  return <p className="system-note">{itemText(item)}</p>
})

export function Timeline({ projection, openLink, runAction, loadHistory, loading, assistantName = 'Bingo', sessions, onSelectSession, connected = true, previewReference, saveReference, exportProgress, cancelExport, childIds = [], childScanComplete = false }: { projection: SessionProjection; openLink: OpenLink; runAction: RunAction; loadHistory: () => void; loading: boolean; assistantName?: string; connected?: boolean; previewReference?: (kind: 'event' | 'history' | 'field', id: string) => void; saveReference?: (kind: 'event' | 'history' | 'field', id: string) => void; exportProgress?: ExportProgress | null; cancelExport?: () => void; childIds?: string[]; childScanComplete?: boolean } & Omit<ToolNavigation, 'sessionId'>): React.JSX.Element {
  const { t } = useI18n()
  const scroll = useRef<HTMLDivElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const inspecting = useRef(false)
  const previousHeight = useRef(0)
  const [showLatest, setShowLatest] = useState(false)
  const [childQuery, setChildQuery] = useState('')
  const state = projection.snapshot
  const missing = Boolean((!state.items.length && !projection.history.complete) || projection.unloaded?.length || projection.unloadedHistory?.length || projection.omittedFields?.length || projection.tree?.descendantsComplete === false || childIds.length || projection.historyPending)
  const processing = connected && Boolean(state.turn && !state.interactions?.length)
  const inspectTools = (target: EventTarget | null) => {
    if (!(target instanceof Element) || !target.closest('.tool-activity')) return
    // Capture before a row expands: ResizeObserver must not pull an intentional
    // inspection to the new bottom. Only Jump to latest resumes this mode.
    inspecting.current = true
    following.current = false
    setShowLatest(true)
  }
  useLayoutEffect(() => {
    const element = scroll.current
    if (!element) return
    if (following.current) element.scrollTop = element.scrollHeight
    else if (previousHeight.current) { element.scrollTop += element.scrollHeight - previousHeight.current; previousHeight.current = 0 }
  }, [state.items, state.turn])
  useEffect(() => {
    if (!transcript.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (following.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
    })
    observer.observe(transcript.current)
    return () => observer.disconnect()
  }, [])
  return <JournalMediaProvider items={state.items}><div className="timeline-wrap"><div className="timeline" ref={scroll} aria-label={t('Conversation')} tabIndex={0} onPointerDownCapture={(event) => inspectTools(event.target)} onClickCapture={(event) => inspectTools(event.target)} onFocusCapture={(event) => inspectTools(event.target)} onScroll={() => {
    const element = scroll.current
    if (!element) return
    following.current = !inspecting.current && element.scrollHeight - element.scrollTop - element.clientHeight < 100
    setShowLatest(!following.current)
  }}><div className="transcript" ref={transcript} data-working={processing} data-connected={connected}>
    {missing && <section className="unloaded-content" role="status"><strong>{t('Some content is not loaded.')}</strong>
      {!state.items.length && !projection.history.complete && <p>{t('Earlier history is not loaded.')}</p>}
      {projection.tree?.descendantsComplete === false && <p>{t('Older child sessions have not been loaded.')}</p>}
      {childIds.length > 0 && <details className="unloaded-children"><summary>{t('{count} child sessions discovered; older branches may still be incomplete.', { count: childIds.length })}</summary><input aria-label={t('Find discovered child')} value={childQuery} onChange={event => setChildQuery(event.target.value)} /><div>{childIds.filter(id => id.toLowerCase().includes(childQuery.toLowerCase())).slice(0, 50).map(id => <button key={id} disabled={!onSelectSession} aria-label={t('Open discovered child {id}', { id })} onClick={() => onSelectSession?.(id)}>{sessions?.find(session => session.id === id)?.title || id}</button>)}</div>{!childScanComplete && <p>{t('Child discovery is still incomplete.')}</p>}</details>}
      {projection.historyPending && <p>{t('History is awaiting verification.')}</p>}
      {projection.unloaded?.map(ref => <p key={ref.messageId}>{t('Recorded event {name} is not loaded ({bytes} bytes).', { name: ref.item ?? ref.eventType, bytes: ref.totalBytes })} {ref.availability.kind === 'available' && previewReference && <button onClick={() => previewReference('event', ref.messageId)}>{t('Preview raw event {name}', { name: ref.item ?? ref.eventType })}</button>}{ref.availability.kind === 'available' && saveReference && <button disabled={exportProgress?.status === 'running'} onClick={() => saveReference('event', ref.messageId)}>{t('Save full raw JSON for {name}…', { name: ref.item ?? ref.eventType })}</button>}{ref.availability.kind === 'unavailable' && <small>{ref.availability.reason}</small>}</p>)}
      {projection.unloadedHistory?.map(ref => <p className="unloaded-history-item" data-item-id={ref.id} key={`${ref.generation}:${ref.id}`}>{t('Historical item {name} is not loaded ({bytes} bytes).', { name: ref.id, bytes: ref.totalBytes })} {ref.availability.kind === 'available' && previewReference && <button onClick={() => previewReference('history', ref.id)}>{t('Preview raw item {name}', { name: ref.id })}</button>}{ref.availability.kind === 'available' && saveReference && <button disabled={exportProgress?.status === 'running'} onClick={() => saveReference('history', ref.id)}>{t('Save full raw JSON for {name}…', { name: ref.id })}</button>}{ref.availability.kind === 'unavailable' && <small>{ref.availability.reason}</small>}</p>)}
      {projection.omittedFields?.map(ref => { const name = ref.path.join('.'); return <p key={name}>{t('Snapshot field {name} is not loaded ({bytes} bytes).', { name, bytes: ref.totalBytes })} {ref.availability.kind === 'available' && previewReference && <button onClick={() => previewReference('field', name)}>{t('Preview raw field {name}', { name })}</button>}{ref.availability.kind === 'available' && saveReference && <button disabled={exportProgress?.status === 'running'} onClick={() => saveReference('field', name)}>{t('Save full raw JSON for {name}…', { name })}</button>}{ref.availability.kind === 'unavailable' && <small>{ref.availability.reason}</small>}</p> })}
      {projection.rawPreview && <div className="unloaded-preview"><p>{t('{loaded} of {total} bytes previewed; incomplete and unverified.', { loaded: projection.rawPreview.nextOffset ?? projection.rawPreview.totalBytes, total: projection.rawPreview.totalBytes })}</p><pre>{projection.rawPreview.text}</pre></div>}
      {exportProgress && <p className="reference-export-progress" aria-live="polite">{t(exportProgress.status === 'completed' ? 'Full raw JSON was saved.' : exportProgress.status === 'cancelled' ? 'Save was cancelled.' : exportProgress.status === 'failed' ? 'Saving raw JSON failed.' : 'Saving raw JSON… {done}/{total} bytes', { done: exportProgress.doneBytes, total: exportProgress.totalBytes })}{exportProgress.status === 'running' && cancelExport && <button onClick={cancelExport}>{t('Cancel save')}</button>}</p>}
    </section>}
    {!projection.history.complete && <button className="history-button" disabled={loading || !connected} onClick={() => { following.current = false; previousHeight.current = scroll.current?.scrollHeight ?? 0; loadHistory() }}>{t(loading ? 'Loading history…' : 'Load earlier messages')}</button>}
    {groupTimelineItems(state.items).map((entry) => entry.kind === 'tools'
      ? <ToolActivityGroup key={entry.key} items={entry.items} connected={connected} renderTool={(item) => <TranscriptItem item={item} openLink={openLink} runAction={runAction} assistantName={assistantName} sessionId={state.summary.id} sessions={sessions} onSelectSession={onSelectSession} />} />
      : <TranscriptItem key={entry.key} item={entry.item} openLink={openLink} runAction={runAction} assistantName={assistantName} sessionId={state.summary.id} sessions={sessions} onSelectSession={onSelectSession} deferActions={Boolean(state.turn && entry.item.turn === state.turn.id)} />)}
    {processing && <WorkingIndicator retrying={state.turn?.retrying} />}
    {state.lastTurn?.status.kind === 'failed' && !state.turn && <p className="turn-failure" role="alert">{state.lastTurn.status.error.message}</p>}
    {state.lastTurn?.status.kind === 'interrupted' && !state.turn && <p className="system-note">{t('Turn interrupted. Completed changes have not been undone.')}</p>}
  </div></div>{showLatest && <button className="latest-button" onClick={() => { inspecting.current = false; following.current = true; scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); setShowLatest(false) }}><ArrowDown size={14} /> {t('Jump to latest')}</button>}</div></JournalMediaProvider>
}
