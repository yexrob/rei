// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverBinary } from './binary'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rei-discovery-')); roots.push(root)
  const resourcesPath = join(root, 'resources'); const path = join(root, 'path')
  await mkdir(join(resourcesPath, 'bin'), { recursive: true }); await mkdir(path)
  const filename = process.platform === 'win32' ? 'bingo.exe' : 'bingo'
  const bundled = join(resourcesPath, 'bin', filename); const installed = join(path, filename)
  for (const file of [bundled, installed]) { await copyFile(process.execPath, file); await chmod(file, 0o755) }
  return { bundled: await realpath(bundled), installed: await realpath(installed), options: { appPath: root, resourcesPath, packaged: true, preference: null, env: { PATH: path } } }
}

it.skipIf(!process.env.BINGO_TEST_PACKAGED_RESOURCES)('discovers bingo from the actual unpacked artifact without an external override', async () => {
  const resourcesPath = process.env.BINGO_TEST_PACKAGED_RESOURCES!
  const location = await discoverBinary({ appPath: join(resourcesPath, 'app.asar'), resourcesPath, packaged: true, preference: null, env: { PATH: '' } })
  expect(location).toEqual({ path: await realpath(join(resourcesPath, 'bin', process.platform === 'win32' ? 'bingo.exe' : 'bingo')), source: 'bundled' })
})

describe('packaged default runtime discovery', () => {
  it('chooses the bundled native filename before any installed runtime', async () => {
    const { bundled, options } = await fixture()
    expect(await discoverBinary(options)).toEqual({ path: bundled, source: 'bundled' })
  })
  it('honors an external selection and returns to bundled when cleared', async () => {
    const { bundled, installed, options } = await fixture()
    expect(await discoverBinary({ ...options, preference: installed })).toEqual({ path: installed, source: 'preferences' })
    expect(await discoverBinary({ ...options, preference: null })).toEqual({ path: bundled, source: 'bundled' })
  })
  it('preserves the development environment override even when the saved selection is cleared', async () => {
    const { bundled, installed, options } = await fixture()
    expect(await discoverBinary({ ...options, packaged: false, preference: bundled, env: { ...options.env, BINGO_GUI_BINARY: installed } })).toEqual({ path: installed, source: 'environment' })
    expect(await discoverBinary({ ...options, packaged: false, env: { ...options.env, BINGO_GUI_BINARY: installed } })).toEqual({ path: installed, source: 'environment' })
  })
  it('ignores the environment override in packaged builds', async () => {
    const { bundled, installed, options } = await fixture()
    expect(await discoverBinary({ ...options, env: { ...options.env, BINGO_GUI_BINARY: installed } })).toEqual({ path: bundled, source: 'bundled' })
    expect(await discoverBinary({ ...options, preference: installed, env: { ...options.env, BINGO_GUI_BINARY: join(options.appPath, 'missing') } })).toEqual({ path: installed, source: 'preferences' })
  })
  it('does not silently substitute bundled code for a broken explicit selection', async () => {
    const { options } = await fixture()
    expect(await discoverBinary({ ...options, preference: join(options.appPath, 'missing') })).toEqual({ path: null, source: 'unavailable saved binary' })
    expect(await discoverBinary({ ...options, packaged: false, env: { BINGO_GUI_BINARY: join(options.appPath, 'missing') } })).toEqual({ path: null, source: 'invalid environment override' })
  })
})
