import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { electron, foregroundEnabled } from './helpers/electron'
import type { TerminalState } from '../src/shared/panels'
import AxeBuilder from '@axe-core/playwright'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const binary = process.env.BINGO_E2E_BINARY || resolve('../bingo-improve/target/debug', process.platform === 'win32' ? 'bingo.exe' : 'bingo')
async function home(prefix: string) { const path = await mkdtemp(join(tmpdir(), prefix)); await mkdir(join(path, '.bingo')); return path }
async function launch(root: string, extra: Record<string, string> = {}) {
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, HOME: root, USERPROFILE: root, BINGO_GUI_USER_DATA: join(root, 'rei-data'), BINGO_GUI_BINARY: binary, ...extra } })
  const page = await app.firstWindow()
  await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
  await expect(page.getByText('Connected locally')).toBeVisible()
  return { app, page }
}
async function browserVisible(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const view = window.contentView.children.find((child) => 'webContents' in child && (child as any).webContents.id !== window.webContents.id)
    return view?.getVisible() ?? false
  })
}

async function terminals(page: Page): Promise<TerminalState[]> {
  const snapshot = await page.evaluate(() => window.bingoPanels.snapshot())
  if (!snapshot.ok) throw new Error(snapshot.error.message)
  return snapshot.value.terminals
}
function terminalId(state: TerminalState): string {
  if (!state.id) throw new Error('Native terminal has no identity')
  return state.id
}
function printMarker(marker: string): string {
  const prefix = marker.slice(0, -2), suffix = marker.slice(-2)
  // Keep the complete marker out of the echoed command, proving the shell executed it.
  return process.platform === 'win32' ? `echo ${prefix}^${suffix}` : `printf '%s%s\\n' '${prefix}' '${suffix}'`
}
async function typeInTerminal(page: Page, id: string, command: string): Promise<void> {
  await page.locator(`#terminal-content-${id}`).getByRole('textbox', { name: 'Terminal input' }).focus()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}
async function exerciseTerminalTabs(page: Page): Promise<string> {
  const panel = page.locator('.terminal-panel'), toggle = page.getByRole('button', { name: 'Terminal', exact: true })
  await toggle.click(); await expect(panel).toBeVisible()
  await expect.poll(async () => (await terminals(page)).map((state) => state.status)).toEqual(['running'])
  const first = terminalId((await terminals(page))[0])
  const firstView = page.locator(`#terminal-content-${first}`)
  await typeInTerminal(page, first, printMarker('REI_FIRST_TERMINAL_OK'))
  await expect(firstView).toContainText('REI_FIRST_TERMINAL_OK')
  await page.getByRole('button', { name: 'New terminal', exact: true }).click()
  await expect.poll(async () => (await terminals(page)).map((state) => state.status)).toEqual(['running', 'running'])
  const second = terminalId((await terminals(page))[1])
  expect(second).not.toBe(first)
  const secondView = page.locator(`#terminal-content-${second}`), secondTab = page.locator(`#terminal-tab-${second}`)
  await expect(secondTab).toHaveAttribute('aria-selected', 'true')
  await typeInTerminal(page, second, printMarker('REI_SECOND_TERMINAL_OK'))
  await expect(secondView).toContainText('REI_SECOND_TERMINAL_OK')
  await expect(firstView).not.toContainText('REI_SECOND_TERMINAL_OK')
  await expect(secondView).not.toContainText('REI_FIRST_TERMINAL_OK')
  await page.getByRole('button', { name: 'Hide terminal area', exact: true }).click()
  await expect(panel).toBeHidden()
  expect((await terminals(page)).map(terminalId)).toEqual([first, second])
  const fillOutput = process.platform === 'win32' ? 'for /L %i in (1,1,1200) do @echo 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' : "printf '%070000d\\n' 0"
  const hiddenWrite = await page.evaluate(({ id, data }) => window.bingoPanels.terminalWrite({ id, data }), { id: first, data: `${fillOutput}\r${printMarker('REI_HIDDEN_TERMINAL_OK')}\r` })
  expect(hiddenWrite.ok).toBe(true)
  await expect(firstView).toContainText('REI_HIDDEN_TERMINAL_OK')
  await toggle.click(); await expect(secondTab).toHaveAttribute('aria-selected', 'true')
  expect((await terminals(page)).map(terminalId)).toEqual([first, second])
  await page.locator(`#terminal-tab-${first}`).click()
  // Inspect rendered rows, not the live-region's potentially stale announcements.
  const firstRows = firstView.locator('.xterm-accessibility-tree')
  await expect(firstRows).toContainText('REI_HIDDEN_TERMINAL_OK')
  // xterm 6 owns a virtual scrollbar: setting .xterm-viewport.scrollTop is a no-op.
  // Its track maps pointer positions directly, without platform wheel normalization.
  const scrollbar = firstView.locator('.xterm-scrollable-element > .scrollbar.vertical')
  // Auto-hidden tracks ignore pointer events; enter the screen first to reveal it.
  await toggle.hover()
  await expect(scrollbar).toHaveClass(/\binvisible\b/)
  await firstView.locator('.xterm-screen').hover()
  await expect(scrollbar).toHaveClass(/\bvisible\b/)
  const track = await scrollbar.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }))
  expect(track.width).toBeGreaterThan(0)
  expect(track.height).toBeGreaterThan(2)
  const inspectScroll = async (label: string) => console.info(label, await firstView.evaluate(element => {
    const rows = element.querySelectorAll('.xterm-accessibility-tree [role="listitem"]')
    const bounds = (selector: string) => element.querySelector(selector)?.getBoundingClientRect().toJSON()
    return {
      viewport: [innerWidth, innerHeight], firstRow: rows[0]?.getAttribute('aria-posinset'),
      lastRow: rows[rows.length - 1]?.getAttribute('aria-posinset'), totalRows: rows[0]?.getAttribute('aria-setsize'),
      track: bounds('.scrollbar.vertical'), slider: bounds('.scrollbar.vertical > .slider')
    }
  }).catch(error => ({ unavailable: String(error) })))
  await inspectScroll('Terminal scrollback before track click:')
  try {
    await scrollbar.click({ position: { x: track.width / 2, y: 1 } })
    await expect(firstRows.getByRole('listitem').first()).toHaveAttribute('aria-posinset', '1')
    await inspectScroll('Terminal scrollback at top:')
    await expect(firstRows).toContainText('REI_FIRST_TERMINAL_OK')
    await scrollbar.click({ position: { x: track.width / 2, y: track.height - 1 } })
    await expect(firstRows).toContainText('REI_HIDDEN_TERMINAL_OK')
  } finally { await inspectScroll('Terminal scrollback after track clicks:') }
  await typeInTerminal(page, first, 'exit 7')
  await expect.poll(async () => (await terminals(page)).map(terminalId)).toEqual([second])
  await expect(page.locator(`#terminal-tab-${first}`)).toHaveCount(0)
  await expect(secondTab).toHaveAttribute('aria-selected', 'true')
  await typeInTerminal(page, second, printMarker('REI_SURVIVOR_STILL_RUNNING'))
  await expect(secondView).toContainText('REI_SURVIVOR_STILL_RUNNING')
  await typeInTerminal(page, second, 'exit')
  await expect.poll(() => terminals(page)).toEqual([])
  await expect(panel).toBeHidden(); await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
  expect(await terminals(page)).toEqual([])
  await expect(panel.locator('[role="tab"]')).toHaveCount(0)
  await toggle.click(); await expect(panel).toBeVisible()
  await expect.poll(async () => (await terminals(page)).map((state) => state.status)).toEqual(['running'])
  const fresh = terminalId((await terminals(page))[0])
  expect([first, second]).not.toContain(fresh)
  await typeInTerminal(page, fresh, printMarker('REI_REOPENED_TERMINAL_OK'))
  await expect(page.locator(`#terminal-content-${fresh}`)).toContainText('REI_REOPENED_TERMINAL_OK')
  return fresh
}

test('desktop pickers repair a mixed-case provider, preserve the draft and apply actual thinking without a project', async ({}, info) => {
  const provider = 'Road-anti', model = 'gpt-6-astra/Private'
  const calls: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: [{ id: model, object: 'model' }] })); return }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    calls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const events = [
      { type: 'response.created', response: { id: 'test-response', model } },
      { type: 'response.output_item.added', output_index: 0, item: { id: 'message', type: 'message', role: 'assistant', content: [] } },
      { type: 'response.output_text.delta', output_index: 0, delta: 'The selected model and effort reached the provider.' },
      { type: 'response.output_item.done', output_index: 0, item: { id: 'message', type: 'message', role: 'assistant' } },
      { type: 'response.completed', response: { id: 'test-response', status: 'completed', usage: { input_tokens: 1, output_tokens: 1 } } }
    ]
    for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test server did not bind')
  const root = await home('rei-selection-ui-')
  await writeFile(join(root, '.bingo/settings.json'), JSON.stringify({ provider: 'road-anti', model, thinking: 'low', openai: { instances: { [provider]: { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'synthetic-only' } } }, models: { [`${provider}/${model}`]: { reasoning: true } } }))
  const { app, page } = await launch(root)
  try {
    const initial = await page.evaluate(() => window.bingoDesktop.bootstrap())
    expect(initial.ok).toBe(true)
    if (!initial.ok) throw new Error(initial.error.message)
    expect(initial.value.preferences.workspace).toBeNull()
    const selection = initial.value.selection
    expect(selection?.hostId).toBeTruthy()
    expect(selection?.connectionId).toBeTruthy()
    const selected = initial.value.connections.find(connection => connection.hostId === selection?.hostId && connection.connectionId === selection?.connectionId)
    expect(selected?.status).toBe('ready')
    expect(selected?.workspace).toBe(initial.value.scratchWorkspace)
    await expect(page.getByRole('button', { name: 'Personal space', exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: 'Message bingo' }).fill('Keep this exact draft while I choose a model.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('road-anti')
    await page.getByRole('button', { name: 'Model', exact: true }).click()
    await page.getByRole('combobox', { name: 'Search models' }).fill(provider)
    await expect(page.locator('[cmdk-group][data-value="anthropic"]')).toBeHidden()
    await expect(page.getByRole('option', { name: new RegExp(model) })).toBeVisible()
    await expect(page.locator('.model-picker-content')).toHaveCSS('opacity', '1')
    await page.screenshot({ path: info.outputPath('model-picker.png') })
    await page.getByRole('option', { name: new RegExp(model) }).click()
    await expect(page.getByRole('textbox', { name: 'Message bingo' })).toHaveValue('Keep this exact draft while I choose a model.')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Thinking effort' }).click()
    await page.getByRole('option', { name: /^Extra high/ }).click()
    await expect(page.getByRole('combobox', { name: 'Thinking effort' })).toHaveText('Extra high')
    await page.screenshot({ path: info.outputPath('refined-home.png') })
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByText('The selected model and effort reached the provider.')).toBeVisible()
    expect(calls.at(-1)?.model).toBe(model)
    expect((calls.at(-1)?.reasoning as { effort?: string })?.effort).toBe('xhigh')
    await expect(page.getByRole('button', { name: 'Model', exact: true })).toHaveAttribute('title', `${provider}/${model}`)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('combobox', { name: 'Language' }).click()
    await page.getByRole('option', { name: '简体中文', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('settings-zh.png') })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: '新建对话', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '向 bingo 发送消息' })).toBeVisible()
    await expect(page.locator('.empty-conversation .composer')).toBeVisible()
    await page.screenshot({ path: info.outputPath('refined-home-zh.png') })
    expect((await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
    console.info('Refined visual evidence:', info.outputDir)
  } finally { await app.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
})

test('real terminal tabs remain interactive in the hidden desktop without OS focus', async ({}, info) => {
  const root = await home('rei-hidden-terminal-')
  await writeFile(join(root, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1' }))
  const { app, page } = await launch(root)
  try {
    const terminal = await exerciseTerminalTabs(page)
    await page.screenshot({ animations: 'disabled', path: info.outputPath('hidden-real-terminal-tabs.png') })
    await page.locator('.terminal-tab-item').filter({ has: page.locator(`#terminal-tab-${terminal}`) }).getByRole('button', { name: /^Close terminal / }).click()
    await expect.poll(() => terminals(page)).toEqual([])
  } finally { await app.close() }
})

test('real native right browser and terminal tabs, including shell exits, agent ShowPage and privileged overlays', async ({}, info) => {
  test.skip(!foregroundEnabled, 'Native WebContentsView sendInputEvent requires focused OS input. Requires explicit REI_E2E_FOREGROUND=1 and user approval; DOM clicks are not a substitute.')
  const root = await home('rei-tools-ui-')
  await writeFile(join(root, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1', permissions: { defaultMode: 'bypassPermissions' } }))
  const script = join(root, 'responses.json')
  await writeFile(script, JSON.stringify({ responses: [
    { steps: [{ toolCall: { name: 'ShowPage', input: { title: 'Choose a direction', html: '<!doctype html><html><head><title>Choose a direction</title></head><body style="font:16px system-ui;padding:32px"><h1>A quieter workspace</h1><p>This page is served by the agent inside Rei.</p><button id="choose" onclick="window.bingo.submit({direction: \'quiet\'})">Choose this direction</button></body></html>' } } }] },
    { steps: [{ text: 'The browser choice reached the agent.' }] }
  ] }))
  const { app, page } = await launch(root, { BINGO_FAKE_SCRIPT: script })
  try {
    const terminal = await exerciseTerminalTabs(page)
    await page.getByRole('textbox', { name: 'Message bingo' }).fill('Open a page so I can choose a direction.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Browser', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('textbox', { name: 'Website address' })).toHaveValue(/http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}/)
    await expect.poll(() => browserVisible(app)).toBe(true)
    await expect.poll(async () => { const state = await page.evaluate(() => window.bingoPanels.snapshot()); return state.ok ? state.value.browser.title : '' }).toBe('Choose a direction')
    const browserSafety = await app.evaluate(async ({ webContents, BrowserWindow }) => {
      const primary = BrowserWindow.getAllWindows()[0].webContents
      const browser = webContents.getAllWebContents().find((contents) => contents.id !== primary.id && contents.getURL().startsWith('http://127.0.0.1:'))
      if (!browser) throw new Error('Embedded page missing')
      return browser.executeJavaScript('({title: document.title, bridge: typeof window.bingoDesktop, panels: typeof window.bingoPanels, node: typeof require})')
    })
    expect(browserSafety).toEqual({ title: 'Choose a direction', bridge: 'undefined', panels: 'undefined', node: 'undefined' })
    await page.getByRole('button', { name: 'Environment', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Environment', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(() => browserVisible(app)).toBe(false)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Environment', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => browserVisible(app)).toBe(true)
    if (await page.getByRole('button', { name: 'Show sidebar', exact: true }).isVisible()) await page.getByRole('button', { name: 'Show sidebar', exact: true }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect.poll(() => browserVisible(app)).toBe(false)
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => browserVisible(app)).toBe(true)
    await page.getByRole('combobox', { name: 'Thinking effort' }).click()
    await expect.poll(() => browserVisible(app)).toBe(false)
    await page.keyboard.press('Escape')
    await expect.poll(() => browserVisible(app)).toBe(true)
    const layers = await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const view = window.contentView.children.find((child) => 'webContents' in child && (child as any).webContents.id !== window.webContents.id) as any
      return { chrome: (await window.webContents.capturePage()).toPNG().toString('base64'), browser: (await view.webContents.capturePage()).toPNG().toString('base64'), bounds: view.getBounds(), width: window.getContentBounds().width }
    })
    await writeFile(info.outputPath('native-browser.png'), Buffer.from(layers.browser, 'base64'))
    await writeFile(info.outputPath('workbench-chrome.png'), Buffer.from(layers.chrome, 'base64'))
    await writeFile(info.outputPath('native-layer-bounds.json'), JSON.stringify({ bounds: layers.bounds, width: layers.width }))
    // Electron's page capture omits WebContentsView layers. Optional OS capture includes them.
    if (process.platform === 'darwin' && process.env.REI_NATIVE_CAPTURE === '1') {
      const source = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMediaSourceId())
      const id = /^window:(\d+):/.exec(source)?.[1]
      if (!id) throw new Error('Native window capture ID unavailable')
      execFileSync('/usr/sbin/screencapture', ['-x', '-l', id, info.outputPath('native-workbench.png')], { timeout: 10000 })
    }
    await app.evaluate(async ({ webContents, BrowserWindow }) => {
      const primary = BrowserWindow.getAllWindows()[0].webContents
      const browser = webContents.getAllWebContents().find((contents) => contents.id !== primary.id && contents.getURL().startsWith('http://127.0.0.1:'))!
      const point = await browser.executeJavaScript('(() => { const r=document.querySelector("#choose").getBoundingClientRect(); return {x: Math.round(r.x+r.width/2),y: Math.round(r.y+r.height/2)} })()')
      browser.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
      browser.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    })
    await expect(page.getByText('The browser choice reached the agent.')).toBeVisible()
    const screenshot = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'))
    await writeFile(info.outputPath('browser-terminal-dark.png'), Buffer.from(screenshot, 'base64'))
    await page.locator('.terminal-tab-item').filter({ has: page.locator(`#terminal-tab-${terminal}`) }).getByRole('button', { name: /^Close terminal / }).click()
    await expect.poll(() => terminals(page)).toEqual([])
    await expect(page.locator('.terminal-panel')).toBeHidden()
    await expect.poll(() => browserVisible(app)).toBe(true)
    console.info('Native panel visual evidence:', info.outputDir)
  } finally {
    await page.evaluate(async () => {
      const state = await window.bingoPanels.snapshot()
      if (state.ok) await Promise.allSettled(state.value.terminals.flatMap((terminal) => terminal.id ? [window.bingoPanels.terminalStop(terminal.id)] : []))
    }).catch(() => {})
    // Cancel an unfinished fake turn on failure, so cleanup never waits on a permission sheet.
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) }).catch(() => {})
    await app.close()
  }
})
