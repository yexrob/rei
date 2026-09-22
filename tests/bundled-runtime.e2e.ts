import { expect, test } from '@playwright/test'
import { electron, foregroundEnabled } from './helpers/electron'
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'

const executablePath = process.env.BINGO_TEST_PACKAGED_APP

test('packaged app connects and streams using only its bundled runtime', async ({}, info) => {
  test.skip(!foregroundEnabled, 'Packaged apps have no test-only hidden mode. Requires explicit REI_E2E_FOREGROUND=1 and user approval.')
  test.skip(!executablePath, 'Set BINGO_TEST_PACKAGED_APP to the unpacked native application executable.')
  await access(executablePath!)
  const home = await mkdtemp(join(tmpdir(), 'rei-packaged-e2e-'))
  const userData = join(home, 'desktop')
  await mkdir(join(home, '.bingo'), { recursive: true })
  await mkdir(userData)
  await writeFile(join(home, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1', permissions: { defaultMode: 'default' } }))
  const script = join(home, 'responses.json')
  await writeFile(script, JSON.stringify({ responses: [{ steps: [{ text: '## Bundled runtime verified\n\nThis response came from the bingo shipped inside Rei.' }] }] }))
  const inherited = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`],
    env: { ...inherited, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, BINGO_FAKE_SCRIPT: script }
  })
  try {
    const native = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, userData: app.getPath('userData'), home: app.getPath('home'), binaryOverride: process.env.BINGO_GUI_BINARY }))
    expect(native.packaged).toBe(true)
    expect(native.binaryOverride).toBeUndefined()
    const dataRelative = relative(await realpath(home), await realpath(native.userData))
    expect(isAbsolute(dataRelative) || dataRelative.startsWith('..')).toBe(false)
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByText('Connected locally')).toBeVisible()
    await expect(page.getByText('bingo is not connected. Reconnect to continue.')).toHaveCount(0)
    const bootstrap = await page.evaluate(() => window.bingoDesktop.bootstrap())
    expect(bootstrap.ok).toBe(true)
    if (!bootstrap.ok) throw new Error(bootstrap.error.message)
    expect(bootstrap.value.preferences.binaryPath).toBeNull()
    const binary = await realpath(join(native.resourcesPath, 'bin', process.platform === 'win32' ? 'bingo.exe' : 'bingo'))
    expect(bootstrap.value.binary).toEqual({ path: binary, source: 'bundled' })
    await page.getByRole('textbox', { name: 'Message bingo' }).fill('Verify the packaged runtime.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Bundled runtime verified' })).toBeVisible()
    await page.screenshot({ animations: 'disabled', path: info.outputPath('bundled-runtime.png') })
    expect(errors).toEqual([])
    console.info('Packaged runtime verified:', JSON.stringify({ executablePath, binary, source: bootstrap.value.binary.source, userData: native.userData, screenshot: info.outputPath('bundled-runtime.png') }))
  } finally {
    await app.close()
    await rm(home, { recursive: true, force: true })
  }
})
