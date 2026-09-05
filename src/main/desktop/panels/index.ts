import { ipcMain, type BrowserWindow, type WebContents } from 'electron'
import { z } from 'zod'
import { PANELS_IPC, type PanelsEvent } from '../../../shared/panels'
import type { Result } from '../../../shared/desktop'
import { DesktopFailure } from '../rpc-client'
import { sameDocument, trustedSender } from '../security'
import { PanelBrowser } from './browser'
import { PanelTerminal } from './terminal'
import { browserActionSchema, browserLayoutSchema, terminalAckSchema, terminalIdSchema, terminalResizeSchema, terminalWriteSchema, webUrlSchema } from './validation'

type Options = { window(): BrowserWindow | null; documentUrl: string; workspace(): string | null }
export class Panels {
  private readonly browser: PanelBrowser
  private readonly terminal: PanelTerminal
  private readonly channels: string[] = []
  private boundContents: WebContents | null = null
  private closed = false
  private closing: Promise<void> | null = null
  constructor(private readonly options: Options) {
    const emit = (event: PanelsEvent): void => this.emit(event)
    this.browser = new PanelBrowser({ ...options, emit })
    this.terminal = new PanelTerminal({ workspace: options.workspace, emit })
    this.handle(PANELS_IPC.snapshot, z.undefined(), () => ({ browser: this.browser.snapshot(), terminal: this.terminal.snapshot() }))
    this.handle(PANELS_IPC.browserNavigate, webUrlSchema, (url) => this.browser.navigate(url))
    this.handle(PANELS_IPC.browserAction, browserActionSchema, (action) => this.browser.action(action))
    this.handle(PANELS_IPC.browserLayout, browserLayoutSchema, (layout) => this.browser.setLayout(layout))
    this.handle(PANELS_IPC.terminalStart, z.undefined(), () => this.terminal.start())
    this.handle(PANELS_IPC.terminalWrite, terminalWriteSchema, ({ id, data }) => this.terminal.write(id, data))
    this.handle(PANELS_IPC.terminalResize, terminalResizeSchema, ({ id, cols, rows }) => this.terminal.resize(id, cols, rows))
    this.handle(PANELS_IPC.terminalStop, terminalIdSchema, (id) => this.terminal.stop(id))
    this.handle(PANELS_IPC.terminalAck, terminalAckSchema, ({ id, sequence }) => this.terminal.ack(id, sequence))
  }
  get busy(): boolean { return ['running', 'stopping'].includes(this.terminal.snapshot().status) }
  openBrowser(url: string): void { if (!this.closed) { this.bindWindow(); this.browser.open(url) } }
  setBrowserOccluded(value: boolean): void { this.browser.setOccluded(value) }
  close(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.closing) return this.closing
    this.browser.close()
    this.closing = this.terminal.close().then(() => {
      this.closed = true
      this.unbindWindow()
      for (const channel of this.channels) ipcMain.removeHandler(channel)
    }).finally(() => { this.closing = null })
    return this.closing
  }
  private emit(event: PanelsEvent): void {
    const window = this.options.window()
    if (this.closed || !window || window.isDestroyed() || window.webContents.isDestroyed()) return
    if (!sameDocument(window.webContents.mainFrame.url, this.options.documentUrl)) return
    window.webContents.send(PANELS_IPC.event, event)
  }
  private handle<S extends z.ZodType, T>(channel: string, schema: S, action: (input: z.output<S>) => T | Promise<T>): void {
    ipcMain.handle(channel, async (event, input): Promise<Result<T>> => {
      try {
        const window = this.options.window()
        if (this.closed || !window || window.isDestroyed() || !trustedSender(event, window.webContents, this.options.documentUrl)) throw new DesktopFailure('UNTRUSTED_SENDER', 'This request did not come from the desktop workspace.')
        if (this.closing) throw new DesktopFailure('PANELS_CLOSING', 'The desktop panels are closing.')
        this.bindWindow()
        return { ok: true, value: await action(schema.parse(input)) }
      } catch (error) {
        if (error instanceof DesktopFailure) return { ok: false, error: { code: error.code, message: error.message } }
        if (error instanceof z.ZodError) return { ok: false, error: { code: 'INVALID_INPUT', message: 'The panel request has an invalid shape.' } }
        return { ok: false, error: { code: 'PANEL_ERROR', message: 'The panel operation failed. Try again.' } }
      }
    })
    this.channels.push(channel)
  }
  private bindWindow(): void {
    const contents = this.options.window()?.webContents
    if (!contents || contents === this.boundContents) return
    if (this.boundContents) { void this.terminal.close().catch(() => {}); this.browser.close() }
    this.unbindWindow()
    this.boundContents = contents
    contents.on('did-start-navigation', this.onNavigation)
    contents.on('render-process-gone', this.onRendererGone)
    contents.on('destroyed', this.onRendererGone)
  }
  private onNavigation = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean): void => {
    if (mainFrame && !inPlace) { this.browser.hide(); void this.terminal.close().catch(() => {}) }
  }
  private onRendererGone = (): void => { this.browser.hide(); void this.terminal.close().catch(() => {}) }
  private unbindWindow(): void {
    this.boundContents?.off('did-start-navigation', this.onNavigation)
    this.boundContents?.off('render-process-gone', this.onRendererGone)
    this.boundContents?.off('destroyed', this.onRendererGone)
    this.boundContents = null
  }
}
