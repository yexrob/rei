import { expect, test } from '@playwright/test'
import { electron, copiedText } from './helpers/electron'
import AxeBuilder from '@axe-core/playwright'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const binary = process.env.BINGO_E2E_BINARY || resolve('../bingo-improve/target/debug', process.platform === 'win32' ? 'bingo.exe' : 'bingo')
const original = JSON.stringify({ data: 'x'.repeat(100000) })
const recorded = `${original.slice(0, 50000)}\n[truncated: ${original.length - 50000} more characters]`
const mcpServer = `
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  if (request.method === 'initialize') result = {protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'clipped',version:'1.0'}};
  if (request.method === 'tools/list') result = {tools:[{name:'large',description:'Return a 100k fixture JSON object',inputSchema:{type:'object',properties:{}}}]};
  if (request.method === 'tools/call') result = {content:[{type:'text',text:JSON.stringify({data:'x'.repeat(100000)})}],isError:false};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});
`

test('real 100k MCP result retains core clipping evidence and defaults to a compact preview', async ({}, info) => {
  const home = await mkdtemp(join(tmpdir(), 'rei-mcp-clipped-'))
  const workspace = join(home, 'workspace')
  await mkdir(workspace)
  await mkdir(join(home, '.bingo'))
  const mcp = join(home, 'mcp.cjs')
  await writeFile(mcp, mcpServer)
  await writeFile(join(home, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1', permissions: { defaultMode: 'bypassPermissions' }, mcpServers: { clipped: { type: 'stdio', command: process.execPath, args: [mcp] } } }))
  const script = join(home, 'responses.json')
  await writeFile(script, JSON.stringify({ responses: [{ steps: [{ toolCall: { name: 'mcp__clipped__large', input: {} } }] }, { steps: [{ text: 'Large MCP fixture recorded.' }] }] }))
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, HOME: home, USERPROFILE: home, BINGO_GUI_USER_DATA: join(home, 'desktop'), BINGO_GUI_CWD: workspace, BINGO_GUI_BINARY: binary, BINGO_FAKE_SCRIPT: script } })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByText('Connected locally')).toBeVisible()
    await page.getByRole('textbox', { name: 'Message bingo' }).fill('Return the isolated 100k MCP fixture.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByText('Large MCP fixture recorded.', { exact: true })).toBeVisible()
    const card = page.locator('[data-tool-name="mcp__clipped__large"]')
    await expect(card).toHaveClass(/tool-card--completed/)
    await card.locator('.tool-card-toggle').press('Enter')
    const result = card.locator('.tool-recorded-result')
    const fallback = result.locator('.tool-structured-fallback')
    await expect(fallback).toBeVisible()
    await expect(fallback).toContainText('The runtime truncated this result. Preview and copy include only the recorded portion, including the truncation marker.')
    await expect(fallback).toContainText('Recorded content · 50035 characters')
    await expect(result.locator('pre')).toHaveCount(0)
    await expect(fallback.locator('details')).not.toHaveAttribute('open', '')
    await expect(card.locator('.tool-diagnostics')).not.toHaveAttribute('open', '')
    await page.screenshot({ animations: 'disabled', path: info.outputPath('core-clipped-mcp-collapsed.png') })

    // Shared test sink: verify the exact renderer payload, never the OS clipboard.
    await fallback.getByRole('button', { name: 'Copy recorded output' }).click()
    await expect.poll(() => copiedText(page)).toBe(recorded)
    await expect(fallback.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
    await fallback.getByText('Inspect recorded content', { exact: true }).click()
    const preview = fallback.locator('pre')
    // This is the actual core output, not the original server payload or an invented repair.
    expect(await preview.textContent()).toBe(recorded)
    expect(recorded.length).toBe(50035)
    expect(() => JSON.parse(recorded)).toThrow()
    await expect(preview).toContainText('[truncated: 50011 more characters]')
    await expect(preview).toHaveAttribute('tabindex', '0')
    await preview.focus()
    await page.keyboard.press('PageDown')
    await expect.poll(() => preview.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
    await page.screenshot({ animations: 'disabled', path: info.outputPath('core-clipped-mcp-inspected.png') })
    expect((await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
    expect(errors).toEqual([])
    console.info('Core-clipped MCP evidence:', info.outputDir)
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) }).catch(() => {})
    await app.close()
  }
})
