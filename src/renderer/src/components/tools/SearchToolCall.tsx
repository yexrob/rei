import { FileSearch, Search } from '../icons'
import { useI18n } from '../../i18n'
import { CopyButton } from '../primitives'
import { ToolCallFrame } from './ToolCallFrame'
import { ToolFields } from './ToolFields'
import { ToolResult } from './ToolResult'
import { compactValue, inputRecord, resultLines, type ToolCallProps } from './toolPresentation'

function SearchResults({ text }: { text: string }): React.JSX.Element {
  const { t } = useI18n()
  const lines = resultLines(text)
  return <div className="tool-search-results"><div className="tool-section-heading"><span>{t('Recorded matches')}</span><CopyButton text={text} label={t('Copy recorded output')} /></div>
    <ul>{lines.slice(0, 300).map((line, index) => <li key={index}><code>{line.slice(0, 4000)}{line.length > 4000 ? '…' : ''}</code></li>)}</ul>
    {lines.length > 300 && <p className="tool-limit-note">{t('Showing {count} recorded rows. Copy includes all recorded rows.', { count: 300 })}</p>}
  </div>
}

export function SearchToolCall(props: ToolCallProps): React.JSX.Element {
  const { item } = props
  const input = inputRecord(item.body.input)
  return <ToolCallFrame item={item} icon={item.body.name === 'Glob' ? FileSearch : Search} summary={<code>{compactValue(input.pattern)}</code>}>
    <ToolFields input={input} fields={[
      ['pattern', 'Pattern'], ['path', 'Search path'], ['glob', 'File filter'], ['type', 'File type'], ['output_mode', 'Output mode'],
      ['-i', 'Ignore case'], ['-n', 'Line numbers'], ['multiline', 'Multiline'], ['head_limit', 'Result limit'],
      ['-A', 'Lines after'], ['-B', 'Lines before'], ['-C', 'Context lines']
    ]} />
    <ToolResult {...props} renderText={(text) => <SearchResults text={text} />} />
  </ToolCallFrame>
}
