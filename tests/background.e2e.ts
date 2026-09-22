import { expect, test } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertBackground, electron, foregroundEnabled } from './helpers/electron'

test('hidden Electron paints real UI, retains isolation and never shows or activates', async ({}, info) => {
  test.skip(foregroundEnabled, 'This test specifically verifies the default background-only launcher.')
  const home = await mkdtemp(join(tmpdir(), 'rei-hidden-smoke-'))
  const inherited = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...inherited, HOME: home, USERPROFILE: home, BINGO_GUI_USER_DATA: join(home, 'desktop'), BINGO_GUI_BINARY: join(home, 'deliberately-missing-runtime') } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await assertBackground(app)
    await expect(page.getByRole('heading', { name: 'Connect bingo' })).toBeVisible()
    const backgroundThrottling = await app.evaluate(({ BrowserWindow, app }) => {
      const window = BrowserWindow.getAllWindows()[0]
      app.emit('activate', {}, false)
      app.emit('second-instance', {}, [], process.cwd(), {})
      window.setSize(1200, 800)
      return window.webContents.getBackgroundThrottling()
    })
    expect(backgroundThrottling).toBe(false)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const png = await page.screenshot({ animations: 'disabled', path: info.outputPath('hidden-real-renderer.png') })
    expect(png.byteLength).toBeGreaterThan(10_000)
    expect(await page.evaluate(() => ({ width: innerWidth, require: typeof (window as any).require, process: typeof (window as any).process, bridge: typeof (window as any).bingoDesktop.bootstrap }))).toEqual({ width: 1200, require: 'undefined', process: 'undefined', bridge: 'function' })
    await assertBackground(app)
    console.info('Real hidden Electron UI evidence:', info.outputPath('hidden-real-renderer.png'))
  } finally { await app.close() }
})
