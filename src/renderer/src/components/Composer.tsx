import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Brain, ChevronDown, Folder, LoaderCircle, Monitor, Plus, Shield, Square, X } from './icons'
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
export function Composer({ draft, setDraft, send, stop, attach, ready, busy, sending, model, thinking, permission, models, command, commands, inputRef, queue = [], workspaceName, chooseProject, recipient }: {
  draft: Draft; setDraft: (draft: Draft) => void; send: () => void; stop: () => void; attach: () => void;
  ready: boolean; busy: boolean; sending: boolean; model: string; thinking: string; permission: string;
  models: CatalogEntry[]; command: (name: string, value: string) => void; commands: CatalogEntry[];
  inputRef: React.RefObject<HTMLTextAreaElement | null>; queue?: QueueEntry[];
  workspaceName?: string; chooseProject?: () => void; recipient?: { name: string; role: 'main' | 'agent' }
}): React.JSX.Element {
  const { t } = useI18n()
  const localizeOption = (option: PickerOption): PickerOption => ({ ...option, label: t(option.label), detail: option.detail ? t(option.detail) : undefined })
  const composing = useRef(false)
  const [suggestion, setSuggestion] = useState(0)
  const candidates = /^\/[^\s]*$/.test(draft.text) ? commands.filter((entry) => entry.id.toLowerCase().includes(draft.text.slice(1).toLowerCase())).slice(0, 7) : []
  useLayoutEffect(() => { const node = inputRef.current; if (node) { node.style.height = 'auto'; node.style.height = `${Math.min(node.scrollHeight, 220)}px` } }, [draft.text, inputRef])
  const chooseCommand = (id: string) => { setDraft({ ...draft, text: `/${id} ` }); inputRef.current?.focus(); setSuggestion(0) }
  return <div className="composer-region">
    {recipient && <div className="composer-recipient"><strong>{t('To {name}', { name: recipient.name })}</strong><span>{t(recipient.role === 'main' ? 'Main agent' : 'Sub-agent · direct message')}</span>{recipient.role === 'agent' && <small>{t('Only {name} receives this message', { name: recipient.name })}</small>}</div>}
    {queue.length > 0 && <details className="queue"><summary>{t(queue.length === 1 ? '{count} message queued' : '{count} messages queued', { count: queue.length })}</summary><ol>{queue.map((item) => <li key={item.intent}>{item.preview}</li>)}</ol></details>}
    <div className={`composer ${ready ? '' : 'unavailable'}`} data-state={sending ? 'sending' : busy ? 'working' : draft.text.trim() || draft.images.length ? 'composing' : 'idle'}>
      {candidates.length > 0 && <div className="command-suggestions" role="listbox" id="composer-commands" aria-label={t('Commands')}>{candidates.map((entry, index) => <button key={entry.id} id={`command-${index}`} role="option" aria-selected={suggestion === index} tabIndex={-1} className={suggestion === index ? 'selected' : ''} onMouseEnter={() => setSuggestion(index)} onClick={() => chooseCommand(entry.id)}><strong>/{entry.id}</strong><span>{String(object(entry.meta).hint ?? entry.label)}</span></button>)}</div>}
      {draft.images.length > 0 && <div className="attachment-list">{draft.images.map((image, index) => <div className="attachment" key={index}><img src={`data:${image.mediaType};base64,${image.data}`} alt={t('Attachment {count}', { count: index + 1 })} /><IconButton label={t('Remove attachment {count}', { count: index + 1 })} onClick={() => setDraft({ ...draft, images: draft.images.filter((_, key) => key !== index) })}><X size={13} /></IconButton></div>)}</div>}
      <textarea ref={inputRef} id="message-input" aria-label={recipient?.role === 'agent' ? t('Message {name}', { name: recipient.name }) : t('Message bingo')} aria-describedby="composer-hint" aria-controls={candidates.length ? 'composer-commands' : undefined} aria-activedescendant={candidates.length ? `command-${suggestion}` : undefined} placeholder={recipient?.role === 'agent' ? t('Send directions to {name}…', { name: recipient.name }) : t(busy ? 'Send a follow-up or steer Bingo…' : 'Ask Bingo anything, / for skills and commands')} value={draft.text} readOnly={sending} rows={2} onChange={(event) => { setDraft({ ...draft, text: event.target.value }); setSuggestion(0) }} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onKeyDown={(event) => {
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
        <IconButton label="Attach images" disabled={!ready || sending || draft.images.length >= DESKTOP_IMAGE_LIMITS.count} onClick={attach}><Plus size={19} /></IconButton>
        <ModelPicker value={model} models={models} disabled={!ready || sending} onValueChange={(value) => command('model', value)} />
        <Picker label={t('Thinking effort')} value={thinking.toLowerCase()} options={thinkingOptions.filter((option) => option.value !== '__default' || thinking === '__default').map(localizeOption)} disabled={!ready || sending} onValueChange={(value) => command('think', value)} compact side="top" icon={<Brain size={14} />} />
      </div><div className="send-controls"><span className="composer-send-hint" aria-hidden="true">{t(sending ? 'Sending…' : busy ? 'Esc to stop' : 'Enter to send')}</span>{busy && <IconButton label="Stop generation" className="stop-button" disabled={!ready} onClick={stop}><Square size={13} fill="currentColor" /></IconButton>}{(!busy || draft.text.trim() || draft.images.length > 0) && <IconButton label={busy ? 'Send follow-up' : 'Send message'} className="send-button" disabled={!ready || sending || (!draft.text.trim() && !draft.images.length)} onClick={send}><span className="send-symbol" key={sending ? 'sending' : 'send'}>{sending ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={19} />}</span></IconButton>}</div></div>
    </div>
    <div className="composer-footer">
      <div className="composer-context"><span className="local-context"><Monitor size={13} />{t('Local')}</span>{workspaceName && <button className="composer-project" onClick={chooseProject} title={workspaceName}><Folder size={13} /><span>{workspaceName}</span><ChevronDown size={11} /></button>}</div>
      <Picker label={t('Permission mode')} value={permission} options={permissionOptions.filter((option) => option.value !== '__default' || permission === '__default').map(localizeOption)} disabled={!ready || sending} onValueChange={(value) => command('permission', value)} compact side="top" icon={<Shield size={12} />} />
      <span id="composer-hint" className="sr-only">{t(sending ? 'Sending…' : busy ? 'Esc to stop' : 'Enter to send · Shift Enter for a new line')}</span>
    </div>
  </div>
}
