import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  IPC, connectionInputSchema, sessionOpenInputSchema, sessionPromptInputSchema, sessionSendInputSchema,
  sessionTurnInputSchema, visualCaptureInputSchema, type AppInfo, type RendererSessionEvent, type Result,
  type RuntimeInfo, type SessionOpened
} from '../../shared/contracts/ipc'
import { RuntimeLocator } from '../runtime/runtimeLocator'
import { SessionManager } from '../runtime/sessionManager'
import { VisualCapture, visualCaptureEnabled } from '../visual/capture'

export function registerIpc(window: BrowserWindow, locator: RuntimeLocator, sessions: SessionManager): void {
  const trusted = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender')
  }
  const operationalError = <T>(error: unknown): Result<T> => ({ ok: false, error: { code: 'OPERATION_FAILED', msg: error instanceof Error ? error.message : 'The operation failed. Retry.', level: 'page', recoverable: true, action: 'retry' } })
  const handle = <TInput, TOutput>(channel: string, schema: { parse(value: unknown): TInput }, operation: (input: TInput) => Promise<TOutput>): void => {
    ipcMain.handle(channel, async (event, raw): Promise<Result<TOutput>> => {
      trusted(event)
      try { return { ok: true, value: await operation(schema.parse(raw)) } } catch (error) { return operationalError(error) }
    })
  }

  ipcMain.handle(IPC.appGetInfo, (event): Result<AppInfo> => {
    trusted(event)
    return { ok: true, value: { appVersion: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged } }
  })
  ipcMain.handle(IPC.runtimeProbe, async (event): Promise<Result<RuntimeInfo>> => {
    trusted(event)
    return locator.probe(process.env.BINGO_GUI_CWD ?? process.cwd())
  })
  handle(IPC.sessionOpen, sessionOpenInputSchema, async ({ sessionId }): Promise<SessionOpened> => {
    const opened = await sessions.open(sessionId ?? undefined)
    const { transcriptPath: _, ...metadata } = opened.metadata
    return { connectionId: opened.connectionId, metadata, history: [] }
  })
  handle(IPC.sessionClose, connectionInputSchema, async ({ connectionId }) => { await sessions.close(connectionId); return { closed: true as const } })
  handle(IPC.sessionSend, sessionSendInputSchema, async ({ connectionId, turnId, prompt }) => { await sessions.send(connectionId, turnId, prompt); return { accepted: true as const } })
  handle(IPC.sessionCancel, sessionTurnInputSchema, async ({ connectionId, turnId }) => { await sessions.cancel(connectionId, turnId); return { requested: true as const } })
  handle(IPC.sessionRespondPrompt, sessionPromptInputSchema, async ({ connectionId, turnId, promptId, response }) => { await sessions.respond(connectionId, turnId, promptId, response); return { accepted: true as const } })

  if (visualCaptureEnabled(app.isPackaged)) {
    const capture = new VisualCapture(window, app.getAppPath())
    handle(IPC.visualCapture, visualCaptureInputSchema, async (input) => ({ absolutePath: await capture.capture(input) }))
  }
}

export function sendSessionEvent(window: BrowserWindow, event: RendererSessionEvent): void {
  if (!window.isDestroyed()) window.webContents.send(IPC.sessionEvent, event)
}
