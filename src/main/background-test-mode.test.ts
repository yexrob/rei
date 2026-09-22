import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import type { App, Dialog } from 'electron'
import { BACKGROUND_TEST_MARKER, BACKGROUND_WINDOW_OPTIONS, backgroundTestEnabled, installBackgroundTestGuards } from './background-test-mode'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function environment() {
  const home = mkdtempSync(join(tmpdir(), 'rei-test-mode-')); roots.push(home)
  const data = join(home, 'desktop'), token = randomUUID()
  mkdirSync(data); writeFileSync(join(data, BACKGROUND_TEST_MARKER), token)
  return { HOME: home, BINGO_GUI_USER_DATA: data, REI_E2E_TOKEN: token, REI_E2E_MODE: 'background' }
}
it('leaves normal development and packaged launches untouched unless explicitly requested', () => {
  expect(backgroundTestEnabled(false, {})).toBe(false)
  expect(backgroundTestEnabled(true, {})).toBe(false)
})
it('requires non-packaged mode and a matching marker in a temporary isolated HOME', () => {
  const env = environment()
  expect(backgroundTestEnabled(false, env)).toBe(true)
  expect(() => backgroundTestEnabled(true, env)).toThrow('packaged')
  expect(() => backgroundTestEnabled(false, { ...env, REI_E2E_TOKEN: randomUUID() })).toThrow('does not match')
  expect(() => backgroundTestEnabled(false, { ...env, BINGO_GUI_USER_DATA: env.HOME })).toThrow('inside')
  expect(() => backgroundTestEnabled(false, { ...env, HOME: tmpdir() })).toThrow('inside')
  expect(() => backgroundTestEnabled(false, { ...env, BINGO_GUI_USER_DATA: 'relative' })).toThrow('isolated')
  expect(() => backgroundTestEnabled(false, { REI_E2E_MODE: 'background' })).toThrow('isolated')
})
it('uses a non-focusable hidden renderer without changing privilege boundaries', () => {
  expect(BACKGROUND_WINDOW_OPTIONS).toMatchObject({ show: false, focusable: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, focusOnNavigation: false, disableDialogs: true } })
  for (const key of ['sandbox', 'contextIsolation', 'nodeIntegration', 'webSecurity']) expect(BACKGROUND_WINDOW_OPTIONS.webPreferences).not.toHaveProperty(key)
})
it('routes all Electron E2E entry points through the guarded shared launcher', () => {
  const directory = new URL('../../tests/', import.meta.url)
  for (const name of readdirSync(directory).filter(name => name.endsWith('.e2e.ts'))) {
    const source = readFileSync(new URL(name, directory), 'utf8')
    expect(source, name).not.toMatch(/\b_electron\b/)
    if (source.includes('electron.launch(')) expect(source, name).toContain("from './helpers/electron'")
  }
})
it('blocks every native dialog before launch instead of auto-approving it', async () => {
  const app = Object.assign(new EventEmitter(), { setActivationPolicy: vi.fn(), exit: vi.fn() })
  const dialog = {} as Dialog
  const audit = installBackgroundTestGuards(app as unknown as App, dialog)
  await expect(dialog.showMessageBox({ message: 'unexpected' })).rejects.toThrow('Stub this dialog explicitly')
  await expect(dialog.showOpenDialog({})).rejects.toThrow('Stub this dialog explicitly')
  await expect(dialog.showSaveDialog({})).rejects.toThrow('Stub this dialog explicitly')
  expect(() => dialog.showMessageBoxSync({ message: 'unexpected' })).toThrow()
  expect(() => dialog.showOpenDialogSync({})).toThrow()
  expect(() => dialog.showSaveDialogSync({})).toThrow()
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  dialog.showErrorBox('failure', 'offline')
  expect(audit.dialogs).toHaveLength(7)
  expect(log).toHaveBeenCalledOnce(); log.mockRestore()
  if (process.platform === 'darwin') expect(app.setActivationPolicy).toHaveBeenCalledWith('prohibited')
  const window = new EventEmitter()
  app.emit('browser-window-created', {}, window)
  window.emit('show'); window.emit('focus'); app.emit('did-become-active')
  expect(audit).toMatchObject({ windowShows: 1, windowFocuses: 1, activations: 1 })
  expect(app.exit).toHaveBeenCalledTimes(3)
})
