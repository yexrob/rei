import { ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { REVIEW_IPC, type ReviewSnapshot } from '../../../shared/review'
import type { Result } from '../../../shared/desktop'
import { DesktopFailure } from '../rpc-client'
import { trustedSender } from '../security'
import { readReview } from './git'

const inputSchema = z.strictObject({ scope: z.enum(['unstaged', 'staged']) })
type Options = { window(): BrowserWindow | null; documentUrl: string; workspace(): string | null }
export class Review {
  private active: AbortController | null = null
  private closed = false
  constructor(private readonly options: Options) {
    ipcMain.handle(REVIEW_IPC.snapshot, (event, input) => this.snapshot(event, input))
  }
  close(): void {
    this.closed = true
    this.active?.abort()
    ipcMain.removeHandler(REVIEW_IPC.snapshot)
  }
  private async snapshot(event: Electron.IpcMainInvokeEvent, input: unknown): Promise<Result<ReviewSnapshot>> {
    let controller: AbortController | null = null
    try {
      const window = this.options.window()
      if (this.closed || !window || window.isDestroyed() || !trustedSender(event, window.webContents, this.options.documentUrl)) throw new DesktopFailure('UNTRUSTED_SENDER', 'This request did not come from the desktop workspace.')
      const { scope } = inputSchema.parse(input)
      if (this.active) throw new DesktopFailure('REVIEW_BUSY', 'A Git review is already loading. Try refreshing when it finishes.')
      controller = new AbortController()
      this.active = controller
      const cwd = this.options.workspace()
      const value = await readReview(cwd, scope, controller.signal)
      if (this.closed || cwd !== this.options.workspace() || !trustedSender(event, window.webContents, this.options.documentUrl)) throw new DesktopFailure('STALE_WORKSPACE', 'The workspace changed. Refresh to review the current workspace.')
      return { ok: true, value }
    } catch (error) {
      if (error instanceof DesktopFailure) return { ok: false, error: { code: error.code, message: error.message } }
      if (error instanceof z.ZodError) return { ok: false, error: { code: 'INVALID_INPUT', message: 'The review request has an invalid shape.' } }
      return { ok: false, error: { code: 'REVIEW_ERROR', message: 'Git review failed. Check that Git is installed and the workspace is readable, then refresh.' } }
    } finally { if (controller && this.active === controller) this.active = null }
  }
}
