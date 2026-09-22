import { AlarmClock, CalendarClock } from '../icons'
import { useI18n } from '../../i18n'
import { ToolCallFrame } from './ToolCallFrame'
import { scheduleFields, ToolFields } from './ToolFields'
import { RequestText } from './RequestText'
import { ToolResult } from './ToolResult'
import { compactValue, inputRecord, type ToolCallProps } from './toolPresentation'

export function ScheduleToolCall(props: ToolCallProps): React.JSX.Element {
  const { item } = props
  const { t } = useI18n()
  const input = inputRecord(item.body.input)
  return <ToolCallFrame item={item} icon={item.body.name === 'Wake' ? AlarmClock : CalendarClock} summary={input.stop === true ? t('Cancel wake') : compactValue(input.spec ?? input.after ?? input.id) || t('Schedules')}>
    <ToolFields input={input} fields={scheduleFields} />
    <RequestText input={input} fields={[['text', 'Scheduled prompt'], ['note', 'Wake note']]} />
    <ToolResult {...props} />
  </ToolCallFrame>
}
