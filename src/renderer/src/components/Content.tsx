import { Children, isValidElement, memo, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Action, View } from '../../../shared/rpc'
import { CopyButton } from './primitives'
import { useI18n } from '../i18n'

export type RunAction = (action: Action) => void
export type OpenLink = (url: string) => void

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

export function CodeBlock({ text, language }: { text: string; language?: string }): React.JSX.Element {
  const { t } = useI18n()
  return <div className="code-block"><div className="code-heading"><span>{language || t('Plain text')}</span><CopyButton text={text} label={t('Copy code')} /></div><pre><code>{text}</code></pre></div>
}

export const RichText = memo(function RichText({ text, openLink }: { text: string; openLink: OpenLink }): React.JSX.Element {
  const { t } = useI18n()
  return <div className="markdown"><Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => href && /^https?:\/\//i.test(href) ? <a href={href} onClick={(event) => { event.preventDefault(); openLink(href) }}>{children}</a> : <span>{children}</span>,
    img: ({ alt }) => <span className="media-placeholder">{alt ? t('Image: {alt}', { alt }) : t('External image')} · {t('not loaded automatically')}</span>,
    pre: ({ children }) => {
      const code = Children.toArray(children).find(isValidElement)
      const language = isValidElement<{ className?: string }>(code) ? code.props.className?.replace(/^language-/, '') : undefined
      return <CodeBlock text={textOf(children).replace(/\n$/, '')} language={language} />
    },
    table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>
  }}>{text}</Markdown></div>
})

export function StructuredView({ view, runAction, openLink, depth = 0 }: { view: View; runAction: RunAction; openLink: OpenLink; depth?: number }): React.JSX.Element {
  const { t } = useI18n()
  if (depth > 12) return <p>{t('Nested content is too deep to display.')}</p>
  const child = (node: View, key: number) => <StructuredView key={key} view={node} runAction={runAction} openLink={openLink} depth={depth + 1} />
  switch (view.kind) {
    case 'text': return <p className="preserve-lines">{view.text}</p>
    case 'markdown': return <RichText text={view.text} openLink={openLink} />
    case 'code': return <CodeBlock text={view.text} language={view.lang ?? undefined} />
    case 'diff': return <pre className="diff">{view.unified.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') ? 'addition' : line.startsWith('-') ? 'deletion' : ''}>{line}{'\n'}</span>)}</pre>
    case 'list': return <ul>{view.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    case 'table': return <div className="table-scroll"><table><thead><tr>{view.headers.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr></thead><tbody>{view.rows.map((row, index) => <tr key={index}>{row.map((cell, key) => <td key={key}>{cell}</td>)}</tr>)}</tbody></table></div>
    case 'keyValue': return <dl className="key-values">{view.rows.map(([key, value], index) => <div key={index}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
    case 'progress': return <label className="progress-label">{view.label ?? t('Progress')}<progress value={view.total ? view.value : undefined} max={view.total || undefined} /></label>
    case 'badge': return <span className={`badge ${view.tone}`}>{view.text}</span>
    case 'stack': case 'columns': return <div className={view.kind === 'columns' ? 'view-columns' : 'view-stack'}>{view.children.map(child)}</div>
    case 'panel': return <section className="view-panel"><h3>{view.title}</h3>{child(view.child, 0)}</section>
    case 'actions': return <div className="button-row">{view.items.map((item, index) => <button key={index} onClick={() => runAction(item.action)}>{item.label}</button>)}</div>
    case 'tree': return <ul className="view-tree">{view.nodes.map((node, index) => <li key={index}>{node.label}{node.badge && <span className="badge">{node.badge}</span>}{node.children?.length ? child({ kind: 'tree', nodes: node.children }, index) : null}</li>)}</ul>
    case 'custom': return <p className="preserve-lines">{view.fold}</p>
    default: return <p>{t('Unsupported display content.')}</p>
  }
}
