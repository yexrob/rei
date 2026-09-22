import { Terminal } from '../icons'
import { useI18n } from '../../i18n'
import { contentText } from '../../state/session'
import { ToolCallFrame } from './ToolCallFrame'
import { ToolFields } from './ToolFields'
import { RecordedText, ToolResult } from './ToolResult'
import { compactValue, inputRecord, parseTerminal, type ToolCallProps } from './toolPresentation'

function TerminalOutput({ text }: { text: string }): React.JSX.Element {
  const { t } = useI18n()
  const result = parseTerminal(text)
  return <div className="tool-terminal">
    {result.command && <div className="tool-terminal-command"><span aria-hidden="true">$</span><code>{result.command}</code></div>}
    {result.output && <RecordedText text={result.output} />}
    {result.receipt && <div className={`tool-terminal-exit ${result.exit != null && result.exit !== 0 ? 'is-error' : ''}`}>{result.exit != null ? t('Exit {code}', { code: result.exit }) : result.receipt}</div>}
  </div>
}

export function TerminalToolCall(props: ToolCallProps): React.JSX.Element {
  const { item } = props
  const { t } = useI18n()
  const input = inputRecord(item.body.input)
  const command = typeof input.command === 'string' ? input.command : parseTerminal(contentText(item.body.output?.parts ?? [])).command
  return <ToolCallFrame item={item} icon={Terminal} summary={<code>{command ? compactValue(command) : input.id ? t('Job {id}', { id: compactValue(input.id) }) : t('Shell job')}</code>}>
    <ToolFields input={input} fields={[
      ['description', 'Purpose'], ['id', 'Job'], ['cursor', 'Cursor'], ['timeout', 'Timeout (ms)'], ['background', 'Background'],
      ['notify_on', 'Notify on'], ['notify_regex', 'Notify pattern'], ['notify_all', 'Repeat notifications'], ['notify_quiet', 'Notification interval (ms)']
    ]} />
    {command && !item.body.output && <div className="tool-terminal-command"><span aria-hidden="true">$</span><code>{command}</code></div>}
    <ToolResult {...props} renderText={(text) => <TerminalOutput text={text} />} />
  </ToolCallFrame>
}
