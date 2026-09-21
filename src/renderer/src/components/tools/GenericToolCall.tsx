import { CircleHelp, Plug, Wrench } from 'lucide-react'
import { useI18n } from '../../i18n'
import { ToolCallFrame } from './ToolCallFrame'
import { ParameterChips } from './ToolFields'
import { ToolResult } from './ToolResult'
import { compactValue, inputRecord, mcpIdentity, type ToolCallProps } from './toolPresentation'

export function GenericToolCall(props: ToolCallProps): React.JSX.Element {
  const { item } = props
  const { t } = useI18n()
  const input = inputRecord(item.body.input)
  const mcp = mcpIdentity(item.body.name)
  return <ToolCallFrame item={item} icon={mcp ? Plug : Wrench} title={mcp ? <span className="tool-mcp-name"><small>MCP</small><span>{mcp.server}</span></span> : item.body.name} summary={mcp?.method ?? t('Tool operation')}>
    <ParameterChips input={input} />
    <ToolResult {...props} />
  </ToolCallFrame>
}

export function QuestionToolCall(props: ToolCallProps): React.JSX.Element {
  const { item } = props
  const { t } = useI18n()
  const input = inputRecord(item.body.input)
  const questions = Array.isArray(input.questions) ? input.questions : []
  return <ToolCallFrame item={item} icon={CircleHelp} summary={t('Questions')}>
    <ul className="tool-task-results">{questions.slice(0, 20).map((entry, index) => {
      const question = inputRecord(entry)
      return <li key={index}><span className="tool-task-status">{compactValue(question.header ?? question.id ?? index + 1)}</span><span>{compactValue(question.question ?? question.label)}</span></li>
    })}</ul>
    <ToolResult {...props} />
  </ToolCallFrame>
}
