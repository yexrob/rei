import { app, BrowserWindow, dialog, Menu, nativeTheme, screen, shell, type MenuItemConstructorOptions } from 'electron'
import { isAbsolute, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { DesktopIpc, confirmStop } from './desktop/ipc'
import { EventDelivery } from './desktop/event-delivery'
import { PreferencesStore, restoreBounds } from './desktop/preferences'
import { DesktopRuntime } from './desktop/runtime'
import { Panels } from './desktop/panels'
import { AgentBrowser } from './desktop/agent-browser'
import { allowsClipboardWrite, externalUrl, sameDocument } from './desktop/security'
import type { DesktopEvent } from '../shared/desktop'

let window: BrowserWindow | null = null
let preferences: PreferencesStore | null = null
let runtime: DesktopRuntime | null = null
let delivery: EventDelivery | null = null
let desktopIpc: DesktopIpc | null = null
let panels: Panels | null = null
const agentBrowser = new AgentBrowser()
let quitting = false
let quitPending = false
const rendererFile = join(__dirname, '../renderer/index.html')
const documentUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : pathToFileURL(rendererFile).href

function emit(event: DesktopEvent): void {
  delivery?.send(event)
  const url = agentBrowser.route(event)
  if (url) panels?.openBrowser(url)
}

function createWindow(): void {
  const bounds = restoreBounds(preferences?.bounds, screen.getAllDisplays().map((display) => display.workArea))
  window = new BrowserWindow({
    width: bounds?.width ?? 1220, height: bounds?.height ?? 820,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 640, minHeight: 480, show: false, title: 'Rei',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#20221f' : '#fbfaf8',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 14 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      spellcheck: true, navigateOnDragDrop: false
    }
  })
  const created = window
  if (bounds?.maximized) created.maximize()
  created.webContents.session.setPermissionRequestHandler((contents, permission, respond, details) => respond(allowsClipboardWrite(contents, created.webContents, permission, details, documentUrl)))
  created.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) => allowsClipboardWrite(contents, created.webContents, permission, details, documentUrl))
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', (event, url) => { if (!sameDocument(url, documentUrl)) event.preventDefault() })
  created.webContents.on('will-attach-webview', (event) => event.preventDefault())
  created.webContents.on('render-process-gone', () => {
    delivery?.reset()
    void runtime?.close()
    if (!quitting) void dialog.showMessageBox(created, { type: 'error', message: 'The conversation window stopped.', detail: 'The native runtime has been disconnected. Reload the window and reconnect to recover saved history.', buttons: ['Reload', 'Quit'] }).then((result) => { if (result.response === 0) created.reload(); else app.quit() })
  })
  created.once('ready-to-show', () => created.show())
  created.on('close', (event) => {
    saveWindowBounds(created)
    if (quitting) return
    event.preventDefault()
    if (process.platform === 'darwin') created.hide()
    else app.quit()
  })
  created.on('closed', () => { if (window === created) window = null })
  void created.loadURL(documentUrl).catch(() => { dialog.showErrorBox('Rei could not open', 'The desktop interface failed to load. Reinstall the app or check the development server.'); app.quit() })
}

function saveWindowBounds(target: BrowserWindow): void {
  if (!preferences || target.isDestroyed()) return
  const bounds = target.getNormalBounds()
  void preferences.saveBounds({ ...bounds, maximized: target.isMaximized() }).catch(() => {})
}

function showWindow(): void {
  if (!window || window.isDestroyed()) createWindow()
  else { if (window.isMinimized()) window.restore(); window.show(); window.focus() }
}

function appMenu(): void {
  const menu = (action: 'new-session' | 'choose-workspace' | 'preferences') => { showWindow(); emit({ type: 'menu', action }) }
  const preferencesItem: MenuItemConstructorOptions = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => menu('preferences') }
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, preferencesItem, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] } as MenuItemConstructorOptions] : []),
    { label: 'File', submenu: [
      { label: 'New conversation', accelerator: 'CmdOrCtrl+N', click: () => menu('new-session') },
      { label: 'Open workspace…', accelerator: 'CmdOrCtrl+O', click: () => menu('choose-workspace') },
      ...(process.platform === 'darwin' ? [] : [preferencesItem]),
      { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' }
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools' } as MenuItemConstructorOptions] : [])
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'bingo documentation', click: () => { void shell.openExternal(externalUrl('https://github.com/yexrob/bingo')).catch(() => {}) } }] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function quit(): Promise<void> {
  if (quitPending || quitting) return
  quitPending = true
  try {
    if (runtime?.busy || desktopIpc?.busy || panels?.busy) {
      panels?.setBrowserOccluded(true)
      try {
        if (!(await confirmStop(window, 'Quit Rei and stop running work?', 'Active turns, tools and the local terminal will stop. An in-progress provider save will finish before quitting. Saved history remains in bingo.'))) return
      } finally { panels?.setBrowserOccluded(false) }
    }
    quitting = true
    if (window) saveWindowBounds(window)
    await panels?.close()
    await desktopIpc?.shutdown()
    await runtime?.close()
    await preferences?.flush()
    app.quit()
  } catch {
    quitting = false
    dialog.showErrorBox('Rei is still running', 'The terminal could not be stopped safely. Stop it and try quitting again.')
  } finally { quitPending = false }
}

if (!app.isPackaged && process.env.BINGO_GUI_USER_DATA) {
  if (!isAbsolute(process.env.BINGO_GUI_USER_DATA)) throw new Error('BINGO_GUI_USER_DATA must be an absolute directory.')
  mkdirSync(process.env.BINGO_GUI_USER_DATA, { recursive: true })
  app.setPath('userData', process.env.BINGO_GUI_USER_DATA)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (app.isReady()) showWindow() })
  app.on('before-quit', (event) => { if (!quitting) { event.preventDefault(); void quit() } })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('activate', () => { if (app.isReady()) showWindow() })
  void app.whenReady().then(async () => {
    preferences = new PreferencesStore(app.getPath('userData'))
    await preferences.load().catch((error: Error) => dialog.showErrorBox('Desktop preferences unavailable', error.message))
    nativeTheme.themeSource = preferences.preferences.theme
    runtime = new DesktopRuntime(emit)
    delivery = new EventDelivery(() => window, documentUrl, (error) => runtime?.abort(error))
    desktopIpc = new DesktopIpc({ window: () => window, documentUrl, preferences, runtime, onDialogChange: (open) => panels?.setBrowserOccluded(open) })
    await desktopIpc.initialize()
    panels = new Panels({ window: () => window, documentUrl, workspace: () => desktopIpc?.currentWorkspace ?? null })
    appMenu()
    createWindow()
  }).catch(() => { dialog.showErrorBox('Rei could not start', 'The desktop runtime could not be initialized.'); quitting = true; app.quit() })
}
