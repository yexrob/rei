import { Fragment, memo, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, MessageSquare, PanelRight, Pin } from 'lucide-react'
import type { Item, SessionSummary } from '../../../shared/rpc'
import { contentText, type SessionProjection } from '../state/session'
import { roomMetadata } from '../state/collaboration'
import { useI18n, type Translator } from '../i18n'
import { RichText, type OpenLink, type RunAction } from './Content'
import { CollaborationAvatar } from './CollaborationAvatar'
import { TranscriptItem } from './Timeline'
import './room.css'
import { JournalMediaProvider, JournalPictures as RoomPictures } from './media/JournalMedia'

type RoomProps = {
  projection: SessionProjection; sessions: SessionSummary[]; onSelectAgent: (id: string) => void;
  openLink: OpenLink; runAction: RunAction; loadHistory: () => void; loading: boolean; composer?: ReactNode
}

function postAuthor(item: Item, t: Translator): string {
  if (item.body.kind !== 'user') return t('System message')
  const { origin } = item.body
  if ((origin.surface === 'agent' || origin.surface === 'room') && origin.principal) return origin.principal
  if (origin.surface === 'desktop' && !origin.principal) return t('You')
  return t('Unknown author')
}

function validDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

const RoomPost = memo(function RoomPost({ item, openLink, runAction, sessionId, sessions, onSelectSession }: { item: Item; openLink: OpenLink; runAction: RunAction; sessionId: string; sessions: SessionSummary[]; onSelectSession: (id: string) => void }): React.JSX.Element {
  const { t, locale } = useI18n()
  const author = postAuthor(item, t)
  const time = validDate(item.startedAt)
  const body = item.body
  const working = item.status === 'running' || item.status === 'pending'
  return <article className="room-post" data-item-id={item.id}>
    <CollaborationAvatar name={author} size="medium" />
    <div className="room-post-content"><div className="room-attribution"><strong className="room-author">{author}</strong>{time ? <time dateTime={time.toISOString()} title={time.toLocaleString(locale)}>{time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time> : <span className="room-time">{t('Unknown time')}</span>}</div>
      {body.kind === 'user' ? <><RichText text={contentText(body.parts.filter((part) => part.type !== 'image'))} openLink={openLink} final={!working} /><RoomPictures parts={body.parts} /></> : body.kind === 'assistant' ? <RichText text={body.text} openLink={openLink} final={!working} /> : <TranscriptItem item={item} openLink={openLink} runAction={runAction} sessionId={sessionId} sessions={sessions} onSelectSession={onSelectSession} />}
      {item.status === 'failed' && <span className="field-error">{t('Failed')}</span>}{item.status === 'interrupted' && <span className="room-time">{t('Interrupted')}</span>}
    </div>
  </article>
})

function memberSession(room: SessionSummary, sessions: SessionSummary[], member: string): SessionSummary | undefined {
  const parent = room.parent?.session
  if (!parent) return undefined
  if (member.toLowerCase() === 'parent') return sessions.find((session) => session.id === parent)
  return sessions.find((session) => session.parent?.session === parent && session.driver !== 'log' && session.title === member)
}

function RoomDetails({ projection, sessions, onSelectAgent, id }: Pick<RoomProps, 'projection' | 'sessions' | 'onSelectAgent'> & { id: string }): React.JSX.Element {
  const { t } = useI18n()
  const { purpose, members } = roomMetadata(projection.snapshot)
  return <aside id={id} className="room-details" aria-label={t('Room details')}>
    <h3>{t('Members')} <span>{members.length}</span></h3>
    <ul className="room-members">{members.map((member) => {
      const session = memberSession(projection.snapshot.summary, sessions, member)
      return <li key={member}><button disabled={!session} onClick={() => session && onSelectAgent(session.id)}>
        <CollaborationAvatar name={member} main={member.toLowerCase() === 'parent'} size="small" />
        <span><strong>{member}</strong><small>{!session ? t('Unavailable') : member.toLowerCase() === 'parent' ? t('Room owner') : t('Agent')}</small></span>
      </button></li>
    })}</ul>
    {!members.length && <p className="room-context-note">{t('No members listed')}</p>}
    <section className="room-about"><h3>{t('About this room')}</h3><p>{purpose || t('No purpose recorded')}</p></section>
    <div className="room-context-note"><MessageSquare size={16} /><p>{t('A room is a shared conversation, not a model. Mention a member when you need their reply.')}</p></div>
  </aside>
}

function RoomStream({ projection, openLink, runAction, loadHistory, loading, sessions, onSelectAgent }: Pick<RoomProps, 'projection' | 'openLink' | 'runAction' | 'loadHistory' | 'loading' | 'sessions' | 'onSelectAgent'>): React.JSX.Element {
  const { t, locale } = useI18n()
  const scroll = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const previousHeight = useRef<number | null>(null)
  const [showLatest, setShowLatest] = useState(false)
  const items = projection.snapshot.items
  useEffect(() => {
    const element = scroll.current
    if (!element) return
    if (previousHeight.current !== null) { element.scrollTop += element.scrollHeight - previousHeight.current; previousHeight.current = null }
    else if (following.current) element.scrollTop = element.scrollHeight
  }, [items])
  return <div className="room-stream-wrap"><div ref={scroll} className="room-stream" aria-label={t('Room conversation')} tabIndex={0} onScroll={() => {
    const element = scroll.current
    if (!element) return
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
    setShowLatest(!following.current)
  }}>
    {!projection.history.complete && <button className="history-button" disabled={loading} onClick={() => { following.current = false; previousHeight.current = scroll.current?.scrollHeight ?? null; loadHistory() }}>{t(loading ? 'Loading history…' : 'Load earlier messages')}</button>}
    {items.map((item, index) => {
      const day = validDate(item.startedAt)?.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
      const previous = index ? validDate(items[index - 1].startedAt)?.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : undefined
      return <Fragment key={item.id}>{day && day !== previous && <div className="room-date"><span>{day}</span></div>}<RoomPost item={item} openLink={openLink} runAction={runAction} sessionId={projection.snapshot.summary.id} sessions={sessions} onSelectSession={onSelectAgent} /></Fragment>
    })}
    {!items.length && <p className="room-empty">{t('No messages yet')}</p>}
  </div>{showLatest && <button className="latest-button" onClick={() => { following.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; setShowLatest(false) }}><ArrowDown size={14} />{t('Jump to latest')}</button>}</div>
}

export function RoomConversation({ projection, sessions, onSelectAgent, composer, ...stream }: RoomProps): React.JSX.Element {
  const { t } = useI18n()
  const metadata = roomMetadata(projection.snapshot)
  const detailsId = useId()
  const [details, setDetails] = useState(() => typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1000px)').matches)
  return <JournalMediaProvider items={projection.snapshot.items}><section className="room-conversation">
    <div className="room-message-column"><header className="room-purpose"><Pin size={13} /><span title={metadata.purpose}>{metadata.purpose || t('No purpose recorded')}</span>{metadata.closed && <span className="badge">{t('Closed')}</span>}<button aria-label={t('Room details')} aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails(!details)}><PanelRight size={16} /></button></header>
      <RoomStream key={projection.snapshot.summary.id} projection={projection} sessions={sessions} onSelectAgent={onSelectAgent} {...stream} />
      {composer}
    </div>
    {details && <RoomDetails id={detailsId} projection={projection} sessions={sessions} onSelectAgent={onSelectAgent} />}
  </section></JournalMediaProvider>
}
