import { useI18n } from '../../i18n'
import { compactValue } from './toolPresentation'

export type FieldSpec = readonly [key: string, label: string]
export function ToolFields({ input, fields }: { input: Record<string, unknown>; fields: readonly FieldSpec[] }): React.JSX.Element {
  const { t } = useI18n()
  return <dl className="tool-input-fields">{fields.filter(([key]) => input[key] != null && input[key] !== '').map(([key, label]) => <div key={key}><dt>{t(label)}</dt><dd title={typeof input[key] === 'string' ? input[key] : undefined}>{compactValue(input[key])}</dd></div>)}</dl>
}

export function ParameterChips({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const { t } = useI18n()
  const entries = Object.entries(input)
  return <div className="tool-parameter-chips">{entries.slice(0, 8).map(([key, value]) => <span key={key} className="tool-parameter"><span>{key}</span><code>{compactValue(value)}</code></span>)}{entries.length > 8 && <span>{t('{count} more parameters', { count: entries.length - 8 })}</span>}</div>
}

export const collaborationFields: FieldSpec[] = [
  ['name', 'Name'], ['agent', 'Agent'], ['to', 'Recipient'], ['room', 'Room'], ['purpose', 'Purpose'],
  ['members', 'Members'], ['listeners', 'Listeners'], ['provider', 'Provider'], ['model', 'Model'],
  ['thinking', 'Thinking'], ['level', 'Thinking'], ['background', 'Background'], ['standby', 'Standby'],
  ['reopen', 'Reuse agent'], ['shared', 'Shared'], ['patience_s', 'Patience (seconds)'], ['again', 'Resubmit last draft']
]
export const taskFields: FieldSpec[] = [
  ['id', 'Task'], ['subject', 'Subject'], ['status', 'Requested status'], ['owner', 'Owner'], ['in', 'Board'],
  ['claim', 'Claim task'], ['blockedBy', 'Blocked by'], ['blocks', 'Blocks'], ['addBlockedBy', 'Add dependencies'], ['addBlocks', 'Unblocks']
]
export const knowledgeFields: FieldSpec[] = [
  ['name', 'Skill'], ['query', 'Query'], ['id', 'Record'], ['summary', 'Summary'], ['trigger', 'Triggers'],
  ['status', 'Requested status'], ['outcome', 'Outcome'], ['limit', 'Limit']
]
export const scheduleFields: FieldSpec[] = [
  ['spec', 'Schedule'], ['after', 'Wake after'], ['id', 'Record'], ['cwd', 'Working directory'],
  ['permissionMode', 'Permission mode'], ['stop', 'Cancel wake']
]
