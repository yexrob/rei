import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

export type SessionSummary = { id: string; name: string; preview: string; updatedAt: string; messageCount: number }
export type HistoryItem = { type: 'message'; value: { id: string; role: 'user' | 'assistant'; markdown: string } }
export type SessionListOutput = { sessions: SessionSummary[]; warnings: string[] }

export class TranscriptRepository {
  constructor(private readonly directory: string) {}

  async list(): Promise<SessionListOutput> {
    let names: string[]
    try { names = await readdir(this.directory) } catch { return { sessions: [], warnings: [] } }
    const entries = await Promise.all(names.filter((name) => extname(name) === '.jsonl').map(async (name) => {
      const path = join(this.directory, name)
      return { name, path, metadata: await stat(path) }
    }))
    entries.sort((a, b) => b.metadata.mtimeMs - a.metadata.mtimeMs)
    const warnings: string[] = []
    const sessions = await Promise.all(entries.map(async ({ name, path, metadata }) => {
      const id = basename(name, '.jsonl')
      const parsed = this.parse(await readFile(path, 'utf8'), id)
      warnings.push(...parsed.warnings)
      const firstUser = parsed.messages.find((m) => m.value.role === 'user')?.value.markdown
      const title = id.includes('--') ? displayName(id) : (firstUser ? stripMarkdown(firstUser).slice(0, 60) : 'New conversation')
      const preview = stripMarkdown(parsed.messages.at(-1)?.value.markdown ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
      return { id, name: title, preview, updatedAt: metadata.mtime.toISOString(), messageCount: parsed.messages.length }
    }))
    return { sessions, warnings }
  }

  async load(sessionId: string): Promise<{ history: HistoryItem[]; warnings: string[] }> {
    if (!validSessionId(sessionId)) throw new Error('Invalid session ID')
    return this.parse(await readFile(join(this.directory, `${sessionId}.jsonl`), 'utf8'), sessionId)
  }

  private parse(source: string, sessionId: string): { messages: HistoryItem[]; history: HistoryItem[]; warnings: string[] } {
    const messages: HistoryItem[] = []
    const warnings: string[] = []
    source.split('\n').forEach((line, index) => {
      if (!line.trim()) return
      try {
        const raw = JSON.parse(line) as { role?: unknown; content?: unknown }
        if (raw.role !== 'user' && raw.role !== 'assistant') return
        const markdown = textContent(raw.content)
        if (!markdown) return
        messages.push({ type: 'message', value: { id: `${sessionId}:${index + 1}`, role: raw.role, markdown } })
      } catch { warnings.push(`${sessionId}: skipped corrupt line ${index + 1}`) }
    })
    return { messages, history: messages, warnings }
  }
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((block) => typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

function validSessionId(id: string): boolean { return id.length > 0 && id.length <= 255 && !id.includes('/') && !id.includes('\\') && id !== '.' && id !== '..' }
function displayName(id: string): string { const marker = id.lastIndexOf('--'); return marker >= 0 ? id.slice(marker + 2) : 'New conversation' }

/** Light Markdown normalization for nav titles/previews: no code fences,
 * inline code, links, emphasis, or heading markers in the sidebar. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^[#>*_~-]{1,3}\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}
