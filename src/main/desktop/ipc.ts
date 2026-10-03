import { app, dialog, ipcMain, nativeTheme, shell, type BrowserWindow } from 'electron'
import { open, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { z } from 'zod'
import { DESKTOP_IMAGE_LIMITS, DESKTOP_IPC, type AgentPageState, type AgentPageTarget, type BoundedRequest, type ConfigureProviderInput, type DesktopEvent, type DesktopPreferences, type DesktopRequest, type ExportReferenceRequest, type HostEpoch, type PartRequest, type Result } from '../../shared/desktop'
import type { Image } from '../../shared/rpc'
import { discoverBinary, executable, workspaceDirectory, type BinaryLocation } from './binary'
import { PreferencesStore } from './preferences'
import { configureProvider, configureProviderSchema } from './provider-setup'
import { RuntimePool } from './runtime-pool'
import { DesktopFailure } from './rpc-client'
import { ScratchWorkspace } from './scratchWorkspace'
import { AttentionNotifications } from './notifications'
import { agentPageSchema, attentionNoticeSchema, badgeCountSchema, boundedRequestSchema, connectSchema, deletionSchema, exportReferenceSchema, exportSchema, externalUrl, hostEpochSchema, partRequestSchema, preferencesPatchSchema, requestSchema, selectionSchema, suggestedFilename, transferCancelSchema, trustedSender } from './security'
import { BoundedTransfers } from './bounded-transfers'
import { ReferenceExporter } from './reference-export'
import { text } from './locale'
import type { EventDelivery } from './event-delivery'

type Options = { window(): BrowserWindow | null; documentUrl: string; preferences: PreferencesStore; runtime: RuntimePool; delivery?: EventDelivery; emit?(event: DesktopEvent): void; agentPages?(): AgentPageState[]; openAgentPage?(input: AgentPageTarget): void; onDialogChange?(open: boolean): void }
export class DesktopIpc {
  private readonly binaries = new Set<string>()
  private readonly workspaces = new Set<string>()
  private scratch!: ScratchWorkspace
  private binary: BinaryLocation = { path: null, source: 'not found' }
  private dialogOpen = false
  private setup: Promise<void> | null = null
  private rendererGeneration = 0
  private rendererNavigating = false
  private readonly transfers: BoundedTransfers | null
  private readonly exporter: ReferenceExporter
  private readonly notifications: AttentionNotifications
  invalidateRenderer(): void { this.rendererGeneration += 1; this.rendererNavigating = true; this.transfers?.cancelAll(); this.exporter.cancelAll() }
  observeRuntimeEvent(event: DesktopEvent): void {
    if (event.type === 'connection' && event.connection.status !== 'ready') { this.transfers?.cancelHost(event.connection.hostId); this.exporter.cancelHost(event.connection.hostId) }
    if (event.type === 'runtime-invalidated') { this.transfers?.cancelAll(); this.exporter.cancelAll() }
  }
  rendererReady(): void { this.rendererGeneration += 1; this.rendererNavigating = false }
  get busy(): boolean { return this.setup !== null }
  get currentWorkspace(): string | null { return this.options.runtime.selectedConnection?.workspace ?? null }
  async shutdown(): Promise<void> { this.notifications.close(); this.transfers?.cancelAll(); this.exporter.cancelAll(); await this.setup?.catch(() => {}) }
  async flushExports(): Promise<void> { await this.exporter.waitForCleanup() }
  constructor(private readonly options: Options) {
    this.notifications = new AttentionNotifications({ window: options.window, enabled: () => options.preferences.preferences.notifications !== false })
    this.transfers = options.delivery ? new BoundedTransfers(options.runtime, options.delivery) : null
    this.exporter = new ReferenceExporter(options.runtime, name => this.withDialog(() => dialog.showSaveDialog(this.window(), { title: 'Save complete recorded JSON', defaultPath: name, filters: [{ name: 'JSON', extensions: ['json'] }] })), event => options.emit?.(event))
  }

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
    this.handle(DESKTOP_IPC.bootstrap, z.undefined(), async (_input, admit) => {
      await this.options.runtime.waitForClose()
      admit()
      const preferences = this.projectPreferences(this.options.preferences.preferences)
      if (!preferences.workspace && !app.isPackaged && process.env.BINGO_GUI_CWD) {
        try { preferences.workspace = await workspaceDirectory(process.env.BINGO_GUI_CWD) } catch { /* Personal space remains available without a dev workspace. */ }
      }
      return { version: app.getVersion(), platform: process.platform, scratchWorkspace: await this.scratch.ensure(), preferences: this.projectPreferences(preferences), binary: this.binary, connections: this.options.runtime.connections, selection: this.options.runtime.selection, agentPages: this.options.agentPages?.() ?? [] }
    })
    this.handle(DESKTOP_IPC.configureProvider, configureProviderSchema, (input, admit) => {
      if (this.setup) throw new DesktopFailure('SETUP_IN_PROGRESS', 'Finish the current provider setup first.')
      this.setup = this.configure(input, admit).finally(() => { this.setup = null })
      return this.setup
    })
    this.handle(DESKTOP_IPC.connect, connectSchema, (input, admit) => {
      if (this.setup) throw new DesktopFailure('SETUP_IN_PROGRESS', 'Finish provider setup before reconnecting.')
      return this.connect(input, admit)
    })
    this.handle(DESKTOP_IPC.reconnect, hostEpochSchema, (input, admit) => {
      if (this.setup) throw new DesktopFailure('SETUP_IN_PROGRESS', 'Finish provider setup before reconnecting.')
      return this.reconnect(input, admit)
    })
    this.handle(DESKTOP_IPC.closeHost, hostEpochSchema, (input) => {
      if (this.setup) throw new DesktopFailure('SETUP_IN_PROGRESS', 'Finish provider setup before closing a runtime.')
      return this.options.runtime.closeHost(input)
    })
    this.handle(DESKTOP_IPC.selectConversation, selectionSchema, (input) => {
      this.options.runtime.selectConversation(input)
      const workspace = this.currentWorkspace
      if (workspace) void this.options.preferences.save({ workspace: workspace === this.scratch.path ? null : workspace }).catch(() => {})
    })
    this.handle(DESKTOP_IPC.openAgentPage, agentPageSchema, (input) => {
      const connection = this.options.runtime.getConnection(input.connectionId)
      if (connection.hostId !== input.hostId) throw new DesktopFailure('STALE_CONNECTION', 'This page belongs to another project connection.')
      if (!this.options.openAgentPage) throw new DesktopFailure('PAGE_EXPIRED', 'This agent page is no longer available.')
      this.options.openAgentPage(input)
    })
    this.handle(DESKTOP_IPC.request, requestSchema, (input) => {
      if (this.setup) throw new DesktopFailure('SETUP_IN_PROGRESS', 'Finish provider setup, then reconnect to continue.')
      this.workspaceScope(input as DesktopRequest)
      if (['session/list', 'session/listHeads', 'session/open', 'session/history', 'session/children'].includes(input.method)) throw new DesktopFailure('BOUNDED_REQUIRED', 'Use the acknowledged bounded result bridge; an unbounded snapshot or list cannot cross invoke.')
      return this.options.runtime.request(input as DesktopRequest)
    })
    this.handle(DESKTOP_IPC.requestBounded, boundedRequestSchema, (input, admit) => {
      if (this.setup) throw new DesktopFailure('SETUP_IN_PROGRESS', 'Finish provider setup before loading a bounded result.')
      if (!this.transfers) throw new DesktopFailure('TRANSFER_UNAVAILABLE', 'The bounded renderer delivery window is unavailable.')
      admit()
      return this.transfers.requestBounded(input as BoundedRequest)
    })
    this.handle(DESKTOP_IPC.cancelBounded, transferCancelSchema, input => { this.transfers?.cancelBounded(input) })
    this.handle(DESKTOP_IPC.readPart, partRequestSchema, (input, admit) => {
      if (!this.transfers) throw new DesktopFailure('TRANSFER_UNAVAILABLE', 'The bounded renderer delivery window is unavailable.')
      admit()
      return this.transfers.readPart(input as PartRequest)
    })
    this.handle(DESKTOP_IPC.cancelPart, transferCancelSchema, input => { this.transfers?.cancelPart(input) })
    this.handle(DESKTOP_IPC.exportReference, exportReferenceSchema, (input, admit) => {
      if (this.setup) throw new DesktopFailure('SETUP_IN_PROGRESS', 'Finish provider setup before exporting recorded content.')
      admit()
      return this.exporter.exportReference(input as ExportReferenceRequest)
    })
    this.handle(DESKTOP_IPC.cancelExport, transferCancelSchema, input => { this.exporter.cancelExport(input) })
    this.handle(DESKTOP_IPC.chooseWorkspace, z.undefined(), () => this.chooseWorkspace())
    this.handle(DESKTOP_IPC.chooseBinary, z.undefined(), () => this.chooseBinary())
    this.handle(DESKTOP_IPC.chooseImages, z.undefined(), () => this.chooseImages())
    this.handle(DESKTOP_IPC.savePreferences, preferencesPatchSchema, async (patch) => {
      if (patch.workspace && !this.workspaces.has(patch.workspace)) throw new DesktopFailure('WORKSPACE_NOT_APPROVED', 'Choose the workspace using the native folder picker.')
      if (patch.binaryPath && !this.binaries.has(patch.binaryPath)) throw new DesktopFailure('BINARY_NOT_APPROVED', 'Choose the binary using the native file picker.')
      const result = this.projectPreferences(await this.options.preferences.save(patch.workspace === this.scratch.path ? { ...patch, workspace: null } : patch))
      nativeTheme.themeSource = result.theme
      if (patch.notifications === false) this.notifications.setBadgeCount(0)
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
    this.handle(DESKTOP_IPC.notify, attentionNoticeSchema, (input) => this.notifications.show(input))
    this.handle(DESKTOP_IPC.setBadgeCount, badgeCountSchema, (count) => { this.notifications.setBadgeCount(count) })
    this.handle(DESKTOP_IPC.deleteSession, deletionSchema, (input) => this.withDialog(async () => {
      const choice = await dialog.showMessageBox(this.window(), { type: 'warning', title: text('Delete conversation?'), message: text('Delete this conversation permanently?'), detail: text('Its saved history will be deleted by bingo. This cannot be undone.'), buttons: [text('Cancel'), text('Delete conversation')], defaultId: 0, cancelId: 0, noLink: true })
      if (choice.response !== 1) return false
      await this.options.runtime.deleteSession(input.connectionId, input.session)
      return true
    }))
  }

  private async configure(input: ConfigureProviderInput, admit: () => void): Promise<void> {
    const connection = this.options.runtime.selectedConnection
    const binary = connection?.binary ?? this.binary.path
    const workspace = connection?.workspace ?? this.options.preferences.preferences.workspace ?? this.scratch.path
    if (!binary || !this.binaries.has(binary) || !this.workspaces.has(workspace)) throw new DesktopFailure('SETUP_NOT_READY', 'Choose an available native binary before adding a provider.')
    if (this.options.runtime.busy) throw new DesktopFailure('RUNTIME_BUSY', 'Stop or finish running work before adding a provider.')
    const approved = await this.withDialog(async () => {
      const result = await dialog.showMessageBox(this.window(), {
        type: 'warning', title: text('Add provider'), message: text('Add provider “{name}”?', { name: input.name }),
        detail: [text('bingo will save this {protocol}-compatible endpoint to its user settings and the optional key to its credential store. The key is sent only to the native CLI over stdin, never to a session.', { protocol: input.protocol }), text('Endpoint: {endpoint}', { endpoint: input.baseUrl || text('Protocol default') }), text('All connected project runtimes will disconnect. Reconnect each project after setup.'), ...(input.baseUrl.startsWith('http:') ? [text('Warning: this endpoint uses unencrypted HTTP.')] : [])].join('\n\n'),
        buttons: [text('Cancel'), text('Save provider')], defaultId: 0, cancelId: 0, noLink: true
      })
      return result.response === 1
    })
    if (!approved) throw new DesktopFailure('CANCELLED', 'Provider setup was cancelled. Nothing was written.')
    const path = await executable(binary)
    const directory = workspace === this.scratch.path ? await this.scratch.ensure() : await workspaceDirectory(workspace)
    if (this.options.runtime.selectedConnection?.connectionId !== connection?.connectionId) throw new DesktopFailure('STALE_CONNECTION', 'The runtime changed while provider setup was awaiting approval. Try again.')
    if (this.options.runtime.busy) throw new DesktopFailure('RUNTIME_BUSY', 'Work started while provider setup was awaiting approval. Stop or finish it before trying again.')
    admit()
    await this.options.runtime.close()
    admit()
    await configureProvider(path, directory, input)
  }

  private async connect(input: { workspace?: string; binary?: string }, admit: () => void) {
    const binary = input.binary ?? this.binary.path
    const requestedWorkspace = input.workspace ?? this.scratch.path
    if (!binary || !this.binaries.has(binary)) throw new DesktopFailure('BINARY_NOT_APPROVED', 'Choose an available bingo-improve executable using the native file picker.')
    if (!this.workspaces.has(requestedWorkspace)) throw new DesktopFailure('WORKSPACE_NOT_APPROVED', 'Choose a workspace using the native folder picker.')
    const path = await executable(binary)
    const scratch = requestedWorkspace === this.scratch.path
    const workspace = scratch ? await this.scratch.ensure() : await workspaceDirectory(requestedWorkspace)
    if (path !== binary || workspace !== requestedWorkspace) throw new DesktopFailure('PATH_CHANGED', 'The approved path changed. Choose it again with the native picker.')
    admit()
    if (this.setup) throw new DesktopFailure('SETUP_IN_PROGRESS', 'Finish provider setup before connecting a project.')
    return this.options.runtime.connect(path, workspace)
  }

  private async reconnect(input: HostEpoch, admit: () => void) {
    const connection = this.options.runtime.getHost(input)
    if (!connection.binary || !connection.workspace || !this.binaries.has(connection.binary) || !this.workspaces.has(connection.workspace)) throw new DesktopFailure('WORKSPACE_NOT_APPROVED', 'Choose the project and binary again before reconnecting.')
    let allowed = false
    if (connection.busy && this.options.runtime.isLive(input)) {
      allowed = await this.withDialog(() => confirmStop(this.window(), text('Reconnect this project?'), text('Only work in this project runtime will stop. Other projects will keep running.')))
      if (!allowed) throw new DesktopFailure('CANCELLED', 'The existing project connection was kept.')
    }
    const binary = await executable(connection.binary)
    const workspace = connection.workspace === this.scratch.path ? await this.scratch.ensure() : await workspaceDirectory(connection.workspace)
    if (binary !== connection.binary || workspace !== connection.workspace) throw new DesktopFailure('PATH_CHANGED', 'The approved path changed. Choose it again with the native picker.')
    admit()
    if (this.setup) throw new DesktopFailure('SETUP_IN_PROGRESS', 'Finish provider setup before reconnecting a project.')
    return this.options.runtime.reconnect(input, allowed)
  }

  private projectPreferences(preferences: DesktopPreferences): DesktopPreferences {
    return { ...preferences, workspace: preferences.workspace === this.scratch.path ? null : preferences.workspace, recentWorkspaces: preferences.recentWorkspaces.filter((path) => path !== this.scratch.path) }
  }

  private workspaceScope(input: DesktopRequest): void {
    const workspace = this.options.runtime.getConnection(input.connectionId).workspace
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
  private handle<T>(channel: string, schema: z.ZodType<T>, operation: (input: T, admit: () => void) => unknown): void {
    ipcMain.handle(channel, async (event, input): Promise<Result<unknown>> => {
      const window = this.options.window()
      if (!window || !trustedSender(event, window.webContents, this.options.documentUrl)) return { ok: false, error: { code: 'UNTRUSTED_SENDER', message: 'This IPC sender is not allowed.' } }
      if (this.rendererNavigating) return { ok: false, error: { code: 'STALE_RENDERER', message: 'Wait for the new conversation document to finish navigating.' } }
      const generation = this.rendererGeneration
      const admit = (): void => {
        if (generation !== this.rendererGeneration || this.options.window() !== window || !trustedSender(event, window.webContents, this.options.documentUrl)) throw new DesktopFailure('STALE_RENDERER', 'The conversation window changed while this operation was pending.')
      }
      try { const value = await operation(schema.parse(input), admit); admit(); return { ok: true, value } }
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
  const options: Electron.MessageBoxOptions = { type: 'warning', title: text('Running work'), message, detail, buttons: [text('Keep working'), text('Stop and continue')], defaultId: 0, cancelId: 0, noLink: true }
  const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
  return result.response === 1
}
