import { useMemo } from 'react'
import katex from 'katex'
import type { MathBlockNodeProps, MathInlineNodeProps, NodeComponentProps } from 'markstream-react'
import 'katex/dist/katex.min.css'

type MathNode = MathBlockNodeProps['node'] | MathInlineNodeProps['node']

export function MarkdownMath({ node }: NodeComponentProps<MathNode>): React.JSX.Element {
  const display = node.type === 'math_block'
  const html = useMemo(() => {
    if (node.loading || node.content.length > 16_000) return undefined
    try { return katex.renderToString(node.content, { displayMode: display, trust: false, strict: 'error', throwOnError: true, maxExpand: 500, maxSize: 20, output: 'htmlAndMathml' }) } catch { return undefined }
  }, [node.content, node.loading, display])
  // Only KaTeX's escaped, trust:false output enters this boundary; raw Markdown HTML never does.
  return html ? <span className={display ? 'math-display' : 'math-inline'} dangerouslySetInnerHTML={{ __html: html }} /> : <code className="math-source">{node.raw}</code>
}
