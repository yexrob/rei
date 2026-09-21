import { useState } from 'react'
import type { ImageNodeProps, NodeComponentProps } from 'markstream-react'
import { useI18n } from '../../i18n'
import { useRecordedImage } from './JournalMedia'

function externalImage(url: string): URL | undefined {
  try {
    const parsed = new URL(url)
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed : undefined
  } catch { return undefined }
}

export function MarkdownImage({ node }: NodeComponentProps<ImageNodeProps['node']>): React.JSX.Element {
  const { t } = useI18n()
  const recorded = useRecordedImage(node.src)
  const remote = externalImage(node.src)
  const [consent, setConsent] = useState<string>()
  const [failed, setFailed] = useState<string>()
  const allowed = !node.loading && (recorded || (remote && consent === node.src ? remote.href : undefined))
  const hasFailed = failed !== undefined && failed === (recorded || remote?.href)
  const label = node.alt || t('Recorded image')
  if (allowed && failed !== allowed) return <img className="markdown-image" src={allowed} alt={label} loading="lazy" decoding="async" crossOrigin={recorded ? undefined : 'anonymous'} referrerPolicy="no-referrer" onError={() => setFailed(allowed)} />
  return <span className="media-placeholder">{node.alt ? t('Image: {alt}', { alt: node.alt }) : t('External image')} · {t(hasFailed ? 'Image could not be loaded.' : 'not loaded automatically')}{remote && !node.loading && !hasFailed && <button type="button" title={remote.origin} onClick={() => setConsent(node.src)}>{t('Load external image')}</button>}{!remote && !recorded && <span> · {t('No matching image in this journal.')}</span>}</span>
}
