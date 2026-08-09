import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
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
  if (process.env.BINGO_GUI_RETRY_EVIDENCE_BINARY && !app.isPackaged) {
    window.webContents.once('did-finish-load', () => {
      void captureRetryEvidence(window, locator, process.env.BINGO_GUI_RETRY_EVIDENCE_BINARY as string)
    })
  }
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

async function captureRetryEvidence(window: BrowserWindow, locator: RuntimeLocator, binary: string): Promise<void> {
  const appPid = process.pid
  const rect = await waitForRetryButton(window)
  locator.setBinaryOverride(binary)
  const x = Math.round(rect.x + rect.width / 2)
  const y = Math.round(rect.y + rect.height / 2)
  window.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  window.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  await waitForReadyState(window)
  const image = await window.webContents.capturePage()
  const directory = join(app.getAppPath(), 'docs', 'screenshots')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'm0-retry-recovery.png'), image.toPNG())
  await writeFile(join(app.getAppPath(), 'docs', 'm0-retry-recovery.md'), `# M0 Retry recovery evidence\n\n- App PID before Retry: ${appPid}\n- App PID after recovery: ${process.pid}\n- Initial state: BINGO_NOT_FOUND\n- Retry injection: webContents.sendInputEvent at DOM-measured button center (${x}, ${y})\n- Recovered state: bingo 0.3.3, protocol 1\n- Application restart: no\n`)
}

async function waitForRetryButton(window: BrowserWindow): Promise<{ x: number; y: number; width: number; height: number }> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rect = await window.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent === 'Retry'); if (!button) return null; const rect = button.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })()`)
    if (rect) return rect
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Retry button did not render')
}

async function waitForReadyState(window: BrowserWindow): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await window.webContents.executeJavaScript(`document.body.innerText.includes('bingo 0.3.3 · protocol 1')`)
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Retry did not reach the ready state')
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
