import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { electron, settledMotion } from './helpers/electron'
import AxeBuilder from '@axe-core/playwright'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const binary = process.env.BINGO_E2E_BINARY || resolve('../bingo-improve/target/debug', process.platform === 'win32' ? 'bingo.exe' : 'bingo')

async function collaborationFixture() {
  const home = await mkdtemp(join(tmpdir(), 'rei-collaboration-'))
  const workspace = join(home, 'collaboration-project')
  await mkdir(join(home, '.bingo'), { recursive: true })
  await mkdir(workspace)
  await writeFile(join(home, '.bingo/settings.toml'), 'provider = "fake"\nmodel = "fake-1"\n[permissions]\ndefaultMode = "bypassPermissions"\n')
  const script = join(home, 'responses.json')
  // Held fake turns outlive the 120s journey; only explicit test actions stop them.
  await writeFile(script, JSON.stringify({ responses: [
    { when: { contains: 'COLLABORATION_ROOT_START' }, steps: [
      { toolCall: { name: 'SpawnAgent', input: { name: 'Planner', standby: true, prompt: 'Wait for planning work.', thinking: 'off' } } },
      { toolCall: { name: 'SpawnAgent', input: { name: 'Reviewer', standby: true, model: 'fake-child', prompt: 'Wait for review work.', thinking: 'off' } } },
      { toolCall: { name: 'OpenRoom', input: { name: 'search-review', purpose: 'Review local session search.', members: ['parent', 'Planner', 'Reviewer'], listeners: [{ name: 'parent', patience_s: 3600 }, { name: 'Planner', patience_s: 3600 }, { name: 'Reviewer', patience_s: 3600 }] } } }
    ] },
    { when: { contains: 'COLLABORATION_ROOT_START' }, steps: [{ text: 'TEAM_READY: I am still working while you collaborate.' }, { delay: { ms: 180000 } }] },
    { when: { contains: 'REVIEWER_DIRECT_ONLY' }, steps: [{ text: 'REVIEWER_ACTIVITY_START: checking search edge cases.' }, { delay: { ms: 180000 } }] },
    { when: { contains: 'ROOM_POST_ONLY' }, steps: [{ toolCall: { name: 'SendMessage', input: { to: '#search-review', text: 'Room reply from Reviewer: the workspace boundary needs a regression test.' } } }] },
    { when: { contains: 'ROOM_POST_ONLY' }, steps: [{ text: 'ROOM_REPLY_DONE' }] }
  ] }))
  return { home, workspace, script }
}

async function launch() {
  const { home, workspace, script } = await collaborationFixture()
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, HOME: home, USERPROFILE: home, BINGO_GUI_USER_DATA: join(home, 'desktop'), BINGO_GUI_CWD: workspace, BINGO_GUI_BINARY: binary, BINGO_FAKE_SCRIPT: script } })
  const page = await app.firstWindow()
  await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
  await expect(page.getByText('Connected locally')).toBeVisible()
  return { app, page }
}

async function openEnvironment(page: Page) {
  const trigger = page.getByRole('button', { name: 'Environment', exact: true })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  await expect(page.getByRole('dialog', { name: 'Environment', exact: true })).toBeVisible()
}

async function openCollaborators(page: Page) {
  await openEnvironment(page)
  await page.getByRole('button', { name: 'Collaborators', exact: true }).hover()
  await expect(page.getByRole('navigation', { name: 'Collaborators' })).toBeVisible()
  return page.getByRole('navigation', { name: 'Collaborators' })
}

async function close(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) }).catch(() => {})
  await app.close()
}

test('collaboration: stacked live journals, child routing, independent drafts, room posts and closed rooms', async ({}, info) => {
  // Linux software rendering reached the second axe pass at ~48s, then hit
  // the 60s overall limit. Keep every journey/assertion with a bounded budget.
  test.setTimeout(120000)
  const { app, page } = await launch()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const mainInput = page.getByRole('textbox', { name: 'Message bingo', exact: true })
    await mainInput.fill('COLLABORATION_ROOT_START — create the team and coordinate search review.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByText('TEAM_READY: I am still working while you collaborate.')).toBeVisible()
    await mainInput.fill('Unsent draft for the main agent.')
    await openEnvironment(page)
    await expect(page.getByRole('button', { name: 'Open room #search-review' })).toBeVisible()
    await expect(page.locator('.environment-count').first()).toHaveText('2 idle')
    await page.screenshot({ animations: 'disabled', path: info.outputPath('collaboration-stacked.png') })
    expect((await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Environment' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible()

    const list = await openCollaborators(page)
    await expect(list.getByRole('button', { name: /^Bingo · Main/ })).toBeVisible()
    await expect(list.getByRole('button', { name: /^Planner · Agent/ })).toBeVisible()
    await expect(list.getByRole('button', { name: /^Reviewer · Agent/ })).toBeVisible()
    await page.screenshot({ animations: 'disabled', path: info.outputPath('collaboration-expanded.png') })
    await list.getByRole('button', { name: /^Reviewer · Agent/ }).click()
    const reviewerInput = page.getByRole('textbox', { name: 'Message Reviewer', exact: true })
    await expect(reviewerInput).toBeVisible()
    await expect(page.getByText('To Reviewer', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Model', exact: true })).toHaveAttribute('title', 'fake/fake-child')
    await reviewerInput.fill('REVIEWER_DIRECT_ONLY — check the empty-query case.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByText('REVIEWER_ACTIVITY_START: checking search edge cases.')).toBeVisible()
    await reviewerInput.fill('Unsent draft for Reviewer.')
    await page.screenshot({ animations: 'disabled', path: info.outputPath('reviewer-conversation.png') })
    await page.getByRole('button', { name: 'Back to Bingo' }).click()
    await expect(mainInput).toHaveValue('Unsent draft for the main agent.')
    await expect(page.getByRole('button', { name: 'Model', exact: true })).toHaveAttribute('title', 'fake/fake-1')

    const live = await openCollaborators(page)
    const reviewerRow = live.getByRole('button', { name: /^Reviewer · Agent · Working/ })
    await expect(reviewerRow).toContainText('REVIEWER_ACTIVITY_START')
    await page.screenshot({ animations: 'disabled', path: info.outputPath('collaboration-live.png') })
    const ids = await live.locator('[data-session-id]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-session-id')))
    await reviewerRow.hover()
    await expect(live).toBeVisible()
    expect(await live.locator('[data-session-id]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-session-id')))).toEqual(ids)
    await reviewerRow.click()
    await expect(reviewerInput).toHaveValue('Unsent draft for Reviewer.')
    await reviewerInput.focus()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Turn interrupted. Completed changes have not been undone.')).toBeVisible()
    await page.getByRole('button', { name: 'Back to Bingo' }).click()
    await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible()
    await expect(mainInput).toHaveValue('Unsent draft for the main agent.')

    await openEnvironment(page)
    await page.getByRole('button', { name: 'Open room #search-review' }).click()
    const roomInput = page.getByRole('textbox', { name: 'Message #search-review', exact: true })
    await expect(roomInput).toBeVisible()
    await expect(page.locator('.room-purpose')).toContainText('Review local session search.')
    await expect(page.getByRole('button', { name: 'Model', exact: true })).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Thinking effort' })).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Permission mode' })).toHaveCount(0)
    await expect(page.getByText('This session is for provider setup. Start a new session when sign-in is complete.')).toHaveCount(0)
    await roomInput.fill('@Reviewer ROOM_POST_ONLY — share your finding in this room.')
    await page.getByRole('button', { name: 'Send to #search-review' }).click()
    await expect(page.getByText('Room reply from Reviewer: the workspace boundary needs a regression test.')).toBeVisible()
    await roomInput.fill('Unsent room draft.')
    await page.screenshot({ animations: 'disabled', path: info.outputPath('room-conversation.png') })
    const details = page.getByRole('button', { name: 'Room details', exact: true })
    if (await details.getAttribute('aria-expanded') !== 'true') await details.click()
    const members = page.getByRole('complementary', { name: 'Room details' })
    await expect(members).toBeVisible()
    await expect(members.getByRole('button', { name: 'Planner Agent' })).toBeVisible()
    const roomBounds = await page.locator('.room-conversation').boundingBox()
    if (roomBounds && roomBounds.width >= 640) {
      const memberBounds = await members.boundingBox()
      const inputBounds = await page.getByRole('button', { name: 'Send to #search-review' }).boundingBox()
      expect(memberBounds).not.toBeNull(); expect(inputBounds).not.toBeNull()
      expect(inputBounds!.x + inputBounds!.width).toBeLessThanOrEqual(memberBounds!.x)
    }
    await page.screenshot({ animations: 'disabled', path: info.outputPath('room-members.png') })
    await members.getByRole('button', { name: 'Reviewer Agent' }).click()
    await expect(reviewerInput).toHaveValue('Unsent draft for Reviewer.')
    await openEnvironment(page)
    await page.getByRole('button', { name: 'Open room #search-review' }).click()
    await expect(roomInput).toHaveValue('Unsent room draft.')
    // Reopening mounts the finite room-details-enter opacity animation. Axe must
    // measure the settled palette, not an arbitrary partially blended frame.
    const beforeAxe = await members.evaluate(node => ({ opacity: getComputedStyle(node).opacity, animations: node.getAnimations().map(animation => animation.playState) }))
    await settledMotion(page)
    await expect(members).toHaveCSS('opacity', '1')
    console.info('Room details before finite-animation settle:', beforeAxe)
    expect((await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
    await page.getByRole('button', { name: 'Back to Bingo' }).click()
    await expect(mainInput).toHaveValue('Unsent draft for the main agent.')
    await mainInput.focus(); await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Stop generation' })).toHaveCount(0)
    await mainInput.fill('/room close search-review')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(mainInput).toHaveValue('')
    await openEnvironment(page)
    await page.getByRole('button', { name: 'Open room #search-review' }).click()
    await expect(roomInput).toHaveValue('Unsent room draft.')
    await expect(page.getByRole('button', { name: 'Send to #search-review' })).toBeDisabled()
    await expect(page.getByText('This room is closed. Your draft is preserved.')).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.keyboard.press('Escape')
    await page.screenshot({ animations: 'disabled', path: info.outputPath('room-dark.png') })
    await test.step('narrow room navigation and collaborator bounds', async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(740, 600))
      await expect.poll(() => page.evaluate(() => window.matchMedia('(max-width: 759px)').matches)).toBe(true)
      await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await expect(page.getByRole('button', { name: 'Back to Bingo' })).toBeVisible()
      const narrowRoster = await openCollaborators(page)
      const rosterBounds = await narrowRoster.boundingBox()
      expect(rosterBounds).not.toBeNull()
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(rosterBounds!.x).toBeGreaterThanOrEqual(0)
      expect(rosterBounds!.x + rosterBounds!.width).toBeLessThanOrEqual(viewport.width)
      expect(rosterBounds!.y + rosterBounds!.height).toBeLessThanOrEqual(viewport.height)
      await page.screenshot({ animations: 'disabled', path: info.outputPath('environment-narrow-dark.png') })
    })
    expect(errors).toEqual([])
    console.info('Collaboration visual evidence:', info.outputDir)
  } finally { await close(app) }
})
