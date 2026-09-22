import { _electron as electron, expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const binary = process.env.BINGO_E2E_BINARY || resolve('../bingo-improve/target/debug', process.platform === 'win32' ? 'bingo.exe' : 'bingo')

test('tool runs: compact success, visible failure, stable inspection and explicit scroll following', async ({}, info) => {
  test.setTimeout(90000)
  const home = await mkdtemp(join(tmpdir(), 'rei-tool-activity-'))
  const workspace = join(home, 'reading-project'), gate = join(home, 'release')
  await mkdir(join(home, '.bingo')); await mkdir(workspace)
  const large = join(workspace, 'long-note.txt'), small = join(workspace, 'short-note.txt')
  await writeFile(large, Array.from({ length: 150 }, (_, i) => `Recorded line ${i + 1}: preserve the reader's place.`).join('\n'))
  await writeFile(small, 'A short recorded note.\n')
  const server = join(home, 'gate.cjs')
  await writeFile(server, `const readline=require('node:readline'), fs=require('node:fs');
const lines=readline.createInterface({input:process.stdin});
lines.on('line',async line=>{const r=JSON.parse(line); if(r.id===undefined)return; let result={};
if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'gate',version:'1'}};
if(r.method==='tools/list')result={tools:[{name:'wait',description:'Wait for the isolated test gate',inputSchema:{type:'object',properties:{}}}]};
if(r.method==='tools/call'){while(!fs.existsSync(${JSON.stringify(gate)}))await new Promise(resolve=>setTimeout(resolve,40));result={content:[{type:'text',text:'The test gate has opened.'}]};}
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});
lines.on('close',()=>process.exit(0));`)
  await writeFile(join(home, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1', permissions: { defaultMode: 'bypassPermissions' }, mcpServers: { gate: { type: 'stdio', command: process.execPath, args: [server] } } }))
  const script = join(home, 'responses.json')
  await writeFile(script, JSON.stringify({ responses: [
    { steps: [{ toolCall: { name: 'Read', input: { file_path: small } } }, { toolCall: { name: 'Read', input: { file_path: small } } }] },
    { steps: [{ text: 'SUCCESS_RUN_FINISHED' }] },
    { steps: [
      { text: Array.from({ length: 18 }, (_, i) => `Paragraph ${i + 1}: background context before the recorded activity.`).join('\n\n') },
      { toolCall: { name: 'Read', input: { file_path: large } } },
      { delay: { ms: 3000 } },
      { toolCall: { name: 'Read', input: { file_path: small } } },
      { toolCall: { name: 'Read', input: { file_path: join(workspace, 'missing.txt') } } },
      { toolCall: { name: 'mcp__gate__wait', input: {} } }
    ] },
    { steps: [
      { text: 'APPENDED_WHILE_READING\n\n' + Array.from({ length: 18 }, (_, i) => `New paragraph ${i + 1}, appended without moving the reader.`).join('\n\n') },
      { delay: { ms: 5000 } },
      { text: '\n\nAPPENDED_AFTER_JUMP\n\n' + 'More streamed content.\n\n'.repeat(12) }
    ] }
  ] }))
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, HOME: home, USERPROFILE: home, BINGO_GUI_USER_DATA: join(home, 'desktop'), BINGO_GUI_CWD: workspace, BINGO_GUI_BINARY: binary, BINGO_FAKE_SCRIPT: script } })
  const page = await app.firstWindow()
  try {
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByText('Connected locally')).toBeVisible()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const input = page.getByRole('textbox', { name: 'Message bingo' })
    await input.fill('Read the short note twice')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByText('SUCCESS_RUN_FINISHED')).toBeVisible()
    const success = page.locator('.tool-activity').first()
    await expect(success.getByRole('button', { name: 'Show tool activity' })).toHaveAttribute('aria-expanded', 'false')
    await expect(success.locator('.tool-card').first()).toBeHidden()
    await page.screenshot({ animations: 'disabled', path: info.outputPath('completed-run-summary.png') })
    await input.fill('Inspect a longer run')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    const run = page.locator('.tool-activity').nth(1)
    const firstToggle = run.locator('.tool-card-toggle').first()
    await expect(firstToggle).toBeVisible()
    await expect(run.locator('.tool-activity-toggle')).toHaveCount(0)
    await firstToggle.click()
    await firstToggle.evaluate(el => { el.setAttribute('data-mount-probe', 'original') })
    await expect(run.locator('.tool-card')).toHaveCount(4)
    await expect(firstToggle).toHaveAttribute('data-mount-probe', 'original')
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(run.locator('.recorded-source').first()).toContainText('Recorded line 150')
    await expect(run.locator('.tool-card--failed')).toBeVisible()
    await expect(run.locator('[data-tool-name="mcp__gate__wait"]')).toBeVisible()
    await firstToggle.click()
    await run.getByRole('button', { name: 'Hide tool activity' }).click()
    await expect(run.locator('.tool-card--completed').first()).toBeHidden()
    await expect(run.locator('.tool-card--failed')).toBeVisible()
    await expect(run.locator('.tool-card--failed .tool-error-preview')).toContainText(/missing|exist|file/i)
    await page.screenshot({ animations: 'disabled', path: info.outputPath('collapsed-run-visible-failure.png') })
    const timeline = page.locator('.timeline')
    // Put the reader at the actual live bottom before testing manual inspection.
    const latest = page.getByRole('button', { name: 'Jump to latest' })
    if (await latest.isVisible()) await latest.click()
    else await timeline.evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect.poll(() => timeline.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
    const groupToggle = run.locator('.tool-activity-toggle')
    await groupToggle.scrollIntoViewIfNeeded()
    const groupTop = (await groupToggle.boundingBox())!.y
    await groupToggle.click()
    await expect(groupToggle).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(async () => Math.abs((await groupToggle.boundingBox())!.y - groupTop)).toBeLessThan(2)
    await firstToggle.scrollIntoViewIfNeeded()
    const readTop = (await firstToggle.boundingBox())!.y
    await firstToggle.click()
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(async () => Math.abs((await firstToggle.boundingBox())!.y - readTop)).toBeLessThan(2)
    const readingPosition = await timeline.evaluate(el => el.scrollTop)
    await expect(latest).toBeVisible()
    await writeFile(gate, 'continue')
    await expect(page.locator('.assistant-message').last()).toContainText('APPENDED_WHILE_READING')
    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBe(readingPosition)
    await expect(firstToggle).toHaveAttribute('data-mount-probe', 'original')
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.assistant-message').last()).not.toContainText('APPENDED_AFTER_JUMP')
    await page.screenshot({ animations: 'disabled', path: info.outputPath('inspection-keeps-reading-position.png') })
    await latest.click()
    await expect.poll(() => timeline.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
    await expect(page.locator('.assistant-message').last()).toContainText('APPENDED_AFTER_JUMP')
    await expect.poll(() => timeline.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
    await expect(latest).toHaveCount(0)
    await page.screenshot({ animations: 'disabled', path: info.outputPath('explicit-jump-resumes-following.png') })
    expect((await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('combobox', { name: 'Language' }).click()
    await page.getByRole('option', { name: '简体中文', exact: true }).click()
    await page.keyboard.press('Escape')
    await run.evaluate(el => {
      const viewport = el.closest('.timeline')!
      viewport.scrollTop += el.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 16
    })
    await expect(run.getByRole('button', { name: '收起工具活动' })).toBeVisible()
    await expect(run.locator('.recorded-range').first()).toContainText('记录行 1–150')
    await expect(firstToggle).toHaveAttribute('aria-label', /收起工具详情: Read/)
    await page.screenshot({ animations: 'disabled', path: info.outputPath('grouped-recorded-read-dark-zh.png') })
    expect((await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
  } finally {
    await writeFile(gate, 'cleanup')
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) }).catch(() => {})
    await app.close()
  }
})
