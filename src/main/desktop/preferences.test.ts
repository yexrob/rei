import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PreferencesStore, restoreBounds } from './preferences'
import { discoverBinary } from './binary'
const directories: string[] = []
async function directory() { const path = await mkdtemp(join(tmpdir(), 'rei-desktop-test-')); directories.push(path); return path }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true }))) })

describe('desktop-owned preferences', () => {
  it('starts with no selected workspace or configured binary', async () => {
    const store = new PreferencesStore(await directory())
    await store.load()
    expect(store.preferences).toEqual({ theme: 'system', workspace: null, binaryPath: null, recentWorkspaces: [] })
  })
  it('serializes atomic writes without dropping unrelated concurrent changes', async () => {
    const store = new PreferencesStore(await directory())
    await store.load()
    await Promise.all([store.save({ workspace: '/workspace/first' }), store.save({ theme: 'dark' }), store.saveBounds({ x: -100, y: 20, width: 1000, height: 720 }), store.save({ binaryPath: '/bin/bingo' })])
    const reloaded = new PreferencesStore(store.path.slice(0, -'/desktop-preferences.json'.length))
    await reloaded.load()
    expect(reloaded.preferences).toMatchObject({ workspace: '/workspace/first', theme: 'dark', binaryPath: '/bin/bingo', recentWorkspaces: ['/workspace/first'] })
    expect(reloaded.bounds?.x).toBe(-100)
    expect(JSON.parse(await readFile(store.path, 'utf8')).version).toBe(1)
  })
  it('bounds and deduplicates recent workspaces', async () => {
    const store = new PreferencesStore(await directory())
    for (let n = 0; n < 15; n += 1) await store.save({ workspace: `/project/${n}` })
    await store.save({ workspace: '/project/10' })
    expect(store.preferences.recentWorkspaces).toHaveLength(12)
    expect(store.preferences.recentWorkspaces[0]).toBe('/project/10')
    expect(store.preferences.recentWorkspaces.filter((path) => path === '/project/10')).toHaveLength(1)
  })
  it('preserves corrupt files rather than overwriting user work', async () => {
    const store = new PreferencesStore(await directory())
    await writeFile(store.path, '{broken')
    await expect(store.load()).rejects.toThrow('preserved')
    await expect(store.save({ theme: 'dark' })).rejects.toThrow('not been overwritten')
    expect(await readFile(store.path, 'utf8')).toBe('{broken')
  })
  it('clamps saved bounds to available monitors, including negative coordinates', () => {
    expect(restoreBounds({ x: 8000, y: -8000, width: 2000, height: 1500 }, [{ x: -1200, y: 0, width: 1200, height: 900 }])).toEqual({ x: -1200, y: 0, width: 1200, height: 900, maximized: undefined })
    expect(restoreBounds(undefined, [])).toBeUndefined()
    expect(restoreBounds({ x: -1000, y: 50, width: 800, height: 600 }, [{ x: -1200, y: 0, width: 1200, height: 900 }])?.x).toBe(-1000)
  })
  it('honors a valid native binary override and never falls back from an invalid override', async () => {
    const path = await directory()
    expect((await discoverBinary({ appPath: path, resourcesPath: path, packaged: true, preference: null, env: { BINGO_GUI_BINARY: process.execPath } })).source).toBe('environment')
    expect(await discoverBinary({ appPath: path, resourcesPath: path, packaged: false, preference: process.execPath, env: { BINGO_GUI_BINARY: '/missing/bingo' } })).toEqual({ path: null, source: 'invalid environment override' })
  })
})
