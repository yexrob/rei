import { Bot, MessagesSquare } from '../icons'
import { contentText } from '../../state/session'
import { useI18n } from '../../i18n'
import { ToolCallFrame } from './ToolCallFrame'
import { collaborationFields, ToolFields } from './ToolFields'
import { RequestText } from './RequestText'
import { ToolResult } from './ToolResult'
import { compactValue, inputRecord, type ToolCallProps } from './toolPresentation'

const roomTools = new Set(['OpenRoom', 'Seat', 'Unseat', 'CloseRoom', 'Listen'])
function spawnedSession({ item, sessions, sessionId }: ToolCallProps): string | undefined {
  if (item.body.name !== 'SpawnAgent' || !sessionId || item.body.output?.isError) return undefined
  const firstLine = contentText(item.body.output?.parts ?? []).split('\n')[0]
  const receipt = inputRecord(firstLine)
  return sessions?.find((session) => session.id === receipt.session && session.parent?.session === sessionId)?.id
}

export function CollaborationToolCall(props: ToolCallProps): React.JSX.Element {
  const { item, onSelectSession } = props
  const { t } = useI18n()
  const input = inputRecord(item.body.input)
  const target = input.to ?? input.room ?? input.name ?? input.agent
  const room = roomTools.has(item.body.name) || typeof target === 'string' && target.startsWith('#')
  const session = spawnedSession(props)
  return <ToolCallFrame item={item} icon={room ? MessagesSquare : Bot} summary={target != null ? compactValue(target) : t(room ? 'Room operation' : 'Agent operation')} actions={session && onSelectSession && <button type="button" className="tool-session-link" onClick={() => onSelectSession(session)}>{t('Open conversation')}</button>}>
    <ToolFields input={input} fields={collaborationFields} />
    <RequestText input={input} fields={[
      ['prompt', 'Assignment'], ['text', 'Message'], ['purpose', 'Purpose'], ['why', 'Closing note']
    ]} />
    <ToolResult {...props} />
  </ToolCallFrame>
}
