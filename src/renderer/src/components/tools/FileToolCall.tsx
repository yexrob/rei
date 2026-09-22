import { useMemo, useState } from 'react'
import { FileCode2, FileImage, FileText, ExternalLink, type IconComponent } from '../icons'
import type { ToolCallItem } from '../../state/session'
import type { OpenLink, RunAction } from '../Content'
import { basename } from '../primitives'
import { useI18n } from '../../i18n'
import { ToolCallFrame } from './ToolCallFrame'
import { recordedFile } from './recordedFile'
import { parseRecordedDiff, type DiffCounts } from './recordedDiff'
import { RecordedFileContent, RecordedFilePreview } from './RecordedFilePreview'
import { RecordedText } from './ToolResult'
import { ToolFields } from './ToolFields'
import { inputRecord } from './toolPresentation'
import './file-tools.css'

function fileIcon(path: string): IconComponent {
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(path)) return FileImage
  if (/\.(tsx?|jsx?|html?|css|scss|json|rs|py|go|sh|ya?ml|toml|xml|vue|svelte)$/i.test(path)) return FileCode2
  return FileText
}

function ChangeCounts({ counts }: { counts: DiffCounts }): React.JSX.Element {
  const { t } = useI18n()
  return <span className="file-change-counts" aria-label={t('{added} lines added, {removed} lines removed', counts)}><span className="file-additions">+{counts.added}</span><span className="file-deletions">−{counts.removed}</span></span>
}

export function FileToolCall({ item }: { item: ToolCallItem; openLink: OpenLink; runAction: RunAction }): React.JSX.Element {
  const { t } = useI18n()
  const record = useMemo(() => recordedFile(item), [item])
  const diffText = record.tabs.find((tab) => tab.kind === 'diff')?.text
  const counts = useMemo(() => diffText === undefined ? undefined : parseRecordedDiff(diffText).counts, [diffText])
  const [preview, setPreview] = useState(false)
  const fileName = record.path ? basename(record.path) : t('Unknown file')
  const target = <span title={record.path}>{fileName}</span>
  return <><ToolCallFrame item={item} icon={fileIcon(record.path)} title={t(item.body.name === 'Read' ? 'Read file' : item.body.name === 'Write' ? 'Write file' : 'Edit file')} summary={target} actions={<>{counts && <ChangeCounts counts={counts} />}{record.tabs.length > 0 && <button type="button" className="tool-link-action" title={t('Preview {file}', { file: fileName })} aria-label={t('Preview {file}', { file: fileName })} onClick={() => setPreview(true)}><ExternalLink size={14} aria-hidden="true" /></button>}</>}>
    <div className="file-record-detail">
      {record.tabs.length > 0 ? <RecordedFileContent record={record} /> : <><p className="file-record-path">{record.path}</p><p className="recorded-notice">{t('No recorded file content is available for this call.')}</p></>}
      {record.receipt && (item.body.name !== 'Read' || item.body.output?.isError) && <RecordedText text={record.receipt} />}
      {item.body.name === 'Read' && <ToolFields input={inputRecord(item.body.input)} fields={[[ 'offset', 'Requested offset' ], [ 'limit', 'Requested line limit' ]]} />}
    </div>
  </ToolCallFrame>{preview && record.tabs.length > 0 && <RecordedFilePreview record={record} onClose={() => setPreview(false)} />}</>
}
