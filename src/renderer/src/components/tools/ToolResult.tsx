import { useState, type ReactNode } from 'react'
import type { ContentPart } from '../../../../shared/rpc'
import { contentText } from '../../state/session'
import { useI18n } from '../../i18n'
import { StructuredView, type OpenLink } from '../Content'
import { CopyButton } from '../primitives'
import { prettyJson, safeWebUrl, type ToolCallProps } from './toolPresentation'

const textLimit = 64000
export function RecordedText({ text, className = '', copy = true }: { text: string; className?: string; copy?: boolean }): React.JSX.Element {
  const { t } = useI18n()
  return <div className={`tool-recorded-text ${className}`}>{copy && <CopyButton text={text} label={t('Copy recorded output')} />}<pre role="region" tabIndex={0} aria-label={t('Recorded result')}>{text.slice(0, textLimit)}</pre>{text.length > textLimit && <p className="tool-limit-note">{t('Preview limited to {count} characters. Copy preserves the recorded text.', { count: textLimit })}</p>}</div>
}

function JsonValue({ value, depth = 0, openLink }: { value: unknown; depth?: number; openLink?: OpenLink }): React.JSX.Element {
  const { t } = useI18n()
  if (value === null || typeof value !== 'object') {
    const url = safeWebUrl(value)
    return url && openLink ? <button type="button" className="tool-value-link" onClick={() => openLink(url)}>{url}</button> : <span className="tool-json-value">{value === '' ? '""' : String(value)}</span>
  }
  if (depth >= 5) return <code>{prettyJson(value).slice(0, 2000)}…</code>
  const entries = Object.entries(value)
  if (!entries.length) return <code>{Array.isArray(value) ? '[]' : '{}'}</code>
  // Only homogeneous records become a table. Arbitrary JSON is never a UI/action schema.
  const columns = Array.isArray(value) && value[0] && typeof value[0] === 'object' && !Array.isArray(value[0]) ? Object.keys(value[0]) : []
  if (columns.length > 0 && columns.length <= 8 && Array.isArray(value) && value.every(row => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length === columns.length && columns.every(key => Object.hasOwn(row, key) && (row[key] === null || typeof row[key] !== 'object')))) {
    return <><table className="tool-result-table"><thead><tr>{columns.map(key => <th scope="col" key={key}>{key}</th>)}</tr></thead><tbody>{value.slice(0, 60).map((row, index) => <tr key={index}>{columns.map(key => <td key={key}><JsonValue value={row[key]} openLink={openLink} depth={depth + 1} /></td>)}</tr>)}</tbody></table>{value.length > 60 && <p className="tool-limit-note">{t('More fields are available in the raw result.')}</p>}</>
  }
  return <><dl className="tool-result-fields">{entries.slice(0, 60).map(([key, child]) => <div key={key}><dt>{Array.isArray(value) ? Number(key) + 1 : key}</dt><dd><JsonValue value={child} depth={depth + 1} openLink={openLink} /></dd></div>)}</dl>{entries.length > 60 && <p className="tool-limit-note">{t('More fields are available in the raw result.')}</p>}</>
}

function StructuredFallback({ text }: { text: string }): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return <div className="tool-structured-fallback">
    <div className="tool-section-heading"><span>{t('Recorded content · {count} characters', { count: text.length })}</span><CopyButton text={text} label={t('Copy recorded output')} /></div>
    <p className="tool-limit-note">{t('Structured content is summarized for display. Expand a bounded preview or copy the complete recorded text.')}</p>
    <details onToggle={event => setOpen(event.currentTarget.open)}><summary>{t('Inspect recorded content')}</summary>{open && <RecordedText text={text} copy={false} />}</details>
  </div>
}

export function JsonResult({ text, openLink }: { text: string; openLink?: OpenLink }): React.JSX.Element {
  const { t } = useI18n()
  if (text === '') return <p className="tool-empty-result">{t('Empty recorded content.')}</p>
  // A framing hint only: do not parse an unbounded payload to build the summary.
  // Ordinary long prose stays directly readable. Raw input remains exact either way.
  if (text.length > textLimit) return /^\s*[\[{]/.test(text) && /[\]}]\s*$/.test(text) ? <StructuredFallback text={text} /> : <RecordedText text={text} />
  let value: unknown
  try { value = JSON.parse(text) } catch { return <RecordedText text={text} /> }
  if (!smallJsonTree(value)) return <StructuredFallback text={text} />
  return <div className="tool-json-result"><CopyButton text={text} label={t('Copy recorded output')} /><JsonValue value={value} openLink={openLink} /></div>
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
  const images = parts.filter(part => part.type === 'image')
  const safe = images.filter(part => /^image\/(png|jpeg|gif|webp)$/.test(part.mediaType) && part.data.length > 0 && part.data.length <= 7_000_000 && /^[A-Za-z0-9+/]*={0,2}$/.test(part.data))
  return <>{safe.slice(0, 5).map((part, index) => <img key={index} className="tool-recorded-image" loading="lazy" alt={t('Attached image {count}', { count: index + 1 })} src={`data:${part.mediaType};base64,${part.data}`} />)}
    {safe.length < images.length && <p className="tool-limit-note">{t('Some recorded images cannot be previewed safely. See the raw result.')}</p>}
    {safe.length > 5 && <p className="tool-limit-note">{t('More recorded images are available in the raw result.')}</p>}
  </>
}

export function ToolResult({ item, openLink, runAction, renderText }: ToolCallProps & { renderText?: (text: string) => ReactNode }): React.JSX.Element {
  const { t } = useI18n()
  const output = item.body.output
  const text = contentText(output?.parts ?? [])
  const imageOnly = text === '' && output?.parts.some(part => part.type === 'image')
  return <>
    {item.body.progress && !output && <RecordedText text={item.body.progress} className="tool-progress-tail" />}
    {output && <section className="tool-recorded-result" aria-label={t('Recorded result')}>
      {output.display ? <StructuredView view={output.display} openLink={openLink} runAction={runAction} /> : imageOnly ? null : text === '' ? <p className="tool-empty-result">{t('Empty recorded content.')}</p> : renderText ? renderText(text) : <JsonResult text={text} openLink={openLink} />}
      <ToolMedia parts={output.parts} />
    </section>}
    {!output && !item.body.progress && <p className="tool-empty-result">{t('No result recorded yet.')}</p>}
  </>
}
