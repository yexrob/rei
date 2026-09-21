import { classifyTool, type ToolCallProps } from './toolPresentation'
import { FileToolCall } from './FileToolCall'
import { TerminalToolCall } from './TerminalToolCall'
import { SearchToolCall } from './SearchToolCall'
import { WebToolCall } from './WebToolCall'
import { CollaborationToolCall } from './CollaborationToolCall'
import { TaskToolCall } from './TaskToolCall'
import { KnowledgeToolCall } from './KnowledgeToolCall'
import { ScheduleToolCall } from './ScheduleToolCall'
import { GenericToolCall, QuestionToolCall } from './GenericToolCall'

const presenters = {
  file: FileToolCall, terminal: TerminalToolCall, search: SearchToolCall, web: WebToolCall,
  collaboration: CollaborationToolCall, task: TaskToolCall, knowledge: KnowledgeToolCall,
  schedule: ScheduleToolCall, question: QuestionToolCall, generic: GenericToolCall
}
export function ToolCallCard(props: ToolCallProps): React.JSX.Element {
  const family = classifyTool(props.item.body.name)
  const Presenter = presenters[family]
  return <div className="tool-presentation" data-tool-family={family}><Presenter {...props} /></div>
}
