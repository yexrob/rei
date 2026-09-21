import { useId, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, AtSign, Hash, Plus, X } from 'lucide-react'
import { DESKTOP_IMAGE_LIMITS } from '../../../shared/desktop'
import { useI18n } from '../i18n'
import type { Draft } from './Composer'
import { IconButton } from './primitives'
import './room.css'

type RoomComposerProps = {
  draft: Draft; setDraft: (draft: Draft) => void; send: () => void; attach?: () => void;
  ready: boolean; sending: boolean; roomName: string; closed: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>; members?: string[]
}

export function RoomComposer({ draft, setDraft, send, attach, ready, sending, roomName, closed, inputRef, members = [] }: RoomComposerProps): React.JSX.Element {
  const { t } = useI18n()
  const composing = useRef(false)
  const cursor = useRef<number | null>(null)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [selected, setSelected] = useState(0)
  const hintId = useId()
  const mentionId = useId()
  const destination = roomName.startsWith('#') ? roomName : `#${roomName}`
  const unavailable = !ready || sending || closed
  const query = /(?:^|\s)@([^\s@]*)$/.exec(draft.text)
  const candidates = !unavailable && !dismissed && (mentionOpen || query) ? [...new Set(members)].filter((name) => mentionOpen || name.toLowerCase().startsWith(query?.[1].toLowerCase() ?? '')) : []
  const active = Math.min(selected, Math.max(0, candidates.length - 1))
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`
    if (cursor.current !== null) { input.focus(); input.setSelectionRange(cursor.current, cursor.current); cursor.current = null }
  }, [draft.text, inputRef])
  const mention = (name: string) => {
    const input = inputRef.current
    const start = query && !mentionOpen ? draft.text.length - query[1].length - 1 : input?.selectionStart ?? draft.text.length
    const end = query && !mentionOpen ? draft.text.length : input?.selectionEnd ?? start
    const prefix = start && !/\s$/.test(draft.text.slice(0, start)) ? ' ' : ''
    const text = `${prefix}@${name} `
    cursor.current = start + text.length
    setDraft({ ...draft, text: draft.text.slice(0, start) + text + draft.text.slice(end) })
    setMentionOpen(false); setDismissed(true); setSelected(0)
  }
  const submit = () => { if (!unavailable && (draft.text.trim() || draft.images.length)) send() }
  return <div className="room-composer-region">
    <div className="room-recipient"><Hash size={13} /><span>{t('To {room}', { room: destination })}</span><small>{t('Shared with everyone in this room')}</small></div>
    <div className={`room-composer ${unavailable ? 'unavailable' : ''}`}>
      {candidates.length > 0 && <div id={mentionId} className="room-mentions" role="listbox" aria-label={t('Mention a member')}>{candidates.map((name, index) => <button id={`${mentionId}-${index}`} key={name} role="option" aria-label={`@${name}`} aria-selected={active === index} className={active === index ? 'selected' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => mention(name)}>@{name}</button>)}</div>}
      {!!draft.images.length && <div className="attachment-list">{draft.images.map((image, index) => <div className="attachment" key={index}>{/^image\/(png|jpeg|gif|webp)$/.test(image.mediaType) && <img src={`data:${image.mediaType};base64,${image.data}`} alt={t('Attachment {count}', { count: index + 1 })} />}<IconButton label={t('Remove attachment {count}', { count: index + 1 })} disabled={unavailable} onClick={() => setDraft({ ...draft, images: draft.images.filter((_, position) => position !== index) })}><X size={13} /></IconButton></div>)}</div>}
      <textarea ref={inputRef} id="message-input" aria-label={t('Message {room}', { room: destination })} aria-describedby={hintId} aria-controls={candidates.length ? mentionId : undefined} aria-activedescendant={candidates.length ? `${mentionId}-${active}` : undefined} placeholder={t('Message {room}', { room: destination })} value={draft.text} readOnly={sending || closed} rows={2} onChange={(event) => { setDraft({ ...draft, text: event.target.value }); setSelected(0); setDismissed(false) }} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onKeyDown={(event) => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Escape') { setMentionOpen(false); setDismissed(true); return }
        if (candidates.length && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(event.key) && !event.shiftKey) {
          event.preventDefault()
          if (event.key === 'ArrowDown') setSelected((active + 1) % candidates.length)
          else if (event.key === 'ArrowUp') setSelected((active + candidates.length - 1) % candidates.length)
          else mention(candidates[active])
          return
        }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
      }} />
      <div className="room-composer-toolbar"><div className="room-composer-tools">
        {attach && <IconButton label="Attach images" disabled={unavailable || draft.images.length >= DESKTOP_IMAGE_LIMITS.count} onClick={attach}><Plus size={18} /></IconButton>}
        <button className="icon-button" aria-label={t('Mention a member')} aria-expanded={candidates.length > 0} aria-controls={candidates.length ? mentionId : undefined} disabled={unavailable || !members.length} onClick={() => { setMentionOpen(!mentionOpen); setDismissed(false); setSelected(0); inputRef.current?.focus() }}><AtSign size={17} /></button>
        <span>{t('@ to ask an agent to respond')}</span>
      </div><IconButton label={t('Send to {room}', { room: destination })} className="send-button" disabled={unavailable || (!draft.text.trim() && !draft.images.length)} onClick={submit}><ArrowUp size={18} /></IconButton></div>
    </div>
    <p id={hintId} className="room-composer-note">{t(closed ? 'This room is closed. Your draft is preserved.' : sending ? 'Sending…' : 'This posts to the room, not to an individual agent.')}<span className="sr-only"> {t('Enter to send · Shift Enter for a new line')}</span></p>
  </div>
}
