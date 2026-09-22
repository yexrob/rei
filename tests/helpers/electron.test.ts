import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('@playwright/test', () => ({ _electron: { launch: mock.launch }, expect }))
const roots: string[] = []
beforeEach(() => { vi.resetModules(); mock.launch.mockReset(); vi.stubEnv('REI_E2E_FOREGROUND', '0') })
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(source = '// built guard: REI_E2E_MODE __reiBackgroundTestAudit') {
  const home = mkdtempSync(join(tmpdir(), 'rei-launcher-unit-')); roots.push(home)
  const entry = join(home, 'main.cjs'), data = join(home, 'desktop')
  writeFileSync(entry, source)
  return { entry, home, data, options: { args: [entry], env: { HOME: home, BINGO_GUI_USER_DATA: data } } }
}
function fakeApplication() {
  const child = { exitCode: null as number | null, signalCode: null as string | null }
  const state = { audit: { dialogs: [], windowShows: 0, windowFocuses: 0, activations: 0 }, active: false, windows: [{ visible: false, focused: false, focusable: false }] }
  const page = { evaluate: vi.fn(async () => {}) }, close = vi.fn(async () => { if (child.exitCode === null && child.signalCode === null) child.exitCode = 0 })
  const application = {
    process: () => child, close,
    evaluate: vi.fn(async () => state), firstWindow: vi.fn(async () => page), windows: () => [page], context: () => ({ addInitScript: vi.fn(async () => {}) })
  }
  mock.launch.mockResolvedValue(application)
  return { child, close, application }
}
it('does not launch Electron for a missing entry or a stale pre-guard bundle', async () => {
  const { electron } = await import('./electron')
  const stale = fixture('new BrowserWindow({ show: true })')
  await expect(electron.launch(stale.options)).rejects.toThrow('no background guard')
  await expect(electron.launch({ ...stale.options, args: [join(stale.home, 'does-not-exist.cjs')] })).rejects.toThrow()
  await expect(electron.launch({ ...stale.options, args: ['relative/main.js'] })).rejects.toThrow('absolute built main')
  expect(mock.launch).not.toHaveBeenCalled()
})
it('rejects packaged paths and escaped profile symlinks without launching Electron', async () => {
  const { electron } = await import('./electron')
  const fixtureA = fixture(), fixtureB = fixture()
  await expect(electron.launch({ ...fixtureA.options, executablePath: '/some/native/app' })).rejects.toThrow('explicit REI_E2E_FOREGROUND')
  mkdirSync(fixtureB.data)
  symlinkSync(fixtureB.data, fixtureA.data, 'junction')
  await expect(electron.launch(fixtureA.options)).rejects.toThrow('symlink')
  expect(mock.launch).not.toHaveBeenCalled()
})
it.each([{ exitCode: 1, signalCode: null }, { exitCode: null, signalCode: 'SIGTERM' }])('rejects guard exits or abnormal signals during teardown: %j', async result => {
  const { electron } = await import('./electron')
  const fake = fakeApplication()
  const application = await electron.launch(fixture().options)
  Object.assign(fake.child, result)
  await expect(application.close()).rejects.toThrow('isolated Electron exited unexpectedly')
  expect(fake.close).toHaveBeenCalledOnce()
})
it.each([{ exitCode: 1, signalCode: null }, { exitCode: null, signalCode: 'SIGTERM' }])('rejects a guard failure arising inside close: %j', async result => {
  const { electron } = await import('./electron')
  const fake = fakeApplication()
  const application = await electron.launch(fixture().options)
  fake.close.mockImplementationOnce(async () => { Object.assign(fake.child, result) })
  await expect(application.close()).rejects.toThrow('isolated Electron exited unexpectedly')
  expect(fake.close).toHaveBeenCalledOnce()
})
it('still requires runtime audit after a bundle passes the static preflight', async () => {
  const { electron } = await import('./electron')
  const fake = fakeApplication()
  fake.application.evaluate.mockResolvedValue({ audit: undefined, active: false, windows: [] } as never)
  await expect(electron.launch(fixture().options)).rejects.toThrow('main-process background guard')
  expect(mock.launch).toHaveBeenCalledOnce()
  expect(fake.close).toHaveBeenCalledOnce()
})
