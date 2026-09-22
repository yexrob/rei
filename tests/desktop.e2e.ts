import { _electron as electron, expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdtemp, mkdir, writeFile, readFile, access, stat, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { configureProvider } from '../src/main/desktop/provider-setup'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const binary = process.env.BINGO_E2E_BINARY || resolve('../bingo-improve/target/debug', process.platform === 'win32' ? 'bingo.exe' : 'bingo')

async function expectComposerPosition(page: Page, centered: boolean) {
  if (!centered) {
    await expect.poll(() => page.locator('.conversation').evaluate((conversation) => Math.abs(conversation.querySelector('.composer-region')!.getBoundingClientRect().bottom - conversation.getBoundingClientRect().bottom))).toBeLessThan(2)
    return
  }
  // The complete starting area is the composition, not the input alone.
  await expect.poll(() => page.locator('.conversation').evaluate((conversation) => {
    const bounds = conversation.getBoundingClientRect()
    const heading = conversation.querySelector('.welcome-heading')!.getBoundingClientRect()
    const composer = conversation.querySelector('.composer-region')!.getBoundingClientRect()
    return Math.abs((heading.top + composer.bottom) / 2 - (bounds.top + bounds.bottom) / 2) < 30
      && heading.top >= bounds.top + 15 && composer.bottom <= bounds.bottom - 15
      && heading.bottom + 16 <= composer.top
      && composer.width >= Math.min(300, bounds.width - 40)
  })).toBe(true)
}

test('real desktop: connect, stream, approve, resume, stop, themes and narrow layout', async ({}, testInfo) => {
  await access(binary)
  const root = await mkdtemp(join(tmpdir(), 'rei-e2e-'))
  const workspace = join(root, 'sample-project')
  await mkdir(join(root, '.bingo'), { recursive: true })
  await mkdir(workspace)
  await writeFile(join(root, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1', permissions: { defaultMode: 'default' } }))
  const script = join(root, 'responses.json')
  await writeFile(script, JSON.stringify({ responses: [
    { steps: [{ text: 'I will create a small note in this workspace.' }, { toolCall: { name: 'Write', input: { file_path: join(workspace, 'note.txt'), content: 'Verified through the real desktop.' } } }] },
    { steps: [{ text: '## Ready for review\n\nThe note has been created.\n\n- Local workspace\n- Explicit permission\n- Durable history\n\n```ts\nconst ready = true\n```' }] },
    { steps: [{ text: 'Working on the next task.' }, { delay: { ms: 60000 } }] }
  ] }))
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, HOME: root, USERPROFILE: root, BINGO_GUI_USER_DATA: join(root, 'rei-data'), BINGO_GUI_CWD: workspace, BINGO_GUI_BINARY: binary, BINGO_FAKE_SCRIPT: script } })
  const page = await app.firstWindow()
  await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await expect(page.getByText('Connected locally')).toBeVisible()
    await expect(page.getByText('bingo is not connected. Reconnect to continue.')).toHaveCount(0)
    await expect(page.locator('.empty-conversation .composer')).toBeVisible()
    await expect(page.locator('.empty-state, .welcome-project')).toHaveCount(0)
    await expectComposerPosition(page, true)
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('workspace-light.png') })
    const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 600))
    await expectComposerPosition(page, true)
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('empty-composer-narrow.png') })
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), size)
    expect(await page.evaluate(() => ({ require: typeof (window as any).require, process: typeof (window as any).process }))).toEqual({ require: 'undefined', process: 'undefined' })
    await page.getByRole('textbox', { name: 'Message bingo' }).fill('Create a note for this project.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible()
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('permission.png') })
    await page.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Ready for review' })).toBeVisible()
    await expect(page.getByText('Context update', { exact: true })).toHaveCount(0)
    await expect(page.locator('.context-contribution')).toHaveCount(0)
    await expect(page.locator('.empty-conversation')).toHaveCount(0)
    await expectComposerPosition(page, false)
    expect(await readFile(join(workspace, 'note.txt'), 'utf8')).toBe('Verified through the real desktop.')
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('conversation-light.png') })
    const a11y = await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(a11y.violations).toEqual([])
    await page.getByRole('button', { name: 'New thread', exact: true }).click()
    await expect(page.locator('.empty-conversation .composer')).toBeVisible()
    await expect(page.locator('.empty-state, .welcome-project')).toHaveCount(0)
    await expectComposerPosition(page, true)
    await page.getByRole('navigation', { name: 'Sessions', exact: true }).getByRole('button').first().click()
    await expect(page.getByRole('heading', { name: 'Ready for review' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Message bingo' }).fill('Do the next task.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Turn interrupted. Completed changes have not been undone.')).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('settings-dark.png') })
    await page.keyboard.press('Escape')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 600))
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('conversation-narrow-dark.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Hide sidebar' }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2))
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(500)
    await expect.poll(() => page.getByRole('button', { name: 'Send message' }).evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight
    })).toBe(true)
    const zoomCapture = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
    await writeFile(testInfo.outputPath('conversation-zoom.png'), Buffer.from(zoomCapture, 'base64'))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
    console.info('Desktop visual evidence:', testInfo.outputDir)
  } finally { await app.close() }
})

test('first-run desktop: missing runtime has a recoverable setup flow and keyboard-accessible settings', async ({}, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'rei-onboarding-'))
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, HOME: root, USERPROFILE: root, BINGO_GUI_USER_DATA: join(root, 'rei-data'), BINGO_GUI_BINARY: join(root, 'not-installed') } })
  const page = await app.firstWindow()
  await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
  try {
    await expect(page.getByRole('heading', { name: 'Connect bingo' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choose executable', exact: true })).toBeVisible()
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('onboarding-light.png') })
    console.info('Onboarding visual evidence:', testInfo.outputPath('onboarding-light.png'))
    expect((await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Models & providers' }).click()
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('onboarding-provider-settings.png') })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused()
    expect(await page.evaluate(() => localStorage.getItem('rei.drafts.v1'))).not.toContain('apiKey')
  } finally { await app.close() }
})

test('sidebar preserves thread positions across selection, new threads and renderer reload', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rei-sidebar-order-'))
  const workspace = join(home, 'project')
  await mkdir(join(home, '.bingo'), { recursive: true }); await mkdir(workspace)
  await writeFile(join(home, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1' }))
  const script = join(home, 'responses.json')
  const titles = ['OLDER_THREAD', 'NEWER_THREAD', 'LATEST_THREAD']
  await writeFile(script, JSON.stringify({ responses: titles.map(title => ({ when: { contains: title }, steps: [{ text: `${title} response` }] })) }))
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, HOME: home, USERPROFILE: home, BINGO_GUI_USER_DATA: join(home, 'desktop'), BINGO_GUI_CWD: workspace, BINGO_GUI_BINARY: binary, BINGO_FAKE_SCRIPT: script } })
  const page = await app.firstWindow()
  const rows = page.locator('.session-row-title')
  const select = async (title: string) => {
    await page.getByRole('navigation', { name: 'Sessions', exact: true }).getByRole('button', { name: new RegExp(title) }).click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  }
  const create = async (title: string) => {
    await page.getByRole('button', { name: 'New thread', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message bingo', exact: true }).fill(title)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByText(`${title} response`, { exact: true })).toBeVisible()
  }
  try {
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByText('Connected locally')).toBeVisible()
    await create(titles[0]); await create(titles[1])
    await expect(rows).toHaveText([titles[1], titles[0]])
    for (const title of [titles[0], titles[1], titles[0]]) { await select(title); await expect(rows).toHaveText([titles[1], titles[0]]) }
    await create(titles[2])
    await expect(rows).toHaveText([...titles].reverse())
    await select(titles[0]); await expect(rows).toHaveText([...titles].reverse())
    await page.reload()
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByText('Connected locally')).toBeVisible()
    await expect(rows).toHaveText([...titles].reverse())
    await select(titles[0]); await expect(rows).toHaveText([...titles].reverse())
  } finally { await app.close() }
})

test('native setup wrapper writes a synthetic key only through the real CLI credential store', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rei-provider-'))
  const credential = 'synthetic-test-key-not-a-real-credential'
  await configureProvider(binary, home, { name: 'test-provider', protocol: 'openai', baseUrl: 'http://127.0.0.1:9', apiKey: credential }, {
    spawnNative: (command, args, options) => spawn(command, args, { ...options, env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home }, stdio: ['pipe', 'pipe', 'pipe'] })
  })
  const settings = await readFile(join(home, '.bingo/settings.toml'), 'utf8')
  const authPath = join(home, '.bingo/data/auth.json')
  expect(settings).not.toContain(credential)
  expect(settings).toContain('[openai.instances.test-provider]')
  expect(settings).toContain('baseUrl = "http://127.0.0.1:9"')
  expect(JSON.parse(await readFile(authPath, 'utf8'))['test-provider'].key === credential).toBe(true)
  if (process.platform !== 'win32') expect((await stat(authPath)).mode & 0o777).toBe(0o600)
  expect((await readdir(join(home, '.bingo/data'))).filter((entry) => entry !== 'auth.json' && entry !== 'auth.json.lock')).toEqual([])
})
