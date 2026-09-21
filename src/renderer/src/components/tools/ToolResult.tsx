import type { ReactNode } from 'react'
import type { ContentPart } from '../../../../shared/rpc'
import { contentText } from '../../state/session'
import { useI18n } from '../../i18n'
import { StructuredView } from '../Content'
import { CopyButton } from '../primitives'
import { prettyJson, type ToolCallProps } from './toolPresentation'

const textLimit = 64000
export function RecordedText({ text, className = '' }: { text: string; className?: string }): React.JSX.Element {
  const { t } = useI18n()
  return <div className={`tool-recorded-text ${className}`}><CopyButton text={text} label={t('Copy recorded output')} /><pre>{text.slice(0, textLimit)}</pre>{text.length > textLimit && <p className="tool-limit-note">{t('Preview limited to {count} characters. Copy preserves the recorded text.', { count: textLimit })}</p>}</div>
}

function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }): React.JSX.Element {
  const { t } = useI18n()
  if (value === null || typeof value !== 'object') return <span className="tool-json-value">{String(value)}</span>
  if (depth >= 5) return <code>{prettyJson(value).slice(0, 2000)}…</code>
  const entries = Object.entries(value)
  return <><dl className="tool-result-fields">{entries.slice(0, 60).map(([key, child]) => <div key={key}><dt>{Array.isArray(value) ? Number(key) + 1 : key}</dt><dd><JsonValue value={child} depth={depth + 1} /></dd></div>)}</dl>{entries.length > 60 && <p className="tool-limit-note">{t('More fields are available in the raw result.')}</p>}</>
}

export function JsonResult({ text }: { text: string }): React.JSX.Element {
  if (text.length > textLimit) return <RecordedText text={text} />
  let value: unknown
  try { value = JSON.parse(text) } catch { return <RecordedText text={text} /> }
  if (!smallJsonTree(value)) return <RecordedText text={text} />
  return <div className="tool-json-result"><JsonValue value={value} /></div>
}

function smallJsonTree(value: unknown): boolean {
  const pending = [value]
  let remaining = 300
  while (pending.length) {
    if (--remaining < 0) return false
    const next = pending.pop()
    if (next && typeof next === 'object') pending.push(...Object.values(next))
  }
  return true
}

export function ToolMedia({ parts }: { parts: ContentPart[] }): React.JSX.Element {
  const { t } = useI18n()
  return <>{parts.filter((part) => part.type === 'image').slice(0, 5).map((part, index) => part.type === 'image' && /^image\/(png|jpeg|gif|webp)$/.test(part.mediaType) && part.data.length > 0 && part.data.length <= 7_000_000 && /^[A-Za-z0-9+/]*={0,2}$/.test(part.data)
    ? <img key={index} className="tool-recorded-image" loading="lazy" alt={t('Attached image {count}', { count: index + 1 })} src={`data:${part.mediaType};base64,${part.data}`} /> : null)}</>
}

export function ToolResult({ item, openLink, runAction, renderText }: ToolCallProps & { renderText?: (text: string) => ReactNode }): React.JSX.Element {
  const { t } = useI18n()
  const output = item.body.output
  return <>
    {item.body.progress && !output && <RecordedText text={item.body.progress} className="tool-progress-tail" />}
    {output && <section className="tool-recorded-result" aria-label={t('Recorded result')}>
      {output.display ? <StructuredView view={output.display} openLink={openLink} runAction={runAction} /> : renderText ? renderText(contentText(output.parts)) : <JsonResult text={contentText(output.parts)} />}
      <ToolMedia parts={output.parts} />
    </section>}
    {!output && !item.body.progress && <p className="tool-empty-result">{t('No result recorded yet.')}</p>}
  </>
}
