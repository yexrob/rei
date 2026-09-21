import { useEffect, useState } from 'react'
import type { CodeBlockNodeProps, NodeComponentProps } from 'markstream-react'
import { CodeBlock } from '../Content'
import { useI18n } from '../../i18n'
import { renderDiagram } from './diagram'

export function MarkdownDiagram({ node }: NodeComponentProps<CodeBlockNodeProps['node']>): React.JSX.Element {
  const { t } = useI18n()
  const [result, setResult] = useState<{ source: string; svg?: string }>()
  const complete = !node.loading
  useEffect(() => {
    if (!complete) return
    let active = true
    void renderDiagram(node.code).then((svg) => { if (active) setResult({ source: node.code, svg }) }, () => { if (active) setResult({ source: node.code }) })
    return () => { active = false }
  }, [node.code, complete])
  const current = complete && result?.source === node.code ? result : undefined
  return <section className="markdown-diagram" aria-label={t('Mermaid diagram')}>
    {current?.svg ? <img className="diagram-preview" alt={t('Mermaid diagram')} src={`data:image/svg+xml,${encodeURIComponent(current.svg)}`} /> : <p className="media-status" role="status">{t(!complete ? 'Diagram source is still streaming.' : current ? 'Diagram preview unavailable. Source is preserved below.' : 'Rendering diagram…')}</p>}
    <details open={!current?.svg}><summary>{t('Diagram source')}</summary><CodeBlock text={node.code} language="mermaid" /></details>
  </section>
}
