import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerIpc, sendSessionEvent } from './ipc/registerIpc'
import { RuntimeLocator } from './runtime/runtimeLocator'
import { SessionManager } from './runtime/sessionManager'
import { StdioBingoSession } from './runtime/stdioBingoSession'

let sessions: SessionManager | null = null

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100, height: 720, minWidth: 800, minHeight: 600, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  const locator = new RuntimeLocator()
  sessions = new SessionManager(
    (handlers) => {
      const binary = process.env.BINGO_GUI_BINARY ?? 'bingo'
      return new StdioBingoSession(binary, process.env.BINGO_GUI_CWD ?? process.cwd(), handlers)
    },
    (event) => {
      if (event.payload.type !== 'protocol.ready' && event.payload.type !== 'inspection.ready' && event.payload.type !== 'session.ready') {
        sendSessionEvent(window, { connectionId: event.connectionId, sequence: event.sequence, payload: event.payload })
      }
    }
  )
  registerIpc(window, locator, sessions)
  window.once('ready-to-show', () => window.show())
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.whenReady().then(() => {
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
  app.on('before-quit', (event) => {
    if (!sessions) return
    event.preventDefault()
    const active = sessions
    sessions = null
    const force = setTimeout(() => app.exit(0), 3_000)
    void Promise.race([active.close(), new Promise((resolve) => setTimeout(resolve, 2_000))]).finally(() => {
      clearTimeout(force)
      app.exit(0)
    })
  })
  app.on('window-all-closed', () => app.quit())
}
