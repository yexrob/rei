import { app, dialog, ipcMain, nativeTheme, shell, type BrowserWindow } from 'electron'
import { open, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { z } from 'zod'
import { DESKTOP_IMAGE_LIMITS, DESKTOP_IPC, type ConfigureProviderInput, type DesktopPreferences, type DesktopRequest, type Result } from '../../shared/desktop'
import type { Image } from '../../shared/rpc'
import { discoverBinary, executable, workspaceDirectory, type BinaryLocation } from './binary'
import { PreferencesStore } from './preferences'
import { configureProvider, configureProviderSchema } from './provider-setup'
import { DesktopRuntime } from './runtime'
import { DesktopFailure } from './rpc-client'
import { ScratchWorkspace } from './scratchWorkspace'
import { connectSchema, deletionSchema, exportSchema, externalUrl, preferencesPatchSchema, requestSchema, suggestedFilename, trustedSender } from './security'

type Options = { window(): BrowserWindow | null; documentUrl: string; preferences: PreferencesStore; runtime: DesktopRuntime; onDialogChange?(open: boolean): void }
export class DesktopIpc {
  private readonly binaries = new Set<string>()
  private readonly workspaces = new Set<string>()
  private scratch!: ScratchWorkspace
  private binary: BinaryLocation = { path: null, source: 'not found' }
  private dialogOpen = false
  private setup: Promise<void> | null = null
  get busy(): boolean { return this.setup !== null }
  get currentWorkspace(): string { return this.options.runtime.connection.workspace ?? this.options.preferences.preferences.workspace ?? this.scratch.path }
  async shutdown(): Promise<void> { await this.setup?.catch(() => {}) }
  constructor(private readonly options: Options) {}

  async initialize(): Promise<void> {
    this.scratch = await ScratchWorkspace.create(app.getPath('temp'), app.getPath('userData'))
    this.workspaces.add(this.scratch.path)
    const preferences = this.projectPreferences(this.options.preferences.preferences)
    this.binary = await discoverBinary({ appPath: app.getAppPath(), resourcesPath: process.resourcesPath, packaged: app.isPackaged, preference: preferences.binaryPath })
    if (this.binary.path) this.binaries.add(this.binary.path)
    for (const path of [preferences.workspace, ...preferences.recentWorkspaces]) if (path) this.workspaces.add(path)
    if (!app.isPackaged && process.env.BINGO_GUI_CWD) {
      try { this.workspaces.add(await workspaceDirectory(process.env.BINGO_GUI_CWD)) } catch { /* A missing dev workspace is not a startup failure. */ }
    }
    this.register()
  }

  private register(): void {
    this.handle(DESKTOP_IPC.bootstrap, z.undefined(), async () => {
      const preferences = this.projectPreferences(this.options.preferences.preferences)
      if (!preferences.workspace && !app.isPackaged && process.env.BINGO_GUI_CWD) {
        try { preferences.workspace = await workspaceDirectory(process.env.BINGO_GUI_CWD) } catch { /* Personal space remains available without a dev workspace. */ }
      }
      return { version: app.getVersion(), platform: process.platform, scratchWorkspace: await this.scratch.ensure(), preferences: this.projectPreferences(preferences), binary: this.binary, connection: this.options.runtime.connection }
    })
    this.handle(DESKTOP_IPC.configureProvider, configureProviderSchema, (input) => {
      if (this.setup) throw new DesktopFailure('SETUP_IN_PROGRESS', 'Finish the current provider setup first.')
      this.setup = this.configure(input).finally(() => { this.setup = null })
      return this.setup
    })
    this.handle(DESKTOP_IPC.connect, connectSchema, (input) => {
      if (this.setup) throw new DesktopFailure('SETUP_IN_PROGRESS', 'Finish provider setup before reconnecting.')
      return this.connect(input)
    })
    this.handle(DESKTOP_IPC.request, requestSchema, (input) => {
      if (this.setup) throw new DesktopFailure('SETUP_IN_PROGRESS', 'Finish provider setup, then reconnect to continue.')
      this.workspaceScope(input as DesktopRequest)
      return this.options.runtime.request(input as DesktopRequest)
    })
    this.handle(DESKTOP_IPC.chooseWorkspace, z.undefined(), () => this.chooseWorkspace())
    this.handle(DESKTOP_IPC.chooseBinary, z.undefined(), () => this.chooseBinary())
    this.handle(DESKTOP_IPC.chooseImages, z.undefined(), () => this.chooseImages())
    this.handle(DESKTOP_IPC.savePreferences, preferencesPatchSchema, async (patch) => {
      if (patch.workspace && !this.workspaces.has(patch.workspace)) throw new DesktopFailure('WORKSPACE_NOT_APPROVED', 'Choose the workspace using the native folder picker.')
      if (patch.binaryPath && !this.binaries.has(patch.binaryPath)) throw new DesktopFailure('BINARY_NOT_APPROVED', 'Choose the binary using the native file picker.')
      const result = this.projectPreferences(await this.options.preferences.save(patch.workspace === this.scratch.path ? { ...patch, workspace: null } : patch))
      nativeTheme.themeSource = result.theme
      if ('binaryPath' in patch) this.binary = await discoverBinary({ appPath: app.getAppPath(), resourcesPath: process.resourcesPath, packaged: app.isPackaged, preference: result.binaryPath })
      if (this.binary.path) this.binaries.add(this.binary.path)
      return result
    })
    this.handle(DESKTOP_IPC.openExternal, z.string().max(4096), async (url) => { await shell.openExternal(externalUrl(url)) })
    this.handle(DESKTOP_IPC.exportText, exportSchema, (input) => this.withDialog(async () => {
      const result = await dialog.showSaveDialog(this.window(), { title: 'Export conversation', defaultPath: suggestedFilename(input.suggestedName), filters: [{ name: 'Text / Markdown', extensions: ['md', 'txt'] }] })
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, input.text, { encoding: 'utf8', mode: 0o600 })
      return true
    }))
    this.handle(DESKTOP_IPC.deleteSession, deletionSchema, (input) => this.withDialog(async () => {
      const choice = await dialog.showMessageBox(this.window(), { type: 'warning', title: 'Delete conversation?', message: 'Delete this conversation permanently?', detail: 'Its saved history will be deleted by bingo. This cannot be undone.', buttons: ['Cancel', 'Delete conversation'], defaultId: 0, cancelId: 0, noLink: true })
      if (choice.response !== 1) return false
      await this.options.runtime.deleteSession(input.connectionId, input.session)
      return true
    }))
  }

  private async configure(input: ConfigureProviderInput): Promise<void> {
    const connection = this.options.runtime.connection
    const binary = connection.binary ?? this.binary.path
    const workspace = connection.workspace ?? this.options.preferences.preferences.workspace ?? this.scratch.path
    if (!binary || !this.binaries.has(binary) || !this.workspaces.has(workspace)) throw new DesktopFailure('SETUP_NOT_READY', 'Choose an available native binary before adding a provider.')
    if (this.options.runtime.busy) throw new DesktopFailure('RUNTIME_BUSY', 'Stop or finish running work before adding a provider.')
    const approved = await this.withDialog(async () => {
      const result = await dialog.showMessageBox(this.window(), {
        type: 'warning', title: 'Add provider', message: `Add provider “${input.name}”?`,
        detail: `bingo will save this ${input.protocol}-compatible endpoint to its user settings and the optional key to its credential store. The key is sent only to the native CLI over stdin, never to a session.\n\nEndpoint: ${input.baseUrl || 'Protocol default'}\n\nThe current runtime will disconnect. Reconnect after setup.${input.baseUrl.startsWith('http:') ? '\n\nWarning: this endpoint uses unencrypted HTTP.' : ''}`,
        buttons: ['Cancel', 'Save provider'], defaultId: 0, cancelId: 0, noLink: true
      })
      return result.response === 1
    })
    if (!approved) throw new DesktopFailure('CANCELLED', 'Provider setup was cancelled. Nothing was written.')
    const path = await executable(binary)
    const directory = workspace === this.scratch.path ? await this.scratch.ensure() : await workspaceDirectory(workspace)
    if (this.options.runtime.connection.connectionId !== connection.connectionId) throw new DesktopFailure('STALE_CONNECTION', 'The runtime changed while provider setup was awaiting approval. Try again.')
    if (this.options.runtime.busy) throw new DesktopFailure('RUNTIME_BUSY', 'Work started while provider setup was awaiting approval. Stop or finish it before trying again.')
    await this.options.runtime.close()
    await configureProvider(path, directory, input)
  }

  private async connect(input: { workspace?: string; binary?: string }) {
    const binary = input.binary ?? this.binary.path
    const requestedWorkspace = input.workspace ?? this.scratch.path
    if (!binary || !this.binaries.has(binary)) throw new DesktopFailure('BINARY_NOT_APPROVED', 'Choose an available bingo-improve executable using the native file picker.')
    if (!this.workspaces.has(requestedWorkspace)) throw new DesktopFailure('WORKSPACE_NOT_APPROVED', 'Choose a workspace using the native folder picker.')
    const path = await executable(binary)
    const scratch = requestedWorkspace === this.scratch.path
    const workspace = scratch ? await this.scratch.ensure() : await workspaceDirectory(requestedWorkspace)
    if (this.options.runtime.busy) {
      const connectionId = this.options.runtime.connection.connectionId
      const allowed = await this.withDialog(() => confirmStop(this.window(), 'Switch workspace or reconnect?', 'Running work will stop when this runtime connection is replaced.'))
      if (!allowed) throw new DesktopFailure('CANCELLED', 'The existing connection was kept.')
      if (scratch) await this.scratch.ensure()
      if (this.options.runtime.connection.connectionId !== connectionId) throw new DesktopFailure('STALE_CONNECTION', 'The runtime changed while awaiting approval. Try again.')
    }
    const connected = await this.options.runtime.connect(path, workspace)
    this.workspaces.add(workspace)
    // A preferences write failure must not pretend that the runtime failed to connect.
    await this.options.preferences.save({ workspace: workspace === this.scratch.path ? null : workspace }).catch(() => {})
    return connected
  }

  private projectPreferences(preferences: DesktopPreferences): DesktopPreferences {
    return { ...preferences, workspace: preferences.workspace === this.scratch.path ? null : preferences.workspace, recentWorkspaces: preferences.recentWorkspaces.filter((path) => path !== this.scratch.path) }
  }

  private workspaceScope(input: DesktopRequest): void {
    const workspace = this.options.runtime.connection.workspace
    if (input.method !== 'session/open') return
    const params = input.params as { selector?: { kind: string; spec?: { cwd?: string }; cwd?: string } }
    const selector = params.selector
    const requested = selector?.kind === 'create' ? selector.spec?.cwd : selector?.kind === 'latest' ? selector.cwd : undefined
    if (requested !== undefined && requested !== workspace) throw new DesktopFailure('WORKSPACE_MISMATCH', 'New sessions must use the connected workspace.')
  }

  private chooseWorkspace(): Promise<string | null> {
    return this.withDialog(async () => {
      const choice = await dialog.showOpenDialog(this.window(), { title: 'Open workspace', properties: ['openDirectory'] })
      if (choice.canceled || !choice.filePaths[0]) return null
      const workspace = await workspaceDirectory(choice.filePaths[0])
      this.workspaces.add(workspace)
      return workspace
    })
  }
  private chooseBinary(): Promise<string | null> {
    return this.withDialog(async () => {
      const choice = await dialog.showOpenDialog(this.window(), { title: 'Choose bingo-improve binary', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Native executable', extensions: ['exe'] }] } : {}) })
      if (choice.canceled || !choice.filePaths[0]) return null
      const binary = await executable(choice.filePaths[0])
      this.binaries.add(binary)
      return binary
    })
  }
  private chooseImages(): Promise<Image[]> {
    return this.withDialog(async () => {
      const choice = await dialog.showOpenDialog(this.window(), { title: 'Attach images', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] })
      if (choice.canceled) return []
      if (choice.filePaths.length > DESKTOP_IMAGE_LIMITS.count) throw new DesktopFailure('TOO_MANY_IMAGES', 'Choose at most two images per message (5 MB each).')
      return Promise.all(choice.filePaths.map(readImage))
    })
  }
  private async withDialog<T>(operation: () => Promise<T>): Promise<T> {
    if (this.dialogOpen) throw new DesktopFailure('DIALOG_OPEN', 'Finish the existing native dialog first.')
    this.dialogOpen = true
    this.options.onDialogChange?.(true)
    try { return await operation() } finally { this.dialogOpen = false; this.options.onDialogChange?.(false) }
  }
  private window(): BrowserWindow {
    const window = this.options.window()
    if (!window || window.isDestroyed()) throw new DesktopFailure('WINDOW_CLOSED', 'The desktop window is closed.')
    return window
  }
  private handle<T>(channel: string, schema: z.ZodType<T>, operation: (input: T) => unknown): void {
    ipcMain.handle(channel, async (event, input): Promise<Result<unknown>> => {
      const window = this.options.window()
      if (!window || !trustedSender(event, window.webContents, this.options.documentUrl)) return { ok: false, error: { code: 'UNTRUSTED_SENDER', message: 'This IPC sender is not allowed.' } }
      try { return { ok: true, value: await operation(schema.parse(input)) } }
      catch (error) {
        if (error instanceof DesktopFailure) return { ok: false, error: { code: error.code, message: error.message } }
        if (error instanceof z.ZodError) return { ok: false, error: { code: 'INVALID_INPUT', message: 'The desktop request has an invalid shape.' } }
        return { ok: false, error: { code: 'DESKTOP_ERROR', message: 'The desktop operation failed. Check that the selected path exists and is accessible.' } }
      }
    })
  }
}

async function readImage(path: string): Promise<Image> {
  const mediaType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' } as Record<string, string>)[extname(path).toLowerCase()]
  if (!mediaType) throw new DesktopFailure('INVALID_IMAGE', 'Unsupported image format.')
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > DESKTOP_IMAGE_LIMITS.bytesPerImage) throw new DesktopFailure('INVALID_IMAGE', 'Images must be regular files no larger than 5 MB.')
    // Fixed-size read also bounds a file that grows after stat.
    const bytes = Buffer.alloc(DESKTOP_IMAGE_LIMITS.bytesPerImage + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, null)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    if (length > DESKTOP_IMAGE_LIMITS.bytesPerImage) throw new DesktopFailure('INVALID_IMAGE', 'The selected image exceeds 5 MB.')
    return { mediaType, data: bytes.subarray(0, length).toString('base64') }
  } finally { await file.close() }
}

export async function confirmStop(window: BrowserWindow | null, message: string, detail: string): Promise<boolean> {
  const options: Electron.MessageBoxOptions = { type: 'warning', title: 'Running work', message, detail, buttons: ['Keep working', 'Stop and continue'], defaultId: 0, cancelId: 0, noLink: true }
  const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
  return result.response === 1
}
