import { BookOpen, Lightbulb } from 'lucide-react'
import { useI18n } from '../../i18n'
import { ToolCallFrame } from './ToolCallFrame'
import { knowledgeFields, ToolFields } from './ToolFields'
import { RequestText } from './RequestText'
import { RecordedText, ToolResult } from './ToolResult'
import { compactValue, inputRecord, type ToolCallProps } from './toolPresentation'

export function KnowledgeToolCall(props: ToolCallProps): React.JSX.Element {
  const { item } = props
  const { t } = useI18n()
  const input = inputRecord(item.body.input)
  return <ToolCallFrame item={item} icon={item.body.name === 'Skill' ? BookOpen : Lightbulb} summary={compactValue(input.name ?? input.query ?? input.summary ?? input.id)}>
    <ToolFields input={input} fields={knowledgeFields} />
    <RequestText input={input} fields={[
      ['arguments', 'Arguments'], ['notes', 'Notes'], ['evidence', 'Evidence'], ['verify', 'Verification']
    ]} />
    {Array.isArray(input.steps) && <section className="tool-request-block"><h4>{t('Steps')}</h4><RecordedText text={input.steps.map((step, index) => `${index + 1}. ${compactValue(step)}`).join('\n')} /></section>}
    <ToolResult {...props} />
  </ToolCallFrame>
}
