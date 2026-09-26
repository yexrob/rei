import type { AgentPageState, AgentPageTarget, ConnectionState, ConversationSelection, DesktopEvent } from '../../shared/desktop'
import { DesktopFailure } from './rpc-client'
import { agentPageSchema } from './security'

type Entry = { page: AgentPageState; url: string | null }
type Options = { connection(id: string): ConnectionState | null; selection(): ConversationSelection | null; emit(event: DesktopEvent): void; open(url: string): void }
const key = (target: AgentPageTarget): string => JSON.stringify([target.hostId, target.connectionId, target.sessionId, target.itemId])

/** Approved running ShowPage items own URLs; the renderer supplies identity only. */
export class AgentBrowser {
  private readonly pages = new Map<string, Entry>()
  private readonly sequences = new Map<string, { hostId: string; connectionId: string; seq: number }>()
  constructor(private readonly options: Options) {}
  snapshot(): AgentPageState[] { return [...this.pages.values()].filter(entry => entry.url).map(entry => ({ ...entry.page })) }
  route(event: DesktopEvent): void {
    if (event.type === 'runtime-invalidated') { this.pages.clear(); this.sequences.clear(); return }
    if (event.type === 'connection') {
      for (const [id, value] of this.sequences) if (value.hostId === event.connection.hostId && (event.connection.status !== 'ready' || value.connectionId !== event.connection.connectionId)) this.sequences.delete(id)
      for (const [id, entry] of this.pages) if (entry.page.hostId === event.connection.hostId && (event.connection.status !== 'ready' || entry.page.connectionId !== event.connection.connectionId)) this.invalidate(id)
      return
    }
    if (event.type !== 'rpc' || event.method !== 'event') return
    const connection = this.options.connection(event.connectionId)
    if (!connection || connection.status !== 'ready') return
    const frame = event.params, data = frame.event
    const stream = JSON.stringify([connection.hostId, event.connectionId, frame.session])
    const previous = this.sequences.get(stream)?.seq ?? -1
    if (data.type === 'lagged') {
      for (const [id, entry] of this.pages) if (entry.page.connectionId === event.connectionId && entry.page.sessionId === frame.session) this.invalidate(id)
      this.sequences.set(stream, { hostId: connection.hostId, connectionId: event.connectionId, seq: Math.max(previous, frame.seq) })
      return
    }
    if (frame.seq <= previous) return
    this.sequences.set(stream, { hostId: connection.hostId, connectionId: event.connectionId, seq: frame.seq })
    const target = (itemId: string): AgentPageTarget => ({ hostId: connection.hostId, connectionId: event.connectionId, sessionId: frame.session, itemId })
    if (data.type === 'itemStarted' || data.type === 'itemUpdated') {
      const item = data.item
      if (item.body.kind === 'toolCall' && item.body.name === 'ShowPage' && item.status === 'running') {
        const identity = target(item.id), id = key(identity)
        if (!this.pages.has(id)) {
          const input = item.body.input as { title?: unknown } | null
          this.pages.set(id, { page: { ...identity, title: typeof input?.title === 'string' ? input.title.slice(0, 512) : 'Agent page', status: 'available' }, url: null })
          if (this.pages.size > 128) this.invalidate(this.pages.keys().next().value!)
        }
        if (item.body.progress) this.progress(id, item.body.progress)
      }
    }
    if (data.type === 'itemCompleted') this.invalidate(key(target(data.item.id)))
    if (data.type === 'itemDelta' && data.kind === 'tail') this.progress(key(target(data.item)), data.data)
    if (data.type === 'sessionClosed' || data.type === 'turnCompleted') for (const [id, entry] of this.pages) if (entry.page.connectionId === event.connectionId && entry.page.sessionId === frame.session) this.invalidate(id)
  }
  open(input: AgentPageTarget): void {
    const target = agentPageSchema.parse(input)
    const entry = this.pages.get(key(target)), connection = this.options.connection(target.connectionId)
    if (!entry?.url || !connection || connection.status !== 'ready' || connection.hostId !== target.hostId) throw new DesktopFailure('PAGE_EXPIRED', 'This agent page has completed or its runtime connection has changed.')
    if (!this.selected(target)) throw new DesktopFailure('STALE_SELECTION', 'Select the source conversation before opening its agent page.')
    this.options.open(entry.url)
    entry.page = { ...entry.page, status: 'opened' }
    this.options.emit({ type: 'agent-page', page: { ...entry.page } })
  }
  private selected(target: AgentPageTarget): boolean {
    const selected = this.options.selection()
    return selected?.hostId === target.hostId && selected.connectionId === target.connectionId && selected.sessionId === target.sessionId
  }
  private progress(id: string, text: string): void {
    const entry = this.pages.get(id)
    if (!entry) return
    const match = /(?:^|\s)(http:\/\/127\.0\.0\.1:(\d+)\/[A-Za-z0-9_-]{43})$/.exec(text.trim())
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535 || entry.url === match[1]) return
    entry.url = match[1]
    entry.page = { ...entry.page, status: 'available' }
    this.options.emit({ type: 'agent-page', page: { ...entry.page } })
    if (this.selected(entry.page)) this.open({ hostId: entry.page.hostId, connectionId: entry.page.connectionId, sessionId: entry.page.sessionId, itemId: entry.page.itemId })
  }
  private invalidate(id: string): void {
    const entry = this.pages.get(id)
    this.pages.delete(id)
    if (entry?.url) this.options.emit({ type: 'agent-page', page: { ...entry.page, status: 'invalidated' } })
  }
}
