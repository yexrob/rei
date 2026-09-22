import { expect, test } from '@playwright/test'
import { electron } from './helpers/electron'
import AxeBuilder from '@axe-core/playwright'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const binary = process.env.BINGO_E2E_BINARY || resolve('../bingo-improve/target/debug', process.platform === 'win32' ? 'bingo.exe' : 'bingo')
const html = '<!doctype html>\n<html><body><h1>Recorded preview</h1>\n<script>window.REI_TOOL_SOURCE_EXECUTED = true</script>\n<img src="https://example.invalid/should-not-load.png">\n</body></html>\n'
const mcpServer = `
const readline = require('node:readline');
const lines = readline.createInterface({input:process.stdin});
lines.on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  if (request.method === 'initialize') result = {protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1.0'}};
  if (request.method === 'tools/list') result = {tools:[{name:'inspect',description:'Return an isolated fixture report',inputSchema:{type:'object',properties:{target:{type:'string'}},required:['target']}}]};
  if (request.method === 'tools/call') result = {content:[{type:'text',text:JSON.stringify({service:'fixture',status:'ok',files:[{name:'target.rs',matches:2}],html:'<script>window.REI_TOOL_SOURCE_EXECUTED=true</script>'})}],isError:false};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});
lines.on('close',()=>process.exit(0));
`

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'rei-tool-views-'))
  const workspace = join(home, 'tool-project')
  await mkdir(join(home, '.bingo/skills/presenter-check'), { recursive: true })
  await mkdir(workspace)
  const mcp = join(home, 'mcp-fixture.cjs')
  await writeFile(mcp, mcpServer)
  await writeFile(join(home, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1', permissions: { defaultMode: 'bypassPermissions' }, mcpServers: { fixture: { type: 'stdio', command: process.execPath, args: [mcp] } } }))
  await writeFile(join(home, '.bingo/skills/presenter-check/SKILL.md'), '---\nname: presenter-check\ndescription: Inspect the isolated presenter fixture.\n---\nUse only the isolated fixture.\n')
  await writeFile(join(workspace, 'target.rs'), 'pub fn value() -> u8 { 1 }\n')
  await writeFile(join(workspace, 'readme.rs'), '// outside requested range\npub fn read_me() {}\n// outside requested range\n')
  const script = join(home, 'responses.json')
  await writeFile(script, JSON.stringify({ responses: [
    { steps: [
      { toolCall: { name: 'Write', input: { file_path: join(workspace, 'index.html'), content: html } } },
      { toolCall: { name: 'Edit', input: { file_path: join(workspace, 'target.rs'), old_string: '1', new_string: '2' } } },
      { toolCall: { name: 'Read', input: { file_path: join(workspace, 'readme.rs'), offset: 2, limit: 1 } } },
      { toolCall: { name: 'Glob', input: { pattern: '*.rs', path: workspace } } },
      { toolCall: { name: 'Grep', input: { pattern: 'pub fn', path: workspace, glob: '*.rs', output_mode: 'content', '-n': true } } },
      { toolCall: { name: 'Bash', input: { command: 'echo TOOL_TERMINAL_OUTPUT' } } },
      { toolCall: { name: 'TaskCreate', input: { subject: 'Check semantic tool views', activeForm: 'Checking semantic tool views' } } },
      { toolCall: { name: 'Skill', input: { name: 'presenter-check' } } },
      { toolCall: { name: 'ScheduleList', input: {} } },
      { toolCall: { name: 'mcp__fixture__inspect', input: { target: 'target.rs' } } }
    ] },
    { steps: [{ text: '## Tool views ready\n\nThe recorded changes can be inspected without executing their source.' }, { delay: { ms: 500 } }, { text: '\n\nStreaming continues here.' }, { delay: { ms: 60000 } }] }
  ] }))
  return { home, workspace, script }
}

test('semantic tool UI: recorded files, real MCP, terminal, inline beam and reduced motion', async ({}, info) => {
  const { home, workspace, script } = await fixture()
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, HOME: home, USERPROFILE: home, BINGO_GUI_USER_DATA: join(home, 'desktop'), BINGO_GUI_CWD: workspace, BINGO_GUI_BINARY: binary, BINGO_FAKE_SCRIPT: script } })
  const page = await app.firstWindow()
  const errors: string[] = [], sourceRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => { if (request.url().includes('example.invalid')) sourceRequests.push(request.url()) })
  try {
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByText('Connected locally')).toBeVisible()
    await page.getByRole('textbox', { name: 'Message bingo' }).fill('Exercise each tool presenter in this isolated workspace.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Tool views ready' })).toBeVisible()
    await expect(page.getByText('Streaming continues here.')).toBeVisible()
    await expect(page.locator('.live-working')).toBeVisible()
    await expect(page.locator('.assistant-message').last().locator('.message-actions')).toHaveCount(0)
    const lastMessage = await page.locator('.assistant-message').last().boundingBox()
    const working = await page.locator('.live-working').boundingBox()
    expect(lastMessage).not.toBeNull(); expect(working).not.toBeNull()
    expect(working!.y - (lastMessage!.y + lastMessage!.height)).toBeGreaterThanOrEqual(0)
    expect(working!.y - (lastMessage!.y + lastMessage!.height)).toBeLessThanOrEqual(12)
    expect(await page.locator('.beam-shimmer').evaluate((node) => getComputedStyle(node, '::before').animationName)).toBe('working-beam-sweep')
    expect(await page.locator('.tool-card').evaluateAll((rows) => rows.every((row) => { const style = getComputedStyle(row); return style.borderTopWidth === '0px' && style.backgroundColor === 'rgba(0, 0, 0, 0)' }))).toBe(true)
    await page.screenshot({ animations: 'disabled', path: info.outputPath('semantic-tool-stream.png') })

    // Completed runs are compact by default; explicitly open the recorded activity.
    for (const toggle of await page.getByRole('button', { name: 'Show tool activity', exact: true }).all()) await toggle.click()
    const write = page.locator('[data-tool-name="Write"]')
    // Filename, icon, Enter, and Space all activate the same native row button.
    const writeToggle = write.locator('.tool-card-toggle')
    await write.getByText('index.html', { exact: true }).click()
    await expect(writeToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(write.locator('.recorded-source')).toContainText('REI_TOOL_SOURCE_EXECUTED')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await writeToggle.press('Space')
    await expect(writeToggle).toHaveAttribute('aria-expanded', 'false')
    await writeToggle.press('Enter')
    await expect(writeToggle).toHaveAttribute('aria-expanded', 'true')
    await write.locator('.tool-family-icon').click()
    await expect(writeToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.tool-card button button, .tool-card-disclosure')).toHaveCount(0)
    await write.getByRole('button', { name: 'Preview index.html' }).click()
    await expect(writeToggle).toHaveAttribute('aria-expanded', 'false')
    const preview = page.getByRole('dialog', { name: 'Recorded file preview' })
    await expect(preview.locator('.recorded-source')).toContainText('REI_TOOL_SOURCE_EXECUTED')
    await expect(preview.getByRole('button', { name: 'Written content', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => (window as any).REI_TOOL_SOURCE_EXECUTED)).toBeUndefined()
    expect(sourceRequests).toEqual([])
    await page.screenshot({ animations: 'disabled', path: info.outputPath('recorded-html-source.png') })
    await page.keyboard.press('Escape')
    await expect(preview).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible()
    expect(await readFile(join(workspace, 'index.html'), 'utf8')).toBe(html)

    const edit = page.locator('[data-tool-name="Edit"]')
    await expect(edit.locator('.file-change-counts')).toContainText('+1')
    await edit.getByRole('button', { name: 'Preview target.rs' }).click()
    await expect(preview.locator('.recorded-diff')).toContainText('pub fn value() -> u8 { 2 }')
    await page.screenshot({ animations: 'disabled', path: info.outputPath('recorded-file-diff.png') })
    await page.keyboard.press('Escape')
    const read = page.locator('[data-tool-name="Read"]')
    await read.locator('.tool-card-toggle').press('Enter')
    await expect(read.locator('.recorded-source')).toContainText('pub fn read_me()')
    await expect(read.locator('.recorded-source')).not.toContainText('outside requested range')
    await expect(read.locator('.recorded-range')).toHaveText('Recorded lines 2–2')
    await expect(read.locator('.recorded-line-number').first()).toHaveText('2')
    await page.screenshot({ animations: 'disabled', path: info.outputPath('inline-read-range.png') })
    await read.getByRole('button', { name: 'Preview readme.rs' }).click()
    await expect(preview.locator('.recorded-source')).toContainText('pub fn read_me()')
    await page.keyboard.press('Escape')
    await expect(read.locator('.tool-card-toggle')).toHaveAttribute('aria-expanded', 'true')

    for (const name of ['Glob', 'Grep', 'Bash', 'TaskCreate', 'Skill', 'ScheduleList', 'mcp__fixture__inspect']) {
      const card = page.locator(`[data-tool-name="${name}"]`)
      await expect(card).toBeVisible()
      await card.getByRole('button', { name: /^Show tool details:/ }).click()
      await expect(card.locator('.tool-card-body')).toBeVisible()
    }
    const bash = page.locator('[data-tool-name="Bash"]')
    if (process.platform === 'win32') {
      // The pinned core still resolves /bin/bash or /bin/sh on Windows.
      await expect(bash).toHaveClass(/tool-card--failed/)
      await expect(bash.locator('.tool-recorded-result')).toContainText(/could not run \/bin\/(?:bash|sh):/)
      await expect(bash.locator('.tool-terminal-exit')).toHaveCount(0)
    } else {
      await expect(bash).toHaveClass(/tool-card--completed/)
      await expect(bash.locator('.tool-recorded-result')).toContainText('TOOL_TERMINAL_OUTPUT')
      await expect(bash.locator('.tool-terminal-exit')).toHaveText('Exit 0')
    }
    const mcp = page.locator('[data-tool-name="mcp__fixture__inspect"]')
    await expect(mcp.locator('.tool-mcp-name')).toContainText('fixture')
    await expect(mcp.locator('.tool-json-result')).toContainText('target.rs')
    await expect(mcp.locator('.tool-json-result')).toContainText('matches')
    await expect(mcp.locator('.tool-diagnostics')).not.toHaveAttribute('open', '')
    expect(await page.evaluate(() => (window as any).REI_TOOL_SOURCE_EXECUTED)).toBeUndefined()
    expect(sourceRequests).toEqual([])
    await page.screenshot({ animations: 'disabled', path: info.outputPath('unified-mcp-result.png') })
    expect((await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])

    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await page.locator('.working-beam-icon').evaluate((node) => getComputedStyle(node).animationName)).toBe('none')
    await expect(page.locator('.beam-shimmer')).toBeHidden()
    const timeline = page.locator('.timeline')
    // Card expansion and Playwright's auto-scroll do not guarantee the reader left the bottom.
    expect(await timeline.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(100)
    await timeline.evaluate((node) => { node.scrollTop = 0 })
    await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible()
    await page.getByRole('button', { name: 'Jump to latest' }).click()
    await expect.poll(() => timeline.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(100)
    await expect(page.getByRole('button', { name: 'Jump to latest' })).toHaveCount(0)
    await expect(page.locator('.live-working')).toBeInViewport()
    await page.getByRole('button', { name: 'Stop generation' }).click()
    await expect(page.locator('.live-working')).toHaveCount(0)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.keyboard.press('Escape')
    await edit.getByRole('button', { name: 'Preview target.rs' }).click()
    await page.screenshot({ animations: 'disabled', path: info.outputPath('recorded-diff-dark.png') })
    await page.keyboard.press('Escape')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 600))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
    console.info('Tool presenter visual evidence:', info.outputDir)
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) }).catch(() => {})
    await app.close()
  }
})
