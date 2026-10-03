import { expect, test } from '@playwright/test'
import { electron } from './helpers/electron'
import AxeBuilder from '@axe-core/playwright'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const binary = process.env.BINGO_E2E_BINARY || resolve('../bingo-improve/target/debug', process.platform === 'win32' ? 'bingo.exe' : 'bingo')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rei-pencil-'))
  const workspace = join(root, 'bingo-project')
  await mkdir(workspace)
  await mkdir(join(root, '.bingo/skills/design-check'), { recursive: true })
  await writeFile(join(root, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1', permissions: { defaultMode: 'default' } }))
  await writeFile(join(root, '.bingo/skills/design-check/SKILL.md'), '---\nname: design-check\ndescription: Check the desktop design against its acceptance criteria.\n---\nCheck layout and keyboard interactions.\n')
  const git = (...args: string[]) => execFileSync('git', ['-C', workspace, ...args], { env: { ...process.env, HOME: root, USERPROFILE: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' } })
  git('init', '-q')
  await writeFile(join(workspace, 'search.ts'), 'export const localSearch = false\n')
  git('add', 'search.ts')
  git('-c', 'user.name=GUI Test', '-c', 'user.email=gui@example.invalid', 'commit', '-qm', 'Create isolated fixture')
  await writeFile(join(workspace, 'search.ts'), 'export const localSearch = true\nexport const excerpts = true\n')
  return { root, workspace }
}

test('Pencil workspace: real skills, schedule view, Git review and unsent feedback', async ({}, testInfo) => {
  const { root, workspace } = await fixture()
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, HOME: root, USERPROFILE: root, BINGO_GUI_USER_DATA: join(root, 'desktop'), BINGO_GUI_CWD: workspace, BINGO_GUI_BINARY: binary } })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByText('Connected locally')).toBeVisible()
    await expect(page.locator('.empty-conversation .composer')).toBeVisible()
    const composer = page.getByRole('textbox', { name: 'Message bingo' })
    await composer.fill('Keep my unsent context.')
    await page.getByRole('button', { name: 'Skills', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Use design-check' })).toBeVisible()
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('skills.png') })
    await page.getByRole('button', { name: 'Use design-check' }).click()
    await expect(composer).toHaveValue('/design-check Keep my unsent context.')
    await page.getByRole('button', { name: 'Automations', exact: true }).click()
    await expect(page.locator('.automation-result')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New automation', exact: true })).toBeEnabled()
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('automations.png') })
    await page.getByRole('button', { name: 'New thread', exact: true }).click()
    await expect(composer).toHaveValue('/design-check Keep my unsent context.')
    await page.getByRole('button', { name: 'Environment' }).click()
    await page.getByRole('dialog', { name: 'Environment' }).getByRole('button', { name: 'Review changes' }).click()
    await expect(page.getByRole('button', { name: /search\.ts/ })).toBeVisible()
    await expect(page.locator('.review-total')).toContainText('+2')
    await expect(page.getByLabel('Diff for search.ts')).toContainText('localSearch = true')
    await page.getByRole('button', { name: /search\.ts/ }).click()
    await expect(page.getByLabel('Diff for search.ts')).toHaveCount(0)
    await page.getByRole('button', { name: /search\.ts/ }).click()
    await page.getByRole('textbox', { name: 'Feedback for search.ts' }).fill('Please test the empty query too.')
    await page.getByRole('button', { name: 'Add to thread', exact: true }).click()
    await expect(composer).toHaveValue(/Please test the empty query too/)
    await expect(composer).toHaveValue(/Keep my unsent context/)
    await expect(page.locator('.user-message')).toHaveCount(0)
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('review-light.png') })
    expect((await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
    await page.getByRole('button', { name: 'Staged', exact: true }).click()
    await expect(page.getByText('No staged changes.')).toBeVisible()
    await page.getByRole('button', { name: 'Unstaged', exact: true }).click()
    await expect(page.getByRole('button', { name: /search\.ts/ })).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await page.getByRole('button', { name: 'Models & providers', exact: true }).click()
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('providers-dark.png') })
    await page.keyboard.press('Escape')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('review-dark.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(740, 600))
    await expect.poll(() => page.evaluate(() => window.matchMedia('(max-width: 759px)').matches)).toBe(true)
    await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Close changes' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Close changes' }).click()
    await expect(composer).toBeVisible()
    expect(errors).toEqual([])
  } finally { await app.close() }
})
