import { useId, useState } from 'react'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import type { Activation, Answer, Interaction, Question } from '../../../shared/rpc'
import { CodeBlock, type OpenLink } from './Content'
import { useI18n } from '../i18n'

function QuestionFields({ question, value, onChange, index }: { question: Question; value: Answer; onChange: (answer: Answer) => void; index: number }): React.JSX.Element {
  const { t } = useI18n()
  const group = useId()
  const selected = value.kind === 'choice' ? value.ids : []
  const text = value.kind === 'text' ? value.text : value.kind === 'choice' ? value.other ?? '' : ''
  return <fieldset className="question-fields"><legend>{question.question}</legend>
    {question.options.map((option) => <label className="question-option" key={option.id}>
      <input type={question.multi ? 'checkbox' : 'radio'} name={`question-${group}-${index}`} checked={selected.includes(option.id)} onChange={() => {
        const ids = question.multi ? selected.includes(option.id) ? selected.filter((id) => id !== option.id) : [...selected, option.id] : [option.id]
        onChange({ kind: 'choice', ids, ...(text ? { other: text } : {}) })
      }} /><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}{selected.includes(option.id) && option.preview && <pre>{option.preview}</pre>}</span>
    </label>)}
    {question.freeText && <label className="field-label">{t('Your answer')}<input value={text} onChange={(event) => onChange(selected.length ? { kind: 'choice', ids: selected, other: event.target.value } : { kind: 'text', text: event.target.value })} /></label>}
  </fieldset>
}

export function InteractionPanel({ interaction, respond, openLink, disabled = false }: { interaction: Interaction; respond: (answer: Answer, activation: Activation) => Promise<void>; openLink: OpenLink; disabled?: boolean }): React.JSX.Element {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const kind = interaction.kind
  const questions: Question[] = kind.kind === 'question' ? [kind] : kind.kind === 'form' ? kind.questions : []
  const [answers, setAnswers] = useState<Answer[]>(() => questions.map(() => ({ kind: 'cancel' })))
  const send = async (answer: Answer, activation: Activation): Promise<void> => {
    if (busy || disabled) return
    setBusy(true); setError('')
    try { await respond(answer, activation) } catch (error) { setError(error instanceof Error ? error.message : t('The operation could not be completed. Try again.')) } finally { setBusy(false) }
  }
  const action = (label: string, answer: Answer, style = '') => <button type="button" className={style} disabled={busy || disabled} onClick={(event) => void send(answer, event.detail === 0 ? 'keyboard' : 'pointer')}>{t(label)}</button>
  const title = kind.kind === 'permission' ? t('Permission required') : kind.kind === 'confirm' ? kind.title : kind.kind === 'login' ? t('Sign in to {provider}', { provider: kind.provider }) : kind.kind === 'form' ? kind.title || t('A few questions') : t('Your input is needed')
  return <section className="interaction-panel" aria-label={title}>
    <div className="interaction-heading"><ShieldCheck size={17} /><h2>{title}</h2><span className="badge attention">{t('Waiting for you')}</span></div>
    {kind.kind === 'permission' && <><p><strong>{kind.tool}</strong> · {kind.summary}</p>{kind.preview?.kind === 'diff' && <CodeBlock text={kind.preview.unified} language={t('Diff')} />}{kind.preview?.kind === 'command' && <><p className="path-label">{kind.preview.cwd}</p><CodeBlock text={kind.preview.command} language={t('Command')} /></>}{kind.preview?.kind === 'url' && <p className="preserve-lines">{kind.preview.url}</p>}{kind.sessionScope && interaction.answers.includes('allowSession') && <p className="secondary">{t('Allowing for this session grants:')} <code>{kind.sessionScope}</code></p>}</>}
    {kind.kind === 'confirm' && <p>{kind.detail}</p>}
    {questions.map((question, index) => <QuestionFields key={index} index={index} question={question} value={answers[index] ?? { kind: 'cancel' }} onChange={(answer) => setAnswers((current) => current.map((value, key) => key === index ? answer : value))} />)}
    {kind.kind === 'login' && kind.flow.kind !== 'paste' && <><p>{t('Continue in your browser. Return here when sign-in is complete.')}</p>{kind.flow.kind === 'device' && <CodeBlock text={kind.flow.code} language={t('Device code')} />}<button onClick={() => { if (kind.flow.kind !== 'paste') openLink(kind.flow.url) }}>{t('Open sign-in page')} <ExternalLink size={14} /></button></>}
    {kind.kind === 'login' && kind.flow.kind === 'paste' && <p>{t('For your security, pasted credentials are not sent through a conversation. Cancel this request and use “Add API provider” in Settings, or run')} <code>bingo login {kind.provider} paste</code> {t('in your terminal.')}</p>}
    {!questions.length && kind.kind !== 'login' && interaction.answers.includes('text') && <label className="field-label">{t('Your answer')}<input autoComplete="off" value={text} onChange={(event) => setText(event.target.value)} /></label>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="button-row interaction-actions">
      {interaction.answers.includes('deny') && action('Deny', { kind: 'deny' })}
      {interaction.answers.includes('cancel') && action('Cancel', { kind: 'cancel' })}
      {interaction.answers.includes('allowSession') && kind.kind === 'permission' && kind.sessionScope && action('Allow for session', { kind: 'allowSession', scope: kind.sessionScope })}
      {interaction.answers.includes('allowOnce') && action('Allow once', { kind: 'allowOnce' }, 'primary')}
      {interaction.answers.includes('confirm') && action('Confirm', { kind: 'confirm' }, 'primary')}
      {kind.kind === 'form' && interaction.answers.includes('form') && action('Send answers', { kind: 'form', answers }, 'primary')}
      {kind.kind === 'question' && answers[0]?.kind !== 'cancel' && interaction.answers.includes(answers[0].kind) && action('Send answer', answers[0], 'primary')}
      {!questions.length && text.trim() && interaction.answers.includes('text') && action('Send answer', { kind: 'text', text }, 'primary')}
      {busy && <span role="status">{t('Sending response…')}</span>}
    </div>
  </section>
}
