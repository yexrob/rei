import { expect, test } from '@playwright/test'
import { electron, assertBackground, foregroundEnabled } from './helpers/electron'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { DesktopEvent } from '../src/shared/desktop'

test('offline runtime burst preserves deltas, permission and intent/lifecycle events through real Electron IPC', async ({}, testInfo) => {
  test.skip(process.platform === 'win32', 'The offline fixture uses a POSIX Node executable wrapper.')
  const root = await mkdtemp(join(tmpdir(), 'rei-event-burst-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const binary = join(root, 'runtime-fixture')
  await writeFile(binary, `#!${process.execPath}\nrequire(${JSON.stringify(resolve('tests/fixtures/runtime-burst.cjs'))})\n`, { mode: 0o755 })
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve(process.env.BINGO_E2E_MAIN || 'out/main/index.js')], env: { ...env, HOME: root, USERPROFILE: root, BINGO_GUI_USER_DATA: join(root, 'desktop'), BINGO_GUI_CWD: workspace, BINGO_GUI_BINARY: binary } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByText('Connected locally')).toBeVisible()
    await page.getByRole('navigation', { name: 'Sessions', exact: true }).getByRole('button', { name: /Burst regression/ }).click()
    await expect(page.locator('h1')).toHaveText('Burst regression')
    await page.evaluate(() => {
      const state = window as typeof window & { burstEvents: DesktopEvent[] }
      state.burstEvents = []
      window.bingoDesktop.onEvent(() => { throw new Error('One bad subscriber must not prevent ACK or other subscribers') })
      window.bingoDesktop.onEvent(event => state.burstEvents.push(event))
    })
    const input = page.getByRole('textbox', { name: 'Message bingo' })
    await expect(input).toBeEditable()
    await expect(input).toHaveValue('')
    await input.fill('Run the isolated burst fixture.')
    await expect(input).toHaveValue('Run the isolated burst fixture.')
    const send = page.getByRole('button', { name: 'Send message', exact: true })
    await expect(send).toBeEnabled()
    await send.click()
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible()
    await expect(page.getByText('Burst delivered in order.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop generation' })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => (window as typeof window & { burstEvents: DesktopEvent[] }).burstEvents.filter(event => event.type === 'rpc' && event.method === 'event').length)).toBe(1008)
    const events = await page.evaluate(() => (window as typeof window & { burstEvents: DesktopEvent[] }).burstEvents)
    const frames = events.flatMap(event => event.type === 'rpc' && event.method === 'event' ? [event.params] : [])
    expect(frames.map(frame => frame.seq)).toEqual(Array.from({ length: 1008 }, (_, n) => n + 1))
    expect(frames.filter(frame => frame.event.type === 'itemDelta').map(frame => frame.event.type === 'itemDelta' ? frame.event.n : -1)).toEqual(Array.from({ length: 1000 }, (_, n) => n))
    expect(frames.filter(frame => frame.event.type !== 'itemDelta').map(frame => frame.event.type)).toEqual(['turnStarted', 'intentAck', 'itemStarted', 'itemCompleted', 'interactionOpened', 'intentAck', 'interactionResolved', 'turnCompleted'])
    expect(events.filter(event => event.type === 'connection' && event.connection.status === 'failed')).toEqual([])
    await expect(page.getByText('The window could not keep up with runtime events.', { exact: false })).toHaveCount(0)
    // A committed reload has a new preload ACK owner and must reconnect cleanly.
    await page.reload()
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByText('Connected locally')).toBeVisible()
  } catch (error) {
    const page = await app.firstWindow()
    await page.screenshot({ path: testInfo.outputPath('burst-failure.png') })
    console.error('Burst failure state:', await page.evaluate(() => window.bingoDesktop.bootstrap()))
    throw error
  } finally {
    if (!foregroundEnabled) await assertBackground(app)
    await app.close()
  }
})
