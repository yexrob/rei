import { useMemo } from 'react'
import './diff-view.css'

export type DiffRow = { kind: 'add' | 'remove' | 'context' | 'hunk' | 'meta'; text: string; oldLine?: number; newLine?: number }

/** Splits a unified diff into typed rows with old/new line numbers from hunk headers. */
export function parseUnifiedDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLine = 0, newLine = 0, inHunk = false
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; rows.push({ kind: 'hunk', text: line }); continue }
    if (!inHunk || /^(diff |index |--- |\+\+\+ |similarity |rename |new file|deleted file|old mode|new mode|Binary files)/.test(line)) {
      if (/^(diff |--- |\+\+\+ )/.test(line)) inHunk = false
      rows.push({ kind: line.startsWith('+') && !line.startsWith('+++') && !inHunk ? 'add' : line.startsWith('-') && !line.startsWith('---') && !inHunk ? 'remove' : 'meta', text: line })
      continue
    }
    if (line.startsWith('+')) rows.push({ kind: 'add', text: line, newLine: newLine++ })
    else if (line.startsWith('-')) rows.push({ kind: 'remove', text: line, oldLine: oldLine++ })
    else if (line.startsWith('\\')) rows.push({ kind: 'meta', text: line })
    else rows.push({ kind: 'context', text: line, oldLine: oldLine++, newLine: newLine++ })
  }
  return rows
}

type Props = { text: string; label: string; lineNumbers?: boolean; className?: string; maxRows?: number }
/** A read-only, colored unified diff. Signs stay in the text so meaning never depends on color. */
export function DiffView({ text, label, lineNumbers = false, className = '', maxRows }: Props): React.JSX.Element {
  const rows = useMemo(() => parseUnifiedDiff(text), [text])
  const visible = maxRows ? rows.slice(0, maxRows) : rows
  return <pre className={`diff-view ${lineNumbers ? 'with-line-numbers' : ''} ${className}`.trim()} tabIndex={0} aria-label={label} data-truncated={visible.length < rows.length || undefined}>
    {visible.map((row, index) => <span key={index} className={`diff-row diff-${row.kind}`}>
      {lineNumbers && <><span className="diff-gutter" aria-hidden="true">{row.oldLine ?? ''}</span><span className="diff-gutter" aria-hidden="true">{row.newLine ?? ''}</span></>}
      <span className="diff-text">{row.text}</span>{'\n'}
    </span>)}
  </pre>
}
