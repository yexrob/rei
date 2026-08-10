import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  IPC, connectionInputSchema, modelListInputSchema, runtimeSettingsInputSchema, runtimeSettingsSaveInputSchema, sessionDeleteInputSchema, sessionOpenInputSchema, sessionPromptInputSchema, sessionRenameInputSchema, sessionSendInputSchema,
  sessionTurnInputSchema, visualCaptureInputSchema, type AppInfo, type RendererSessionEvent, type Result,
  type RuntimeInfo, type RuntimeSettings, type SessionOpened
} from '../../shared/contracts/ipc'
import { RuntimeLocator } from '../runtime/runtimeLocator'
import { BingoInspector } from '../runtime/bingoInspector'
import { BingoCommandError } from '../runtime/bingoSession'
import { SessionManager } from '../runtime/sessionManager'
import { SettingsRepository } from '../storage/settingsRepository'
import { TranscriptRepository } from '../storage/transcriptRepository'
import { VisualCapture, visualCaptureEnabled } from '../visual/capture'

export function registerIpc(
  window: BrowserWindow,
  locator: RuntimeLocator,
  sessions: SessionManager,
  transcripts: TranscriptRepository,
  settings: SettingsRepository,
  binaryPath: string
): void {
  const trusted = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender')
  }
  const operationalError = <T>(error: unknown): Result<T> => {
    if (error instanceof BingoCommandError) return { ok: false, error: { code: error.code, msg: error.message, level: error.level, recoverable: error.recoverable } }
    return { ok: false, error: { code: 'OPERATION_FAILED', msg: error instanceof Error ? error.message : 'The operation failed. Retry.', level: 'page', recoverable: true, action: 'retry' } }
  }
  const handle = <TInput, TOutput>(channel: string, schema: { parse(value: unknown): TInput }, operation: (input: TInput) => Promise<TOutput>): void => {
    ipcMain.handle(channel, async (event, raw): Promise<Result<TOutput>> => {
      trusted(event)
      try { return { ok: true, value: await operation(schema.parse(raw)) } } catch (error) { return operationalError(error) }
    })
  }

  const withInspector = async <T>(workspacePath: string, operation: (inspector: BingoInspector) => Promise<T>): Promise<T> => {
    const inspector = new BingoInspector(binaryPath, workspacePath)
    try {
      await inspector.open()
      return await operation(inspector)
    } finally {
      await inspector.close()
    }
  }
  const readInventory = async (workspacePath: string): Promise<Awaited<ReturnType<BingoInspector['listProviders']>>> => {
    const active = sessions.snapshot()
    return active?.idle ? sessions.listProviders() : withInspector(workspacePath, (inspector) => inspector.listProviders())
  }
  const readModels = async (workspacePath: string, provider: string): Promise<string[]> => {
    const active = sessions.snapshot()
    return active?.idle ? sessions.listModels(provider) : withInspector(workspacePath, (inspector) => inspector.listModels(provider))
  }
  const readRuntimeSettings = async (workspacePath: string): Promise<RuntimeSettings> => {
    const providers = await readInventory(workspacePath)
    const metadata = sessions.currentMetadata()
    return {
      providers,
      provider: metadata?.provider ?? 'default',
      model: metadata?.model ?? '',
      thinkingLevel: metadata?.thinkingLevel ?? 'off'
    }
  }

  ipcMain.handle(IPC.appGetInfo, (event): Result<AppInfo> => {
    trusted(event)
    return { ok: true, value: { appVersion: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged } }
  })
  ipcMain.handle(IPC.runtimeProbe, async (event): Promise<Result<RuntimeInfo>> => {
    trusted(event)
    return locator.probe(process.env.BINGO_GUI_CWD ?? process.cwd())
  })
  ipcMain.handle(IPC.sessionList, async (event): Promise<Result<Awaited<ReturnType<TranscriptRepository['list']>>>> => {
    trusted(event)
    try { return { ok: true, value: await transcripts.list() } } catch (error) { return operationalError(error) }
  })
  handle(IPC.sessionOpen, sessionOpenInputSchema, async ({ sessionId }): Promise<SessionOpened> => {
    const history = sessionId ? (await transcripts.load(sessionId)).history : []
    const opened = await sessions.open(sessionId ?? undefined)
    const { transcriptPath: _, ...metadata } = opened.metadata
    return { connectionId: opened.connectionId, metadata, history }
  })
  handle(IPC.sessionRename, sessionRenameInputSchema, async ({ sessionId, name }) => {
    const metadata = await sessions.rename(sessionId, name)
    const listed = await transcripts.list()
    const session = listed.sessions.find((item) => item.id === metadata.sessionId)
    if (!session) throw new Error('Renamed session is missing from the transcript list')
    return { previousId: sessionId, session }
  })
  handle(IPC.sessionDelete, sessionDeleteInputSchema, async ({ sessionId }) => ({ deletedId: await sessions.delete(sessionId) }))
  handle(IPC.settingsReadRuntime, runtimeSettingsInputSchema, async ({ workspacePath }) => readRuntimeSettings(workspacePath))
  handle(IPC.settingsListModels, modelListInputSchema, async ({ workspacePath, provider }) => {
    const models = await readModels(workspacePath, provider)
    return { provider, models }
  })
  handle(IPC.settingsSaveRuntime, runtimeSettingsSaveInputSchema, async ({ workspacePath, provider, model, thinkingLevel }) => {
    const active = sessions.snapshot()
    if (active && !active.idle) throw new Error('Finish or cancel the active turn before changing provider settings')
    const providers = await readInventory(workspacePath)
    if (!providers.some((item) => item.name === provider)) throw new BingoCommandError('CONFIG_INVALID', `Provider "${provider}" is not available. Choose a listed provider.`, 'field', true)
    const models = await readModels(workspacePath, provider)
    if (!models.includes(model)) throw new BingoCommandError('CONFIG_INVALID', `Model "${model}" is not available for ${provider}. Choose a listed model.`, 'field', true)
    await settings.saveRuntime({ provider, model, thinkingLevel })
    let connectionId: string | undefined
    if (active) connectionId = (await sessions.open(active.sessionId)).connectionId
    const runtimeSettings: RuntimeSettings = { providers, provider, model, thinkingLevel }
    return connectionId ? { connectionId, settings: runtimeSettings } : { settings: runtimeSettings }
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
