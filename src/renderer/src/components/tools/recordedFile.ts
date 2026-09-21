import type { ContentPart } from '../../../../shared/rpc'
import type { ToolCallItem } from '../../state/session'
import { object } from '../primitives'
import { recordedImages, recordedImageSource } from '../media/JournalMedia'
export { parseRecordedDiff } from './recordedDiff'

export type SourceRow = { text: string; number?: number }
export type RecordedTab = { label: string; kind: 'source' | 'diff' | 'image'; text: string; rows?: SourceRow[]; image?: string; truncated?: boolean }
export type RecordedFile = { path: string; tabs: RecordedTab[]; receipt: string }
const maxChars = 160_000
const maxRows = 1200
const maxLine = 4000

export function boundedLines(text: string): { rows: SourceRow[]; truncated: boolean } {
  const source = text.slice(0, maxChars).split('\n')
  let truncated = text.length > maxChars || source.length > maxRows
  const rows = source.slice(0, maxRows).map((text, index) => {
    if (text.length > maxLine) truncated = true
    return { number: index + 1, text: text.length > maxLine ? `${text.slice(0, maxLine)}…` : text }
  })
  return { rows, truncated }
}

function readTab(text: string): RecordedTab {
  const bounded = boundedLines(text)
  const rows = bounded.rows.map(({ text }) => {
    const match = /^\s*(\d+)\t(.*)$/.exec(text)
    return match && Number.isSafeInteger(Number(match[1])) ? { number: Number(match[1]), text: match[2] } : { text }
  })
  return { kind: 'source', label: 'Recorded read', text: rows.map((row) => row.text).join('\n'), rows, truncated: bounded.truncated }
}

function imageTabs(parts: ContentPart[]): RecordedTab[] {
  return recordedImages(parts).flatMap((part) => {
    const image = recordedImageSource(part)
    return image ? [{ kind: 'image' as const, label: 'Recorded image', text: '', image }] : []
  }).slice(0, 5)
}

function contentLabel(item: ToolCallItem): string {
  if (item.status === 'failed' || item.status === 'interrupted' || item.body.output?.isError) return 'Attempted content'
  return item.status === 'completed' && item.body.output ? 'Written content' : 'Requested content'
}

function sourceTab(label: string, text: unknown): RecordedTab[] {
  return typeof text === 'string' && !text.includes('\0') ? [{ kind: 'source', label, text, ...boundedLines(text) }] : []
}

function outputText(parts: ContentPart[]): string {
  return parts.flatMap((part) => part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n')
}

export function recordedFile(item: ToolCallItem): RecordedFile {
  const { name, output } = item.body
  const input = object(item.body.input)
  const parts = Array.isArray(output?.parts) ? output.parts : []
  const receipt = outputText(parts)
  const path = typeof input.file_path === 'string' ? input.file_path : ''
  const tabs: RecordedTab[] = []
  if (!['Read', 'Write', 'Edit'].includes(name)) return { path, receipt, tabs }
  if (output?.display?.kind === 'diff' && typeof output.display.unified === 'string') tabs.push({ label: 'Recorded diff', kind: 'diff', text: output.display.unified })
  if (name === 'Write') tabs.push(...sourceTab(contentLabel(item), input.content))
  if (name === 'Edit') {
    tabs.push(...sourceTab('Match snippet', input.old_string), ...sourceTab('Replacement snippet', input.new_string))
  }
  if (name === 'Read' && output && !output.isError) {
    tabs.push(...imageTabs(parts))
    if (parts.some((part) => part?.type === 'text' && typeof part.text === 'string') && !receipt.includes('\0')) tabs.push(readTab(receipt))
  }
  return { path, receipt, tabs }
}
