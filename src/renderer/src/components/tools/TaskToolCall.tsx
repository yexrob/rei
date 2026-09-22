import { ListTodo } from '../icons'
import { useI18n } from '../../i18n'
import { ToolCallFrame } from './ToolCallFrame'
import { taskFields, ToolFields } from './ToolFields'
import { RequestText } from './RequestText'
import { JsonResult, ToolResult } from './ToolResult'
import { compactValue, inputRecord, type ToolCallProps } from './toolPresentation'

function TaskResult({ text }: { text: string }): React.JSX.Element {
  const { t } = useI18n()
  const lines = text.split('\n')
  const tasks = lines.map((line) => /^#(\d+) \[(pending|in_progress|completed)\] (.+)$/.exec(line))
  if (!tasks.length || tasks.some((task) => !task)) return <JsonResult text={text} />
  return <><ul className="tool-task-results">{tasks.slice(0, 200).map((task, index) => task && <li key={index}><code>#{task[1]}</code><span className="tool-task-status">{task[2]}</span><span className="tool-task-subject">{task[3]}</span></li>)}</ul>{tasks.length > 200 && <p className="tool-limit-note">{t('More fields are available in the raw result.')}</p>}</>
}

export function TaskToolCall(props: ToolCallProps): React.JSX.Element {
  const { item } = props
  const { t } = useI18n()
  const input = inputRecord(item.body.input)
  const target = input.subject ?? (input.id != null ? `#${compactValue(input.id)}` : input.in)
  return <ToolCallFrame item={item} icon={ListTodo} summary={target != null ? compactValue(target) : t('Task board')}>
    <ToolFields input={input} fields={taskFields} />
    <RequestText input={input} fields={[['description', 'Description'], ['activeForm', 'Active label']]} />
    <ToolResult {...props} renderText={(text) => <TaskResult text={text} />} />
  </ToolCallFrame>
}
