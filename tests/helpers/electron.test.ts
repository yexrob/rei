import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackage } from '@electron/asar'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('@playwright/test', () => ({ _electron: { launch: mock.launch }, expect }))
const roots: string[] = []
beforeEach(() => { vi.resetModules(); mock.launch.mockReset(); vi.stubEnv('REI_E2E_FOREGROUND', '0') })
afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock('node:path'); vi.doUnmock('@electron/asar'); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
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
it('rejects missing packaged archives and escaped profile symlinks without launching Electron', async () => {
  const { electron } = await import('./electron')
  const fixtureA = fixture(), fixtureB = fixture()
  await expect(electron.launch({ ...fixtureA.options, executablePath: '/some/native/app' })).rejects.toThrow()
  mkdirSync(fixtureB.data)
  symlinkSync(fixtureB.data, fixtureA.data, 'junction')
  await expect(electron.launch(fixtureA.options)).rejects.toThrow('symlink')
  expect(mock.launch).not.toHaveBeenCalled()
})
it('passes one canonical temporary root to Node and Electron without changing the containment guard', async () => {
  const { electron } = await import('./electron')
  const f = fixture(), other = fixture(); fakeApplication()
  const application = await electron.launch({ ...f.options, env: { ...f.options.env, TEMP: other.home, TMP: other.home, TMPDIR: other.home } })
  expect(mock.launch).toHaveBeenCalledWith(expect.objectContaining({ env: expect.objectContaining({
    HOME: realpathSync.native(f.home), USERPROFILE: realpathSync.native(f.home), BINGO_GUI_USER_DATA: realpathSync.native(f.data),
    TEMP: realpathSync.native(tmpdir()), TMP: realpathSync.native(tmpdir()), TMPDIR: realpathSync.native(tmpdir())
  }) }))
  await application.close()
})
it.each([true, false])('checks the packaged main archive before hidden launch (guard: %s)', async guarded => {
  const f = fixture()
  const resources = join(f.home, ...(process.platform === 'darwin' ? ['Rei.app', 'Contents', 'Resources'] : ['resources']))
  const executablePath = process.platform === 'darwin' ? join(resources, '..', 'MacOS', 'Rei') : join(f.home, 'Rei.exe')
  const source = join(f.home, 'source')
  mkdirSync(join(source, 'out/main'), { recursive: true }); mkdirSync(resources, { recursive: true })
  writeFileSync(join(source, 'package.json'), JSON.stringify({ main: 'out/main/index.js' }))
  writeFileSync(join(source, 'out/main/index.js'), guarded ? '// REI_E2E_MODE __reiBackgroundTestAudit' : '// old visible bundle')
  await createPackage(source, join(resources, 'app.asar'))
  const { electron } = await import('./electron')
  const fake = fakeApplication()
  const launch = electron.launch({ executablePath, args: [], env: f.options.env })
  if (guarded) {
    await (await launch).close()
    expect(mock.launch).toHaveBeenCalledWith(expect.objectContaining({ env: expect.objectContaining({ REI_E2E_MODE: 'background' }) }))
    expect(fake.close).toHaveBeenCalledOnce()
  } else {
    await expect(launch).rejects.toThrow('no background guard')
    expect(mock.launch).not.toHaveBeenCalled()
  }
})
it('normalizes a manifest main path for the Windows asar traversal before checking its guard', async () => {
  // Reproduce Windows separators even when this unit suite runs on macOS/Linux.
  vi.doMock('node:path', async () => {
    const path = await vi.importActual<typeof import('node:path')>('node:path')
    return { ...path, normalize: path.win32.normalize }
  })
  const extractFile = vi.fn((_archive: string, file: string) => {
    if (file === 'package.json') return Buffer.from('{"main":"out/main/index.js"}')
    if (file === 'out\\main\\index.js') return Buffer.from('REI_E2E_MODE __reiBackgroundTestAudit')
    throw new Error(`Archive entry not found: ${file}`)
  })
  vi.doMock('@electron/asar', () => ({ extractFile }))
  const { electron } = await import('./electron')
  const f = fixture(); fakeApplication()
  await (await electron.launch({ executablePath: join(f.home, 'Rei.exe'), env: f.options.env })).close()
  expect(extractFile).toHaveBeenLastCalledWith(expect.any(String), 'out\\main\\index.js')
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
it('captures surviving startup evidence when the page or native process has exited', async () => {
  const { desktopStartupEvidence } = await import('./electron')
  const page = {
    url: () => 'file:///test/index.html',
    pageErrors: async () => [new Error('renderer failed')],
    consoleMessages: async () => { throw new Error('console target closed') },
    content: async () => { throw new Error('page target closed') }
  }
  const app = { evaluate: async () => { throw new Error('native target closed') } }
  const evidence = await desktopStartupEvidence(app as never, page as never)
  expect(evidence).toMatchObject({ url: 'file:///test/index.html', errors: [{ message: 'renderer failed' }], console: { unavailable: 'console target closed' }, dom: { unavailable: 'page target closed' }, native: { unavailable: 'native target closed' } })
})
it('bounds startup evidence collection when one target stops responding', async () => {
  vi.useFakeTimers()
  try {
    const { desktopStartupEvidence } = await import('./electron')
    const page = { url: () => 'file:///test/index.html', pageErrors: async () => [], consoleMessages: async () => [], content: () => new Promise(() => {}) }
    const result = desktopStartupEvidence({ evaluate: async () => ({ windows: [], rendererExits: [] }) } as never, page as never)
    await vi.advanceTimersByTimeAsync(1500)
    expect(await result).toMatchObject({ errors: [], dom: { unavailable: 'Evidence read timed out' }, native: { windows: [], rendererExits: [] } })
  } finally { vi.useRealTimers() }
})
it('still requires runtime audit after a bundle passes the static preflight', async () => {
  const { electron } = await import('./electron')
  const fake = fakeApplication()
  fake.application.evaluate.mockResolvedValue({ audit: undefined, active: false, windows: [] } as never)
  await expect(electron.launch(fixture().options)).rejects.toThrow('main-process background guard')
  expect(mock.launch).toHaveBeenCalledOnce()
  expect(fake.close).toHaveBeenCalledOnce()
})
