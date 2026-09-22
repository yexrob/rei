import type { App, BrowserWindowConstructorOptions, Dialog } from 'electron'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'

export const BACKGROUND_TEST_MARKER = '.rei-background-e2e'
export type BackgroundTestAudit = { dialogs: string[]; windowShows: number; windowFocuses: number; activations: number }

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path !== '' && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

/** Fail closed: a flag alone must never change a real or packaged user's app. */
export function backgroundTestEnabled(packaged: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.REI_E2E_MODE !== 'background') return false
  if (packaged) throw new Error('Background E2E mode is unavailable in packaged applications.')
  const home = env.HOME, data = env.BINGO_GUI_USER_DATA, token = env.REI_E2E_TOKEN
  if (!home || !data || !isAbsolute(home) || !isAbsolute(data) || !token || !/^[a-f0-9-]{36}$/.test(token)) throw new Error('Background E2E requires an isolated HOME, userData and launcher token.')
  const actualHome = realpathSync(home), actualData = realpathSync(data)
  if (!inside(realpathSync(tmpdir()), actualHome) || !inside(actualHome, actualData)) throw new Error('Background E2E userData must be inside its temporary isolated HOME.')
  if (readFileSync(join(actualData, BACKGROUND_TEST_MARKER), 'utf8') !== token) throw new Error('Background E2E launcher token does not match the isolated userData marker.')
  return true
}

/** Public Electron APIs: hidden windows still paint, but can never take native focus. */
export const BACKGROUND_WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
  show: false, focusable: false, skipTaskbar: true, paintWhenInitiallyHidden: true,
  webPreferences: { backgroundThrottling: false, focusOnNavigation: false, disableDialogs: true }
}

export function installBackgroundTestGuards(app: App, dialog: Dialog): BackgroundTestAudit {
  const audit: BackgroundTestAudit = { dialogs: [], windowShows: 0, windowFocuses: 0, activations: 0 }
  // Main-process-only diagnostics, never exposed through the renderer bridge.
  Object.assign(app, { __reiBackgroundTestAudit: audit })
  // Electron documents that this policy cannot activate the app. A platform
  // unable to create/paint a hidden window under it must fail, never show one.
  if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
  app.on('browser-window-created', (_event, window) => {
    window.on('show', () => { audit.windowShows += 1; app.exit(1) })
    window.on('focus', () => { audit.windowFocuses += 1; app.exit(1) })
  })
  app.on('did-become-active', () => { audit.activations += 1; app.exit(1) })
  const blocked = (kind: string): never => {
    audit.dialogs.push(kind)
    throw new Error(`Unexpected native ${kind} in background E2E. Stub this dialog explicitly in the test.`)
  }
  dialog.showMessageBox = async () => blocked('showMessageBox')
  dialog.showOpenDialog = async () => blocked('showOpenDialog')
  dialog.showSaveDialog = async () => blocked('showSaveDialog')
  dialog.showMessageBoxSync = () => blocked('showMessageBoxSync')
  dialog.showOpenDialogSync = () => blocked('showOpenDialogSync')
  dialog.showSaveDialogSync = () => blocked('showSaveDialogSync')
  dialog.showErrorBox = (title, content) => { audit.dialogs.push('showErrorBox'); console.error(`[background E2E] ${title}: ${content}`) }
  return audit
}
