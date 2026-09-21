import { createContext, memo, useContext } from 'react'
import MarkdownRender, { setCustomComponents, type CodeBlockNodeProps, type LinkNodeProps, type NodeComponentProps, type NodeRendererProps } from 'markstream-react'
import 'markstream-react/index.css'
import './markdown.css'
import type { Action, View } from '../../../shared/rpc'
import { CopyButton } from './primitives'
import { useI18n } from '../i18n'
import { MarkdownImage } from './media/MarkdownImage'
import { MarkdownDiagram } from './media/MarkdownDiagram'
import { MarkdownMath } from './media/MarkdownMath'

export type RunAction = (action: Action) => void
export type OpenLink = (url: string) => void

const MarkdownLinkContext = createContext<OpenLink>(() => {})
const markdownId = 'bingo-safe-markdown'

function isWebLink(href: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(href).protocol) } catch { return false }
}

function MarkdownLink({ node, ctx, renderNode, indexKey }: NodeComponentProps<LinkNodeProps['node']>): React.JSX.Element {
  const openLink = useContext(MarkdownLinkContext)
  const children = ctx && renderNode ? node.children?.map((child, index) => renderNode(child, `${indexKey}-${index}`, ctx)) : node.text
  if (!isWebLink(node.href)) return <span>{children}</span>
  return <a href={node.href} onClick={(event) => { event.preventDefault(); openLink(node.href) }} onAuxClick={(event) => { event.preventDefault(); if (event.button === 1) openLink(node.href) }}>{children}</a>
}

function MarkdownCode({ node }: NodeComponentProps<CodeBlockNodeProps['node']>): React.JSX.Element {
  return <CodeBlock text={node.code} language={node.language} />
}

// Raw HTML and unrequested diagram engines remain inert; rich media owns its own trust boundary.
setCustomComponents(markdownId, {
  link: MarkdownLink,
  image: MarkdownImage,
  code_block: MarkdownCode,
  mermaid: MarkdownDiagram,
  math_inline: MarkdownMath,
  math_block: MarkdownMath,
  d2: MarkdownCode,
  infographic: MarkdownCode,
  html_block: () => null,
  html_inline: () => null
})
const safeMarkdown: NonNullable<NodeRendererProps['customMarkdownIt']> = (markdown) => markdown.set({ validateLink: (url: string) => isWebLink(url) || (!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url) || /^[a-z]:[\\/]/i.test(url)) })

export function CodeBlock({ text, language }: { text: string; language?: string }): React.JSX.Element {
  const { t } = useI18n()
  return <div className="code-block"><div className="code-heading"><span>{language || t('Plain text')}</span><CopyButton text={text} label={t('Copy code')} /></div><pre><code>{text}</code></pre></div>
}

export const RichText = memo(function RichText({ text, openLink, final = true }: { text: string; openLink: OpenLink; final?: boolean }): React.JSX.Element {
  return <MarkdownLinkContext.Provider value={openLink}><div className="markdown"><MarkdownRender content={text} final={final} customId={markdownId} customMarkdownIt={safeMarkdown} htmlPolicy="safe" fade={false} smoothStreaming={false} batchRendering={false} deferNodesUntilVisible={false} showTooltips={false} /></div></MarkdownLinkContext.Provider>
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
