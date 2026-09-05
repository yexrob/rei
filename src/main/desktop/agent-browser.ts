import type { DesktopEvent } from '../../shared/desktop'

/** Only an approved, running ShowPage can request automatic in-app presentation. */
export class AgentBrowser {
  private readonly pages = new Map<string, string | null>()
  route(event: DesktopEvent): string | null {
    if (event.type === 'connection') {
      if (event.connection.status !== 'ready') this.pages.clear()
      return null
    }
    if (event.type !== 'rpc' || event.method !== 'event') return null
    const frame = event.params, data = frame.event
    const key = (item: string) => `${event.connectionId}:${frame.session}:${item}`
    if (data.type === 'itemStarted' || data.type === 'itemUpdated') {
      const item = data.item
      if (item.body.kind === 'toolCall' && item.body.name === 'ShowPage' && item.status === 'running') {
        const id = key(item.id)
        if (!this.pages.has(id)) this.pages.set(id, null)
        if (this.pages.size > 128) this.pages.delete(this.pages.keys().next().value!)
        return item.body.progress ? this.open(id, item.body.progress) : null
      }
    }
    if (data.type === 'itemCompleted') this.pages.delete(key(data.item.id))
    if (data.type === 'itemDelta' && data.kind === 'tail') return this.open(key(data.item), data.data)
    return null
  }
  private open(key: string, progress: string): string | null {
    if (!this.pages.has(key)) return null
    const match = /(?:^|\s)(http:\/\/127\.0\.0\.1:(\d+)\/[A-Za-z0-9_-]{43})$/.exec(progress.trim())
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535 || this.pages.get(key) === match[1]) return null
    this.pages.set(key, match[1])
    return match[1]
  }
}
