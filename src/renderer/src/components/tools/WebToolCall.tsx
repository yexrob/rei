import { ExternalLink, Globe, Search, PanelsTopLeft } from 'lucide-react'
import { useI18n } from '../../i18n'
import { RichText } from '../Content'
import { ToolCallFrame } from './ToolCallFrame'
import { ToolFields } from './ToolFields'
import { ToolResult } from './ToolResult'
import { compactValue, inputRecord, safeWebUrl, type ToolCallProps } from './toolPresentation'

export function WebToolCall(props: ToolCallProps): React.JSX.Element {
  const { item, openLink } = props
  const { t } = useI18n()
  const input = inputRecord(item.body.input)
  const url = safeWebUrl(input.url)
  const icon = item.body.name === 'WebSearch' ? Search : item.body.name === 'ShowPage' ? PanelsTopLeft : Globe
  return <ToolCallFrame item={item} icon={icon} summary={compactValue(input.query ?? input.url ?? input.title)} actions={url && <button type="button" className="tool-link-action" title={url} aria-label={t('Open link')} onClick={() => openLink(url)}><ExternalLink size={14} /></button>}>
    <ToolFields input={input} fields={[
      ['query', 'Query'], ['url', 'URL'], ['title', 'Page title'], ['allowed_domains', 'Allowed domains'], ['blocked_domains', 'Blocked domains'], ['timeout_secs', 'Timeout (seconds)']
    ]} />
    {item.body.name === 'ShowPage' && <p className="tool-limit-note">{t('Page source is recorded in raw input. It is not executed in this transcript.')}</p>}
    <ToolResult {...props} renderText={item.body.name === 'ShowPage' ? undefined : (text) => <RichText text={text} openLink={openLink} />} />
  </ToolCallFrame>
}
