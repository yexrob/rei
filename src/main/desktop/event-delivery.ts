import { ipcMain, type BrowserWindow } from 'electron'
import { DESKTOP_IPC, type DesktopEvent } from '../../shared/desktop'
import { trustedSender } from './security'
import { DesktopFailure } from './rpc-client'

/** Renderer acknowledgements bound Electron's otherwise unbounded IPC queue. */
export class EventDelivery {
  private nextId = 0
  private bytes = 0
  private readonly pending = new Map<number, number>()
  constructor(private readonly window: () => BrowserWindow | null, documentUrl: string, private readonly overflow: (error: DesktopFailure) => void) {
    ipcMain.on('desktop:event-ack', (event, id: unknown) => {
      const target = window()
      if (!target || !trustedSender(event, target.webContents, documentUrl) || typeof id !== 'number') return
      const size = this.pending.get(id)
      if (size === undefined) return
      this.pending.delete(id)
      this.bytes -= size
    })
  }
  reset(): void { this.pending.clear(); this.bytes = 0 }
  send(event: DesktopEvent): void {
    const target = this.window()
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return
    const size = Buffer.byteLength(JSON.stringify(event))
    if (this.pending.size >= 256 || this.bytes + size > 32 * 1024 * 1024) {
      this.reset()
      this.overflow(new DesktopFailure('RENDERER_BACKPRESSURE', 'The window could not keep up with runtime events. Reconnect to recover an authoritative snapshot.'))
      return
    }
    const id = ++this.nextId
    this.pending.set(id, size)
    this.bytes += size
    target.webContents.send(DESKTOP_IPC.event, { id, event })
  }
}
