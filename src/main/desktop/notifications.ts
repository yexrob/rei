import { app, Notification, type BrowserWindow } from 'electron'
import { DESKTOP_IPC, type AttentionNotice } from '../../shared/desktop'

type Options = { window(): BrowserWindow | null; enabled(): boolean; platform?: NodeJS.Platform }

/**
 * Native attention notices. The renderer supplies localized, schema-bounded text;
 * Main decides whether to show it (preference on, window not focused) and owns
 * the click: it focuses the window and asks the renderer to open that session.
 */
export class AttentionNotifications {
  // Electron drops click handlers of garbage-collected notifications.
  private readonly live = new Set<Notification>()
  private badge = -1
  constructor(private readonly options: Options) {}

  show(input: AttentionNotice): boolean {
    const window = this.options.window()
    if (!this.options.enabled() || !window || window.isDestroyed() || window.isFocused() || !Notification.isSupported()) return false
    const notice = new Notification({ title: input.title, body: input.body, silent: input.kind === 'completed' })
    const release = (): void => { this.live.delete(notice) }
    notice.on('click', () => {
      release()
      const target = this.options.window()
      if (!target || target.isDestroyed()) return
      if (target.isMinimized()) target.restore()
      target.show(); target.focus()
      // A tiny, rare control message: sent directly, not through the bounded event window.
      if (!target.webContents.isDestroyed()) target.webContents.send(DESKTOP_IPC.notificationActivated, { hostId: input.hostId, sessionId: input.sessionId })
    })
    notice.on('close', release)
    notice.on('failed', release)
    while (this.live.size >= 16) { const oldest = this.live.values().next().value; if (!oldest) break; this.live.delete(oldest); oldest.close() }
    this.live.add(notice)
    notice.show()
    return true
  }

  /** Badge counts are supported on macOS and Unity-compatible Linux launchers. */
  setBadgeCount(count: number): void {
    const platform = this.options.platform ?? process.platform
    if (platform !== 'darwin' && platform !== 'linux') return
    const next = this.options.enabled() ? count : 0
    if (next === this.badge) return
    this.badge = next
    try { app.setBadgeCount(next) } catch { /* Unsupported launchers ignore badges. */ }
  }

  close(): void { for (const notice of this.live) notice.close(); this.live.clear() }
}
