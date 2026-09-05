import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Brain, Paperclip, Shield, Square, X } from 'lucide-react'
import type { CatalogEntry, Image, QueueEntry } from '../../../shared/rpc'
import { DESKTOP_IMAGE_LIMITS } from '../../../shared/desktop'
import { IconButton, object } from './primitives'
import { ModelPicker, Picker, type PickerOption } from './Picker'
import { useI18n } from '../i18n'

const thinkingOptions: PickerOption[] = [
  { value: '__default', label: 'Default thinking', detail: 'Use the runtime’s configured effort', disabled: true },
  { value: 'off', label: 'Off', detail: 'Do not request extended reasoning' },
  { value: 'minimal', label: 'Minimal', detail: 'A quick answer with minimal reasoning' },
  { value: 'low', label: 'Low', detail: 'Light reasoning for straightforward tasks' },
  { value: 'medium', label: 'Medium', detail: 'Balance depth and response time' },
  { value: 'high', label: 'High', detail: 'More reasoning for complex work' },
  { value: 'xhigh', label: 'Extra high', detail: 'Extended reasoning for harder problems' },
  { value: 'max', label: 'Maximum', detail: 'The highest effort the model supports' }
]
const permissionOptions: PickerOption[] = [
  { value: '__default', label: 'Runtime permissions', detail: 'Use bingo’s configured policy', disabled: true },
  { value: 'default', label: 'Ask for permission', detail: 'Confirm tools that can change your workspace' },
  { value: 'acceptEdits', label: 'Allow workspace edits', detail: 'Approve in-scope file edits automatically' },
  { value: 'plan', label: 'Plan · read only', detail: 'Explore and plan without making changes' },
  { value: 'dontAsk', label: 'Deny unapproved tools', detail: 'Deny anything that would need approval' },
  { value: 'bypassPermissions', label: 'Bypass permissions', detail: 'Run tools without routine approval prompts' }
]

export type Draft = { text: string; images: Image[] }
export const emptyDraft: Draft = { text: '', images: [] }
export function Composer({ draft, setDraft, send, stop, attach, ready, busy, sending, model, thinking, permission, models, command, commands, inputRef, queue = [] }: {
  draft: Draft; setDraft: (draft: Draft) => void; send: () => void; stop: () => void; attach: () => void;
  ready: boolean; busy: boolean; sending: boolean; model: string; thinking: string; permission: string;
  models: CatalogEntry[]; command: (name: string, value: string) => void; commands: CatalogEntry[];
  inputRef: React.RefObject<HTMLTextAreaElement | null>; queue?: QueueEntry[]
}): React.JSX.Element {
  const { t } = useI18n()
  const localizeOption = (option: PickerOption): PickerOption => ({ ...option, label: t(option.label), detail: option.detail ? t(option.detail) : undefined })
  const composing = useRef(false)
  const [suggestion, setSuggestion] = useState(0)
  const candidates = /^\/[^\s]*$/.test(draft.text) ? commands.filter((entry) => entry.id.toLowerCase().includes(draft.text.slice(1).toLowerCase())).slice(0, 7) : []
  useLayoutEffect(() => { const node = inputRef.current; if (node) { node.style.height = 'auto'; node.style.height = `${Math.min(node.scrollHeight, 220)}px` } }, [draft.text, inputRef])
  const chooseCommand = (id: string) => { setDraft({ ...draft, text: `/${id} ` }); inputRef.current?.focus(); setSuggestion(0) }
  return <div className="composer-region">
    {queue.length > 0 && <details className="queue"><summary>{t(queue.length === 1 ? '{count} message queued' : '{count} messages queued', { count: queue.length })}</summary><ol>{queue.map((item) => <li key={item.intent}>{item.preview}</li>)}</ol></details>}
    <div className={`composer ${ready ? '' : 'unavailable'}`}>
      {candidates.length > 0 && <div className="command-suggestions" role="listbox" id="composer-commands" aria-label={t('Commands')}>{candidates.map((entry, index) => <button key={entry.id} id={`command-${index}`} role="option" aria-selected={suggestion === index} tabIndex={-1} className={suggestion === index ? 'selected' : ''} onMouseEnter={() => setSuggestion(index)} onClick={() => chooseCommand(entry.id)}><strong>/{entry.id}</strong><span>{String(object(entry.meta).hint ?? entry.label)}</span></button>)}</div>}
      {draft.images.length > 0 && <div className="attachment-list">{draft.images.map((image, index) => <div className="attachment" key={index}><img src={`data:${image.mediaType};base64,${image.data}`} alt={t('Attachment {count}', { count: index + 1 })} /><IconButton label={t('Remove attachment {count}', { count: index + 1 })} onClick={() => setDraft({ ...draft, images: draft.images.filter((_, key) => key !== index) })}><X size={13} /></IconButton></div>)}</div>}
      <textarea ref={inputRef} id="message-input" aria-label={t('Message bingo')} aria-describedby="composer-hint" aria-controls={candidates.length ? 'composer-commands' : undefined} aria-activedescendant={candidates.length ? `command-${suggestion}` : undefined} placeholder={t(busy ? 'Add a follow-up while bingo works…' : 'Ask anything, or / for commands…')} value={draft.text} readOnly={sending} rows={2} onChange={(event) => { setDraft({ ...draft, text: event.target.value }); setSuggestion(0) }} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onKeyDown={(event) => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
        if (candidates.length && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(event.key) && !event.shiftKey) {
          event.preventDefault()
          if (event.key === 'ArrowDown') setSuggestion((suggestion + 1) % candidates.length)
          else if (event.key === 'ArrowUp') setSuggestion((suggestion - 1 + candidates.length) % candidates.length)
          else chooseCommand(candidates[suggestion]?.id ?? candidates[0].id)
          return
        }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (ready && !sending && (draft.text.trim() || draft.images.length)) send() }
      }} />
      <div className="composer-toolbar"><div className="composer-tools">
        <IconButton label="Attach images" disabled={!ready || sending || draft.images.length >= DESKTOP_IMAGE_LIMITS.count} onClick={attach}><Paperclip size={17} /></IconButton>
        <ModelPicker value={model} models={models} disabled={!ready || sending} onValueChange={(value) => command('model', value)} />
        <Picker label={t('Thinking effort')} value={thinking.toLowerCase()} options={thinkingOptions.filter((option) => option.value !== '__default' || thinking === '__default').map(localizeOption)} disabled={!ready || sending} onValueChange={(value) => command('think', value)} compact side="top" icon={<Brain size={14} />} />
      </div><div className="send-controls">{busy && <IconButton label="Stop generation" className="stop-button" onClick={stop}><Square size={13} fill="currentColor" /></IconButton>}<IconButton label={busy ? 'Send follow-up' : 'Send message'} className="send-button" disabled={!ready || sending || (!draft.text.trim() && !draft.images.length)} onClick={send}><ArrowUp size={19} /></IconButton></div></div>
    </div>
    <div className="composer-footer"><Picker label={t('Permission mode')} value={permission} options={permissionOptions.filter((option) => option.value !== '__default' || permission === '__default').map(localizeOption)} disabled={!ready || sending} onValueChange={(value) => command('permission', value)} compact side="top" icon={<Shield size={12} />} /><span id="composer-hint">{t(sending ? 'Sending…' : 'Enter to send · Shift Enter for a new line')}</span></div>
  </div>
}
