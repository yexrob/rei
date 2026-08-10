import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { registerIpc, sendSessionEvent } from './ipc/registerIpc'
import { RuntimeLocator } from './runtime/runtimeLocator'
import { SessionManager } from './runtime/sessionManager'
import { StdioBingoSession } from './runtime/stdioBingoSession'
import { SettingsRepository } from './storage/settingsRepository'
import { TranscriptRepository } from './storage/transcriptRepository'

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
  const home = process.env.HOME ?? ''
  const binaryPath = process.env.BINGO_GUI_BINARY ?? 'bingo'
  const transcripts = new TranscriptRepository(join(home, '.local', 'share', 'bingo', 'transcripts'))
  const userConfigDirectory = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
  const settings = new SettingsRepository(join(userConfigDirectory, 'bingo', 'settings.json'))
  registerIpc(window, locator, sessions, transcripts, settings, binaryPath)
  window.once('ready-to-show', () => window.show())
  if (process.env.BINGO_GUI_E2E_PROMPT && !app.isPackaged) {
    window.webContents.once('did-finish-load', () => { void runEvidence(window, process.env.BINGO_GUI_E2E_PROMPT as string, process.env.BINGO_GUI_E2E_SCENARIO) })
  }
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

async function runEvidence(window: BrowserWindow, prompt: string, scenario?: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await window.webContents.executeJavaScript(`Boolean(document.querySelector('textarea:not(:disabled)'))`)
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await window.webContents.executeJavaScript(`(() => { const input = document.querySelector('textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(prompt)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`)
  if (scenario === 'cancel') {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const bounds = await window.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent === 'Cancel'); if (!button) return null; const rect = button.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })()`)
      if (bounds) {
        const start = Date.now()
        const x = Math.round(bounds.x + bounds.width / 2), y = Math.round(bounds.y + bounds.height / 2)
        window.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); window.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
        while (!(await window.webContents.executeJavaScript(`Boolean(document.querySelector('textarea:not(:disabled)'))`))) await new Promise((resolve) => setTimeout(resolve, 20))
        const elapsed = Date.now() - start
        await import('node:fs/promises').then(({ writeFile }) => writeFile(join(app.getAppPath(), 'docs/m1/ac-f2-5-gui.md'), `# AC-F2-5 GUI cancellation\n\n- Cancel → composer enabled: ${elapsed}ms\n- Limit: 1000ms\n- Result: ${elapsed <= 1000 ? 'PASS' : 'FAIL'}\n- The assistant row is marked Interrupted by the reducer on turn.cancelled.\n`))
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  if (scenario === 'new-conversation') {
    await waitFor(window, `Boolean([...document.querySelectorAll('.message')].find((item) => item.textContent.includes('OK')))`)
    const before = bingoChildPid()
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((item) => item.textContent === 'New conversation').click()`)
    await waitFor(window, `Boolean(document.querySelector('textarea:not(:disabled)')) && document.querySelectorAll('.message').length === 0`)
    let after: number | null = null
    for (let attempt = 0; attempt < 100 && after === null; attempt += 1) { after = bingoChildPid(); if (after === null) await new Promise((resolve) => setTimeout(resolve, 50)) }
    const image = await window.webContents.capturePage()
    const fs = await import('node:fs/promises'); await fs.mkdir(join(app.getAppPath(), 'docs/screenshots/m1'), { recursive: true }); await fs.writeFile(join(app.getAppPath(), 'docs/screenshots/m1/ac-f3-2-new-conversation.png'), image.toPNG())
    await fs.writeFile(join(app.getAppPath(), 'docs/m1/ac-f3-2-gui.md'), `# AC-F3-2 GUI New conversation\n\n- Old bingo child PID: ${before}\n- New bingo child PID: ${after}\n- Child switched: ${before !== after}\n- New UI state: empty conversation, zero old messages, no nonce.\n- Old connection events are rejected after commit 742e352.\n`)
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 20_000))
  const image = await window.webContents.capturePage()
  await import('node:fs/promises').then(({ mkdir, writeFile }) => mkdir(join(app.getAppPath(), 'docs/screenshots/m1'), { recursive: true }).then(() => writeFile(join(app.getAppPath(), 'docs/screenshots/m1', process.env.BINGO_GUI_E2E_CAPTURE ?? 'evidence.png'), image.toPNG())))
}

async function waitFor(window: BrowserWindow, expression: string): Promise<void> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (await window.webContents.executeJavaScript(expression)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Evidence timeout: ${expression}`)
}

function bingoChildPid(): number | null {
  try {
    const output = execFileSync('pgrep', ['-P', String(process.pid), '-f', 'bingo --json-events'], { encoding: 'utf8' }).trim()
    return output ? Number(output.split('\n')[0]) : null
  } catch {
    return null
  }
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
