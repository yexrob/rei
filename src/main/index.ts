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
    (handlers) => new StdioBingoSession(process.env.BINGO_GUI_BINARY ?? 'bingo', process.env.BINGO_GUI_CWD ?? process.cwd(), handlers),
    (event) => {
      if (event.payload.type !== 'protocol.ready' && event.payload.type !== 'inspection.ready' && event.payload.type !== 'session.ready') {
        sendSessionEvent(window, { connectionId: event.connectionId, sequence: event.sequence, payload: event.payload })
      }
    }
  )
  registerIpc(window, locator, sessions)
  window.once('ready-to-show', () => window.show())
  if (process.env.BINGO_GUI_E2E_PROMPT && !app.isPackaged) {
    window.webContents.once('did-finish-load', () => { void runEvidence(window, process.env.BINGO_GUI_E2E_PROMPT as string) })
  }
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

async function runEvidence(window: BrowserWindow, prompt: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await window.webContents.executeJavaScript(`Boolean(document.querySelector('textarea:not(:disabled)'))`)
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await window.webContents.executeJavaScript(`(() => { const input = document.querySelector('textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(prompt)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`)
  await new Promise((resolve) => setTimeout(resolve, 20_000))
  const image = await window.webContents.capturePage()
  await import('node:fs/promises').then(({ mkdir, writeFile }) => mkdir(join(app.getAppPath(), 'docs/screenshots/m1'), { recursive: true }).then(() => writeFile(join(app.getAppPath(), 'docs/screenshots/m1/ac-f2-3-tools.png'), image.toPNG())))
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
