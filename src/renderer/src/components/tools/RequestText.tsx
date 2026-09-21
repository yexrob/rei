import { useI18n } from '../../i18n'
import { RecordedText } from './ToolResult'
import type { FieldSpec } from './ToolFields'

export function RequestText({ input, fields }: { input: Record<string, unknown>; fields: FieldSpec[] }): React.JSX.Element {
  const { t } = useI18n()
  return <>{fields.map(([key, label]) => typeof input[key] === 'string' && input[key] ? <section className="tool-request-block" key={key}><h4>{t(label)}</h4><RecordedText text={input[key]} /></section> : null)}</>
}
