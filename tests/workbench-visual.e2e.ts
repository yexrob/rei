import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const binary = process.env.BINGO_E2E_BINARY || resolve('../bingo-improve/target/debug', process.platform === 'win32' ? 'bingo.exe' : 'bingo')
async function launch(collaboration = false) {
  const home = await mkdtemp(join(tmpdir(), 'rei-visual-'))
  const workspace = join(home, 'paper-trail')
  await mkdir(join(home, '.bingo')); await mkdir(workspace)
  await writeFile(join(workspace, 'notes.txt'), 'A small workspace, ready for a careful first step.\n')
  await writeFile(join(home, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1', permissions: { defaultMode: 'bypassPermissions' } }))
  const script = join(home, 'responses.json')
  await writeFile(script, JSON.stringify({ responses: collaboration ? [
    { steps: [{ toolCall: { name: 'SpawnAgent', input: { name: 'Reviewer', standby: true, prompt: 'Wait for work.', thinking: 'off' } } }] },
    { steps: [{ text: 'Team is ready.' }] }
  ] : [
    { steps: [{ text: 'I’ll read the workspace note first.' }, { toolCall: { name: 'Read', input: { file_path: join(workspace, 'notes.txt') } } }] },
    { steps: [{ text: '## A clear starting point\n\nThe note is ready. We can build on it without changing the original.\n\n- Read the existing code\n- Decide on a small change\n- Verify it with a test' }] },
    { steps: [{ text: 'Working on the next step.' }, { delay: { ms: 60000 } }] }
  ] }))
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, HOME: home, USERPROFILE: home, BINGO_GUI_USER_DATA: join(home, 'desktop'), BINGO_GUI_CWD: workspace, BINGO_GUI_BINARY: binary, BINGO_FAKE_SCRIPT: script } })
  const page = await app.firstWindow()
  await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
  await expect(page.getByText('Connected locally')).toBeVisible()
  return { app, page }
}
async function close(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) }).catch(() => {})
  await app.close()
}
async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations).toEqual([])
}
async function resize(app: ElectronApplication, width: number, height: number) {
  await app.evaluate(({ BrowserWindow }, size) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(360, 360); w.setSize(size[0], size[1]) }, [width, height])
}
async function tokenContrast(page: Page) {
  const ratios = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    const luminance = (token: string) => {
      const rgb = style.getPropertyValue(token).trim().slice(1).match(/../g)!.map((v) => parseInt(v, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
    }
    return ['--canvas', '--sidebar', '--surface', '--hover', '--selected'].flatMap((bg) => ['--quiet', '--secondary'].map((fg) => {
      const a = luminance(fg), b = luminance(bg)
      return { fg, bg, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
    }))
  })
  for (const { fg, bg, ratio } of ratios) expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
}

test('workbench visuals: focused composer, real conversation, motion, light/dark and narrow EN/ZH', async ({}, info) => {
  test.setTimeout(120000)
  const { app, page } = await launch()
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message))
  const capture = async (name: string) => {
    if (name.startsWith('settings-')) {
      await page.locator('.settings-content').evaluate((el) => { el.scrollTop = 0 })
      await expect(page.locator('.settings-page-heading h1')).toBeInViewport()
    }
    // Motion is asserted separately below; design evidence must show the settled state.
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`${name}.png`) })
  }
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Light', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Light', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await capture('settings-light-en'); await axe(page); await page.keyboard.press('Escape')
    await capture('welcome-light-en'); await axe(page); await tokenContrast(page)
    const input = page.getByRole('textbox', { name: 'Message bingo' })
    await input.fill('Read the workspace note and help me plan a small change.')
    await expect(input).toBeFocused()
    await expect(page.locator('.session-row')).toHaveCount(0)
    await expect(page.locator('.prompt-starters')).toHaveCount(0)
    await expect(page.locator('.welcome-heading')).toContainText('What would you like to work on?')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'A clear starting point' })).toBeVisible()
    await expect(page.locator('.prompt-starters')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled()
    await capture('conversation-light-en'); await axe(page)
    // Exercise actual hover text colors inside recorded tool details, not just the empty screen.
    const tool = page.locator('.tool-card').first()
    await tool.getByRole('button', { name: 'Show tool details' }).click(); await tool.hover(); await axe(page)
    const copy = page.locator('.assistant-message .copy-control button').last()
    await copy.hover()
    await expect.poll(() => copy.locator('.icon-motion').evaluate((el) => getComputedStyle(el).transform)).not.toBe('none')
    expect(await copy.locator('.icon-motion').evaluate((el) => getComputedStyle(el).transitionDuration)).toContain('0.22s')
    await copy.focus(); await expect(copy).toBeFocused()
    await copy.click()
    await expect(copy).toHaveAttribute('aria-label', 'Copied')
    expect(await copy.locator('svg').evaluate((el) => getComputedStyle(el).animationName)).toContain('symbol-enter')
    expect(await copy.locator('svg').evaluate((el) => getComputedStyle(el).animationIterationCount)).toBe('1')
    await page.getByRole('button', { name: 'Session details', exact: true }).click()
    await expect(page.locator('.session-metrics')).toBeVisible()
    await expect(page.locator('.session-metrics')).toHaveCSS('display', 'flex')
    await expect(page.locator('.session-details')).toHaveCSS('opacity', '1')
    const meterBounds = await page.locator('.session-metrics').boundingBox()
    expect(meterBounds?.height).toBeLessThan(100)
    expect(await page.locator('.token-chart').getAttribute('aria-label')).toMatch(/\d/)
    await capture('session-metrics-light'); await axe(page)
    await page.getByRole('button', { name: 'Session details', exact: true }).click()
    await input.fill('Keep working')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toBeVisible()
    await capture('working-light-en')
    await page.getByRole('button', { name: 'Stop generation', exact: true }).click()
    await expect(page.getByText('Turn interrupted. Completed changes have not been undone.')).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await capture('settings-dark-en'); await axe(page); await tokenContrast(page)
    await page.getByRole('combobox', { name: 'Language' }).click()
    await page.getByRole('option', { name: '简体中文', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await capture('settings-dark-zh'); await axe(page)
    await page.keyboard.press('Escape')
    await capture('conversation-dark-zh'); await axe(page)
    await page.getByRole('button', { name: '新建对话', exact: true }).click()
    await capture('welcome-dark-zh'); await axe(page)
    await page.getByRole('button', { name: '隐藏侧边栏', exact: true }).click()
    await resize(app, 430, 760)
    await expect(page.locator('.welcome-heading')).toBeVisible()
    await capture('welcome-narrow-dark-zh'); await axe(page)
    const regions = await page.locator('.welcome-heading, .composer-region').evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }))
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    for (const r of regions) { expect(r.left).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(viewport.width); expect(r.bottom).toBeLessThan(viewport.height) }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator('.composer textarea').fill('保留为草稿')
    expect(await page.locator('.send-button .icon-motion').evaluate((el) => ({ animation: getComputedStyle(el).animationName, transition: getComputedStyle(el).transitionDuration }))).toEqual({ animation: 'none', transition: '0s' })
    expect(await page.locator('.composer').evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s')
    await page.getByRole('button', { name: '显示侧边栏', exact: true }).click()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await capture('settings-narrow-dark-zh'); await axe(page)
    await page.getByRole('button', { name: '浅色', exact: true }).click()
    await expect(page.getByRole('button', { name: '浅色', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('combobox', { name: '语言' }).click()
    await page.getByRole('option', { name: 'English', exact: true }).click()
    await capture('settings-narrow-light-en'); await axe(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
    await capture('welcome-narrow-light-en'); await axe(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.emulateMedia({ forcedColors: 'active' })
    await input.focus()
    expect(await page.locator('.composer').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
    expect(errors).toEqual([])
    console.info('Workbench evidence:', info.outputDir)
  } finally { await close(app) }
})

test('collaborator geometry stays stable with long translated names and changing status', async ({}, info) => {
  const { app, page } = await launch(true)
  try {
    await page.getByRole('textbox', { name: 'Message bingo' }).fill('Create the team')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByText('Team is ready.')).toBeVisible()
    await page.getByRole('button', { name: 'Environment', exact: true }).click()
    await page.getByRole('button', { name: 'Collaborators', exact: true }).hover()
    await expect(page.locator('.collaboration-row')).toHaveCount(2)
    for (const width of [1200, 760]) {
      await resize(app, width, 800)
      // Geometry fixture only: keep the actual React-produced DOM and styles,
      // then vary the two text fields independently of transport timing.
      const result = await page.locator('.collaboration-row').evaluateAll((rows) => {
        const dock = rows[0].closest('.collaboration-dock')!
        const measure = () => rows.map((r) => ({ height: r.getBoundingClientRect().height, top: r.getBoundingClientRect().top }))
        const tests: { before: ReturnType<typeof measure>; after: ReturnType<typeof measure> }[] = []
        for (const compact of [false, true]) {
          dock.classList.toggle('collaboration-dock-compact', compact)
          rows[0].querySelector('.collaboration-row-heading strong')!.textContent = '正在检查跨项目边界与权限策略的审查智能体'
          rows[0].querySelector('.collaboration-row-status')!.textContent = 'Working'
          const before = measure()
          rows[0].querySelector('.collaboration-row-status')!.textContent = '等待你确认是否允许修改当前工作区的文件'
          tests.push({ before, after: measure() })
        }
        return tests
      })
      for (const pair of result) expect(pair.after).toEqual(pair.before)
      await page.screenshot({ path: info.outputPath(`collaborator-geometry-${width}.png`) })
    }
  } finally { await close(app) }
})
