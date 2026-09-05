import { memo, useEffect, useRef, useState } from 'react'
import { ArrowDown, Check, ChevronRight, Circle, LoaderCircle, Terminal, Wrench } from 'lucide-react'
import type { ContentPart, Item, View } from '../../../shared/rpc'
import { contentText, itemText, type SessionProjection } from '../state/session'
import { CodeBlock, RichText, StructuredView, type OpenLink, type RunAction } from './Content'
import { CopyButton, object } from './primitives'
import { useI18n } from '../i18n'

function Pictures({ parts }: { parts: ContentPart[] }): React.JSX.Element {
  const { t } = useI18n()
  return <>{parts.map((part, index) => part.type === 'image' && /^image\/(png|jpeg|gif|webp)$/.test(part.mediaType) ? <img key={index} className="attached-image" loading="lazy" alt={t('Attached image {count}', { count: index + 1 })} src={`data:${part.mediaType};base64,${part.data}`} /> : null)}</>
}

const TranscriptItem = memo(function TranscriptItem({ item, openLink, runAction }: { item: Item; openLink: OpenLink; runAction: RunAction }): React.JSX.Element | null {
  const { t } = useI18n()
  const body = item.body
  const working = item.status === 'running' || item.status === 'pending'
  if (body.kind === 'user') return <article className="message user-message"><div className="message-label">{t('You')}</div><div className="user-prose">{contentText(body.parts)}</div><Pictures parts={body.parts} /></article>
  if (body.kind === 'assistant') return <article className="message assistant-message"><div className="message-label"><span className="bingo-mark small">b.</span><span>bingo</span></div><RichText text={body.text} openLink={openLink} />{!working && <div className="message-actions"><CopyButton text={body.text} label={t('Copy response')} />{item.status === 'interrupted' && <span>{t('Interrupted')}</span>}{item.status === 'failed' && <span className="field-error">{t('Failed')}</span>}</div>}</article>
  if (body.kind === 'reasoning') return <details className="reasoning"><summary><ChevronRight size={14} />{t(working ? 'Thinking…' : 'Thinking')}</summary><div className="reasoning-content"><RichText text={body.text} openLink={openLink} /></div></details>
  if (body.kind === 'toolCall') {
    const input = object(body.input)
    const target = [input.file_path, input.path, input.command, input.query, input.description].find((value) => typeof value === 'string')
    return <details className={`tool-call ${item.status}`}><summary><span className="tool-icon">{working ? <LoaderCircle size={15} className="spin" /> : item.status === 'completed' ? <Check size={15} /> : <Circle size={15} />}</span><span className="tool-name">{body.name}</span>{typeof target === 'string' && <span className="tool-target">{target}</span>}<span className="tool-status">{working ? t('Running') : item.status === 'completed' ? body.durationMs != null ? `${(body.durationMs / 1000).toFixed(1)}s` : t('Done') : t(item.status === 'interrupted' ? 'Interrupted' : 'Failed')}</span><ChevronRight className="disclosure" size={14} /></summary><div className="tool-detail"><CodeBlock text={typeof body.input === 'string' ? body.input : JSON.stringify(body.input, null, 2)} language={t('Input')} />{body.progress && <pre className="live-tail">{body.progress}</pre>}{body.output && <>{body.output.display ? <StructuredView view={body.output.display} openLink={openLink} runAction={runAction} /> : <pre className="tool-output">{contentText(body.output.parts)}</pre>}<Pictures parts={body.output.parts} /></>}</div></details>
  }
  if (body.kind === 'shell') return <details className="tool-call"><summary><Terminal size={15} /><span className="tool-name">{t('Shell')}</span><span className="tool-target">{body.command}</span><span className="tool-status">{body.exit == null ? t('Interrupted') : t('Exit {code}', { code: body.exit })}</span><ChevronRight className="disclosure" size={14} /></summary><CodeBlock text={`$ ${body.command}\n${body.output}`} language={body.cwd} /></details>
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

export function Timeline({ projection, openLink, runAction, loadHistory, loading }: { projection: SessionProjection; openLink: OpenLink; runAction: RunAction; loadHistory: () => void; loading: boolean }): React.JSX.Element {
  const { t } = useI18n()
  const scroll = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const previousHeight = useRef(0)
  const [showLatest, setShowLatest] = useState(false)
  const state = projection.snapshot
  useEffect(() => {
    const element = scroll.current
    if (!element) return
    if (following.current) element.scrollTop = element.scrollHeight
    else if (previousHeight.current) { element.scrollTop += element.scrollHeight - previousHeight.current; previousHeight.current = 0 }
  }, [state.items, state.turn])
  return <div className="timeline-wrap"><div className="timeline" ref={scroll} aria-label={t('Conversation')} tabIndex={0} onScroll={() => {
    const element = scroll.current
    if (!element) return
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
    setShowLatest(!following.current)
  }}><div className="transcript">
    {!projection.history.complete && <button className="history-button" disabled={loading} onClick={() => { following.current = false; previousHeight.current = scroll.current?.scrollHeight ?? 0; loadHistory() }}>{t(loading ? 'Loading history…' : 'Load earlier messages')}</button>}
    {state.items.map((item) => <TranscriptItem key={item.id} item={item} openLink={openLink} runAction={runAction} />)}
    {state.turn && !state.interactions?.length && <p className="working-state" role="status"><span className="activity-dot" />{state.turn.retrying ? t('Retrying · attempt {attempt} of {max}', { attempt: state.turn.retrying.attempt, max: state.turn.retrying.max }) : t('Working…')}</p>}
    {state.lastTurn?.kind === 'failed' && !state.turn && <p className="turn-failure" role="alert">{state.lastTurn.error.message}</p>}
    {state.lastTurn?.kind === 'interrupted' && !state.turn && <p className="system-note">{t('Turn interrupted. Completed changes have not been undone.')}</p>}
  </div></div>{showLatest && <button className="latest-button" onClick={() => { following.current = true; scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); setShowLatest(false) }}><ArrowDown size={14} /> {t('Jump to latest')}</button>}</div>
}
