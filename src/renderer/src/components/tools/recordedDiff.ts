export type DiffRow = { text: string; kind: 'context' | 'addition' | 'deletion' | 'meta'; oldLine?: number; newLine?: number }
export type DiffCounts = { added: number; removed: number }
export type RecordedDiff = { rows: DiffRow[]; counts?: DiffCounts; truncated: boolean }
const maxScan = 1_000_000
const maxRows = 1200
const maxLine = 4000

type Cursor = { old: number; next: number; oldRemaining: number; nextRemaining: number }
function hunk(line: string): Cursor | undefined {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line)
  if (!match) return
  const [old, oldRemaining, next, nextRemaining] = [Number(match[1]), Number(match[2] ?? 1), Number(match[3]), Number(match[4] ?? 1)]
  if (![old, oldRemaining, next, nextRemaining].every(Number.isSafeInteger)) return
  return { old, next, oldRemaining, nextRemaining }
}
function changeRow(line: string, cursor: Cursor, counts: DiffCounts): DiffRow | undefined {
  if (line.startsWith('+') && cursor.nextRemaining > 0) {
    cursor.nextRemaining--; counts.added++
    return { text: line, kind: 'addition', newLine: cursor.next++ }
  }
  if (line.startsWith('-') && cursor.oldRemaining > 0) {
    cursor.oldRemaining--; counts.removed++
    return { text: line, kind: 'deletion', oldLine: cursor.old++ }
  }
  if (line.startsWith(' ') && cursor.oldRemaining > 0 && cursor.nextRemaining > 0) {
    cursor.oldRemaining--; cursor.nextRemaining--
    return { text: line, kind: 'context', oldLine: cursor.old++, newLine: cursor.next++ }
  }
  return undefined
}

export function parseRecordedDiff(text: string): RecordedDiff {
  const rows: DiffRow[] = []
  const counts = { added: 0, removed: 0 }
  let cursor: Cursor | undefined
  let valid = text.length <= maxScan
  let seenHunk = text === ''
  let truncated = !valid
  for (const line of text.slice(0, maxScan).split('\n')) {
    let row: DiffRow = { text: line, kind: 'meta' }
    const next = hunk(line)
    if (next) {
      if (cursor && (cursor.oldRemaining || cursor.nextRemaining)) valid = false
      cursor = next; seenHunk = true
    } else if (line === '\\ No newline at end of file') {
      if (!cursor) valid = false
    } else if (cursor && (cursor.oldRemaining || cursor.nextRemaining)) {
      const change = changeRow(line, cursor, counts)
      if (change) row = change
      else valid = false
    } else if (line && !/^(--- |\+\+\+ |diff |index )/.test(line)) valid = false
    if (rows.length < maxRows) rows.push({ ...row, text: line.length > maxLine ? `${line.slice(0, maxLine)}…` : line })
    else truncated = true
    if (line.length > maxLine) truncated = true
  }
  if (cursor && (cursor.oldRemaining || cursor.nextRemaining)) valid = false
  return { rows, counts: valid && seenHunk ? counts : undefined, truncated }
}
