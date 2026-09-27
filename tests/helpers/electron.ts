import { _electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { extractFile } from '@electron/asar'
import { BACKGROUND_TEST_MARKER, type BackgroundTestAudit } from '../../src/main/background-test-mode'

export const foregroundEnabled = process.env.REI_E2E_FOREGROUND === '1'
type LaunchOptions = NonNullable<Parameters<typeof _electron.launch>[0]>

// This is a test sink, not an OS-clipboard assertion. Product clipboard policy
// remains covered by security.test.ts; E2E checks the exact renderer payload.
function installClipboardSink() {
  const state = window as typeof window & { __reiClipboard: string[] }
  state.__reiClipboard = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (text: string) => { state.__reiClipboard.push(text) },
    readText: async () => state.__reiClipboard.at(-1) ?? ''
  } })
}
export async function copiedText(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as typeof window & { __reiClipboard: string[] }).__reiClipboard.at(-1))
}

export async function assertBackground(app: ElectronApplication): Promise<void> {
  const state = await app.evaluate(({ app, BrowserWindow }) => ({
    audit: (app as typeof app & { __reiBackgroundTestAudit?: BackgroundTestAudit }).__reiBackgroundTestAudit,
    active: process.platform === 'darwin' ? app.isActive() : false,
    windows: BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(), focused: window.isFocused(), focusable: window.isFocusable() }))
  }))
  expect(state.audit, 'the main-process background guard must be active').toBeDefined()
  expect(state.audit).toEqual({ dialogs: [], windowShows: 0, windowFocuses: 0, activations: 0 })
  expect(state.active, 'the application must not become the active macOS application').toBe(false)
  expect(state.windows.length).toBeGreaterThan(0)
  for (const window of state.windows) expect(window).toEqual({ visible: false, focused: false, focusable: false })
}

export async function desktopStartupEvidence(app: ElectronApplication, page: Page): Promise<Record<string, unknown>> {
  const capture = async (read: () => Promise<unknown>): Promise<unknown> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Evidence read timed out')), 1500) })]) }
    catch (error) { return { unavailable: error instanceof Error ? error.message : String(error) } }
    finally { clearTimeout(timer) }
  }
  const [url, errors, consoleErrors, dom, native] = await Promise.all([
    capture(async () => page.url()),
    capture(async () => (await page.pageErrors()).slice(-20).map(error => ({ message: error.message, stack: error.stack }))),
    capture(async () => (await page.consoleMessages()).filter(message => message.type() === 'error').slice(-20).map(message => message.text().slice(0, 2000))),
    capture(async () => (await page.content()).slice(0, 12000)),
    capture(async () => app.evaluate(({ app, BrowserWindow }) => ({
      rendererExits: (app as typeof app & { __reiRendererExits?: unknown[] }).__reiRendererExits,
      windows: BrowserWindow.getAllWindows().map(window => ({ url: window.webContents.getURL(), crashed: window.webContents.isCrashed(), loading: window.webContents.isLoading() }))
    })))
  ])
  return { url, errors, console: consoleErrors, dom, native }
}

/** Preserve startup failures with renderer evidence; an empty root is never readiness. */
export async function waitForDesktopReady(app: ElectronApplication, page: Page): Promise<void> {
  try {
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByText('Connected locally')).toBeVisible()
    expect(await page.pageErrors()).toEqual([])
  } catch (error) {
    console.error('Desktop startup evidence:', JSON.stringify(await desktopStartupEvidence(app, page)))
    throw error
  }
}

/** Wait for finite UI transitions, not indefinite working indicators. Never disable axe. */
export async function settledMotion(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation =>
    animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)
  ).length), { timeout: 5000, message: 'finite UI animations should settle before accessibility/visual inspection' }).toBe(0)
}

export const electron = {
  async launch(options: LaunchOptions): Promise<ElectronApplication> {
    let env = options.env
    if (!foregroundEnabled) {
      let bundle: string
      if (options.executablePath) {
        if (!isAbsolute(options.executablePath)) throw new Error('Background packaged E2E requires an absolute executable path.')
        const resources = process.platform === 'darwin' ? join(dirname(options.executablePath), '..', 'Resources') : join(dirname(options.executablePath), 'resources')
        const archive = join(resources, 'app.asar')
        const manifest = JSON.parse(extractFile(archive, 'package.json').toString('utf8')) as { main: string }
        // asar 3.x traverses with the host path separator, while package.json uses '/'.
        bundle = extractFile(archive, normalize(manifest.main)).toString('utf8')
      } else {
        const entry = options.args?.find(arg => !arg.startsWith('-'))
        if (!entry || !isAbsolute(entry)) throw new Error('Background E2E requires the absolute built main entry point.')
        bundle = await readFile(entry, 'utf8')
      }
      if (!bundle.includes('__reiBackgroundTestAudit') || !bundle.includes('REI_E2E_MODE')) throw new Error('The main bundle has no background guard. Run npm run build before E2E; refusing to launch a stale visible build.')
      const home = env?.HOME, data = env?.BINGO_GUI_USER_DATA
      if (!home || !data || !isAbsolute(home) || !isAbsolute(data)) throw new Error('Every E2E launch requires its own absolute HOME and BINGO_GUI_USER_DATA.')
      const temporaryRoot = await realpath(tmpdir())
      const actualHome = await realpath(home), temporaryHome = relative(temporaryRoot, actualHome)
      if (!temporaryHome || isAbsolute(temporaryHome) || temporaryHome === '..' || temporaryHome.startsWith(`..${sep}`) || await realpath(dirname(data)) !== actualHome) throw new Error('The E2E profile must be a direct child of an isolated temporary HOME.')
      const token = randomUUID()
      await mkdir(data, { recursive: true })
      if (dirname(await realpath(data)) !== actualHome) throw new Error('The E2E profile must not escape its temporary HOME through a symlink.')
      await writeFile(join(data, BACKGROUND_TEST_MARKER), token, { mode: 0o600 })
      // fs.promises.realpath expands Windows 8.3 aliases; Electron's sync guard
      // must receive the same spelling for HOME and its actual temporary parent.
      env = { ...env, HOME: actualHome, USERPROFILE: actualHome, BINGO_GUI_USER_DATA: await realpath(data), TEMP: temporaryRoot, TMP: temporaryRoot, TMPDIR: temporaryRoot, REI_E2E_MODE: 'background', REI_E2E_TOKEN: token }
    }
    const app = await _electron.launch({ ...options, env })
    const close = app.close.bind(app)
    // Playwright disposes its process handle on close; retain the actual child
    // object now so the final native exit status remains inspectable afterwards.
    const child = app.process()
    app.close = async () => {
      // A guard-triggered exit must fail the test even if it happens between
      // the final assertion and teardown.
      if (child.exitCode !== null || child.signalCode !== null) {
        await close()
        expect({ exitCode: child.exitCode, signalCode: child.signalCode }, 'isolated Electron exited unexpectedly').toEqual({ exitCode: 0, signalCode: null })
        return
      }
      let safetyError: unknown
      if (!foregroundEnabled) { try { await assertBackground(app) } catch (error) { safetyError = error } }
      // Explicit test teardown authorization, not production auto-approval. A
      // different dialog remains an error and can never appear on the desktop.
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async (...args: unknown[]) => {
          const options = args.at(-1) as { message?: string }
          if (options.message !== 'Quit Rei and stop running work?') throw new Error('Unexpected dialog during isolated E2E teardown')
          return { response: 1, checkboxChecked: false }
        }
      })
      await close()
      expect({ exitCode: child.exitCode, signalCode: child.signalCode }, 'isolated Electron exited unexpectedly').toEqual({ exitCode: 0, signalCode: null })
      if (safetyError) throw safetyError
    }
    try {
      await app.evaluate(({ app, webContents }) => {
        const exits: unknown[] = []
        Object.assign(app, { __reiRendererExits: exits })
        const observe = (contents: Electron.WebContents) => contents.on('render-process-gone', (_event, details) => { exits.push({ id: contents.id, ...details }) })
        for (const contents of webContents.getAllWebContents()) observe(contents)
        app.on('web-contents-created', (_event, contents) => observe(contents))
      })
      await app.firstWindow()
      if (!foregroundEnabled) await assertBackground(app)
      await app.context().addInitScript(installClipboardSink)
      for (const page of app.windows()) await page.evaluate(installClipboardSink)
      return app
    } catch (error) { await app.close(); throw error }
  }
}
