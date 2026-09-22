import { useMemo, useState } from 'react'
import { CopyButton, Modal } from '../primitives'
import { useI18n } from '../../i18n'
import type { RecordedFile, RecordedTab } from './recordedFile'
import { parseRecordedDiff } from './recordedDiff'

function SourcePreview({ tab }: { tab: RecordedTab }): React.JSX.Element {
  const { t } = useI18n()
  return <><div className="recorded-source" aria-label={t(tab.label)}>{tab.rows?.map((row, index) => <div className="recorded-line" key={index}><span className="recorded-line-number" aria-hidden="true">{row.number ?? ''}</span><code>{row.text || '\u200b'}</code></div>)}</div>{tab.truncated && <p className="recorded-limit">{t('Preview shortened for display. The journal may contain more content.')}</p>}</>
}

function DiffPreview({ text }: { text: string }): React.JSX.Element {
  const { t } = useI18n()
  const diff = useMemo(() => parseRecordedDiff(text), [text])
  return <><div className="recorded-source recorded-diff" aria-label={t('Recorded diff')}>{diff.rows.map((row, index) => <div key={index} className={`recorded-line ${row.kind}`}><span className="recorded-line-number" aria-hidden="true">{row.oldLine ?? ''}</span><span className="recorded-line-number" aria-hidden="true">{row.newLine ?? ''}</span><code>{row.text || '\u200b'}</code></div>)}</div>{diff.truncated && <p className="recorded-limit">{t('Preview shortened for display. The journal may contain more content.')}</p>}</>
}

function TabContent({ tab }: { tab: RecordedTab }): React.JSX.Element {
  const { t } = useI18n()
  if (tab.kind === 'diff') return <DiffPreview text={tab.text} />
  if (tab.kind === 'image') return <div className="recorded-image"><img src={tab.image} alt={t('Recorded image')} /></div>
  return <SourcePreview tab={tab} />
}

export function RecordedFileContent({ record }: { record: RecordedFile }): React.JSX.Element {
  const { t } = useI18n()
  const [selected, setSelected] = useState(0)
  const tab = record.tabs[selected] ?? record.tabs[0]
  const numbers = tab?.label === 'Recorded read' ? tab.rows?.flatMap(row => row.number === undefined ? [] : [row.number]) ?? [] : []
  return <section className="recorded-file-preview">
    <p className="recorded-file-path">{record.path || t('Unknown file')}</p>
    <p className="recorded-notice">{t('Journal snapshot only — not the current file on disk. Source is never executed.')}</p>
    <div className="recorded-toolbar"><div className="recorded-tabs" role="group" aria-label={t('Preview content')}>{record.tabs.map((candidate, index) => <button type="button" key={index} aria-pressed={selected === index} onClick={() => setSelected(index)}>{t(candidate.label)}</button>)}</div>{tab && tab.kind !== 'image' && <CopyButton text={tab.text} label={t('Copy preview content')} />}</div>
    {tab?.label.endsWith('snippet') && <p className="recorded-notice">{t('Requested replacement snippets, not a complete file. Line numbers are relative to each snippet.')}</p>}
    {numbers.length > 0 && <p className="recorded-range">{t('Recorded lines {start}–{end}', { start: numbers[0], end: numbers.at(-1)! })}</p>}
    {tab && tab.kind !== 'image' && tab.text === '' && <p className="recorded-notice">{t('Empty recorded content.')}</p>}
    {tab && <TabContent tab={tab} />}
  </section>
}

export function RecordedFilePreview({ record, onClose }: { record: RecordedFile; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n()
  return <Modal title={t('Recorded file preview')} onClose={onClose} wide><RecordedFileContent record={record} /></Modal>
}
