import { expect, test } from '@playwright/test'
import { spawn, execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron, assertBackground, foregroundEnabled } from './helpers/electron'
import type { DesktopEvent } from '../src/shared/desktop'

// Real bingo actor/stdio/tool/permission path with a fake local model.
// No external model provider, user's profile, account, or clipboard is used.
const binary = process.env.BINGO_E2E_BINARY || resolve('../bingo-improve/target/debug', process.platform === 'win32' ? 'bingo.exe' : 'bingo')

// Seed a genuine journal through Core's fake provider, not a handcrafted
// session file. Only small RPC replies and reference metadata are retained.
async function seedOversizedJournal(home: string, cwd: string, script: string) {
  const child = spawn(binary, ['serve', '--stdio'], { cwd, env: { PATH: process.env.PATH, HOME: home, BINGO_BROWSER_MODE: 'client', BINGO_FAKE_SCRIPT: script }, stdio: ['pipe', 'pipe', 'pipe'] })
  const started = performance.now(), pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  let nextId = 0, bytes = Buffer.alloc(0), maxLineBytes = 0, peakRssBytes = 0, stderr = '', completion: any, reference: any
  let completeTurn!: (value: any) => void, failTurn!: (error: Error) => void
  const turnDone = new Promise<any>((resolve, reject) => { completeTurn = resolve; failTurn = reject })
  void turnDone.catch(() => {})
  // Sampling observes the running child; it is not a sleep or a wait for readiness.
  const sample = setInterval(() => execFile('ps', ['-o', 'rss=', '-p', String(child.pid)], { timeout: 1000 }, (error, output) => {
    if (!error) peakRssBytes = Math.max(peakRssBytes, Number(output.trim()) * 1024 || 0)
  }), 1000)
  sample.unref()
  const closed = new Promise<number | null>(resolve => child.once('close', code => resolve(code)))
  const deadline = setTimeout(() => { const error = new Error('Isolated Core seed exceeded 120s'); for (const waiter of pending.values()) waiter.reject(error); failTurn(error); child.kill() }, 120000)
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4096) })
  child.stdout.on('data', chunk => {
    bytes = Buffer.concat([bytes, chunk])
    for (let end; (end = bytes.indexOf(10)) >= 0;) {
      const line = bytes.subarray(0, end); bytes = bytes.subarray(end + 1)
      maxLineBytes = Math.max(maxLineBytes, line.length)
      if (line.length > 16 * 1024 * 1024) { child.kill(); failTurn(new Error(`Core sent an oversized ${line.length}-byte line`)); return }
      if (!line.includes('"method":"eventRef"') && !line.includes('"turnCompleted"') && line.includes('"method":')) continue
      try {
        const message = JSON.parse(line.toString('utf8'))
        if (message.id !== undefined) {
          const waiter = pending.get(message.id); pending.delete(message.id)
          if (message.error) waiter?.reject(new Error(JSON.stringify(message.error)))
          else waiter?.resolve(message.result)
        } else if (message.method === 'eventRef' && message.params.eventType === 'itemCompleted') reference = message.params
        else if (message.method === 'event' && message.params.event?.type === 'turnCompleted') { completion = message.params; completeTurn(completion) }
      } catch (error) { child.kill(); failTurn(error as Error) }
    }
    if (bytes.length > 16 * 1024 * 1024) { child.kill(); failTurn(new Error('Core left an oversized incomplete line')) }
  })
  child.on('error', error => { for (const waiter of pending.values()) waiter.reject(error); failTurn(error) })
  child.on('close', () => { for (const waiter of pending.values()) waiter.reject(new Error(`Core exited before replying: ${stderr}`)); if (!completion) failTurn(new Error(`Core exited before the fake turn completed: ${stderr}`)) })
  const request = (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  try {
    await request('initialize', { protocol: 1, client: { name: 'Rei real-core seed', surface: 'desktop' } })
    const opened = await request('session/open', { selector: { kind: 'create', spec: { cwd, title: 'Real Big Saved', driver: 'model', provider: 'fake', model: 'fake-1' } }, options: { children: true, maxSnapshotBytes: 4 * 1024 * 1024, treeBackfill: 'liveOnly' } })
    expect(opened.snapshot.summary.cwd).toBe(cwd)
    await request('session/submit', { session: opened.session, intent: randomUUID(), input: { kind: 'text', text: 'MASSIVE_SEED', origin: { surface: 'desktop' } } })
    await turnDone
    expect(completion.event.status.kind).toBe('completed')
    expect(reference).toMatchObject({ session: opened.session, eventType: 'itemCompleted', availability: { kind: 'available' } })
    expect(reference.item).toMatch(/^itm_/)
    expect(reference.totalBytes).toBeGreaterThan(17 * 1024 * 1024)
    expect(maxLineBytes).toBeLessThan(16 * 1024 * 1024)
    const elapsedMs = Math.round(performance.now() - started)
    await request('shutdown')
    expect(await closed).toBe(0)
    return { sessionId: opened.session as string, itemId: reference.item as string, elapsedMs, peakRssBytes, maxLineBytes, seq: completion.seq as number }
  } finally { clearTimeout(deadline); clearInterval(sample); if (child.exitCode === null && child.signalCode === null) { child.kill(); await closed } }
}

test('real core: A waits for permission while same-project B and cross-project Q finish, then A continues', async () => {
  if (foregroundEnabled) throw new Error('This acceptance test is authorized only with REI_E2E_FOREGROUND=0.')
  await access(binary)
  // Native path approval compares canonical workspace paths on macOS.
  const home = await realpath(await mkdtemp(join(tmpdir(), 'rei-multi-real-core-')))
  const p = join(home, 'core-P'), q = join(home, 'core-Q'), data = join(home, 'desktop')
  await Promise.all([mkdir(p), mkdir(q), mkdir(data), mkdir(join(home, '.bingo'))])
  await writeFile(join(home, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1', permissions: { defaultMode: 'default' } }))
  await writeFile(join(data, 'desktop-preferences.json'), JSON.stringify({ version: 1, preferences: { theme: 'light', workspace: p, binaryPath: binary, recentWorkspaces: [p, q] } }))
  const script = join(home, 'responses.json')
  const note = join(p, 'approved-by-A.txt')
  await writeFile(script, JSON.stringify({ responses: [
    { when: { contains: 'CORE_A' }, steps: [{ text: 'CORE_A_WAITING' }, { toolCall: { name: 'Write', input: { file_path: note, content: 'A continued only after its own permission.' } } }] },
    { when: { contains: 'CORE_B' }, steps: [{ text: 'CORE_B_COMPLETE' }] },
    { when: { contains: 'CORE_Q' }, steps: [{ text: 'CORE_Q_COMPLETE' }] },
    { steps: [{ text: 'CORE_A_CONTINUED' }] }
  ] }))
  const inherited = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve(process.env.BINGO_E2E_MAIN || 'out/main/index.js')], env: { ...inherited, HOME: home, USERPROFILE: home, BINGO_GUI_USER_DATA: data, BINGO_GUI_CWD: p, BINGO_GUI_BINARY: binary, BINGO_FAKE_SCRIPT: script } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByText('Connected locally')).toBeVisible()
    await page.evaluate(() => {
      const state = window as typeof window & { __coreConcurrency: DesktopEvent[] }
      state.__coreConcurrency = []
      window.bingoDesktop.onEvent(event => state.__coreConcurrency.push(event))
    })
    const send = async (text: string) => { await page.getByRole('textbox', { name: 'Message bingo' }).fill(text); await page.getByRole('button', { name: 'Send message', exact: true }).click() }
    await send('CORE_A')
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible()
    const source = await page.evaluate(() => {
      const events = (window as typeof window & { __coreConcurrency: DesktopEvent[] }).__coreConcurrency
      const opened = events.find(event => event.type === 'rpc' && event.method === 'event' && event.params.event.type === 'interactionOpened')
      if (!opened || opened.type !== 'rpc' || opened.method !== 'event') throw new Error('A did not open its actual core permission')
      return { session: opened.params.session, connection: opened.connectionId }
    })
    await page.getByRole('button', { name: 'New thread', exact: true }).click()
    await expect(page.locator('h1')).toHaveText('New thread')
    await expect(page.getByRole('textbox', { name: 'Message bingo' })).toBeEditable()
    await send('CORE_B')
    await expect(page.getByText('CORE_B_COMPLETE', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop generation' })).toHaveCount(0)
    await page.locator('.project-heading').filter({ hasText: /^core-Q$/ }).click()
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.bingoDesktop.bootstrap()
      if (!result.ok) throw new Error(result.error.message)
      return result.value.connections.find(connection => connection.hostId === result.value.selection?.hostId)?.workspace
    })).toBe(q)
    await expect(page.getByRole('button', { name: 'core-Q', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Message bingo' })).toBeEditable()
    await send('CORE_Q')
    await expect(page.getByText('CORE_Q_COMPLETE', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop generation' })).toHaveCount(0)
    const before = await page.evaluate(() => (window as typeof window & { __coreConcurrency: DesktopEvent[] }).__coreConcurrency)
    const frames = before.flatMap(event => event.type === 'rpc' && event.method === 'event' ? [{ connection: event.connectionId, ...event.params }] : [])
    expect(frames.filter(frame => frame.event.type === 'turnStarted')).toHaveLength(3)
    expect(frames.filter(frame => frame.session === source.session && frame.event.type === 'turnCompleted')).toEqual([])
    const others = frames.filter(frame => frame.session !== source.session && frame.event.type === 'turnCompleted')
    expect(others).toHaveLength(2)
    expect(new Set(others.map(frame => frame.connection)).size).toBe(2)
    expect(others.some(frame => frame.connection === source.connection)).toBe(true)
    await page.locator('.project-heading').filter({ hasText: /^core-P$/ }).click()
    await page.locator('.session-row-title').filter({ hasText: /^CORE_A$/ }).click()
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect(page.getByText('CORE_A_CONTINUED', { exact: true })).toBeVisible()
    expect(await readFile(note, 'utf8')).toBe('A continued only after its own permission.')
    const after = await page.evaluate(() => (window as typeof window & { __coreConcurrency: DesktopEvent[] }).__coreConcurrency)
    const aCompletion = after.findIndex(event => event.type === 'rpc' && event.method === 'event' && event.params.session === source.session && event.params.event.type === 'turnCompleted')
    const otherCompletionIndices = after.flatMap((event, index) => event.type === 'rpc' && event.method === 'event' && event.params.session !== source.session && event.params.event.type === 'turnCompleted' ? [index] : [])
    expect(aCompletion).toBeGreaterThan(Math.max(...otherCompletionIndices))
    await assertBackground(app)
  } finally { await app.close() }
})

test('real core heavy: a persisted 17MiB fake-provider item first reopens in Rei as incomplete bounded history', async () => {
  test.skip(process.env.REI_E2E_HEAVY !== '1', 'Explicit heavy opt-in only; never add a 17MiB fake turn to parallel default E2E.')
  test.setTimeout(180000)
  if (foregroundEnabled) throw new Error('This acceptance test is authorized only with REI_E2E_FOREGROUND=0.')
  if (!process.env.BINGO_E2E_BINARY) throw new Error('Set BINGO_E2E_BINARY to the isolated, pinned Core build; never default to the user binary for the heavy gate.')
  await access(binary)
  const home = await realpath(await mkdtemp(join(tmpdir(), 'rei-real-big-saved-')))
  const p = join(home, 'P'), data = join(home, 'desktop'), script = join(home, 'responses.json')
  await Promise.all([mkdir(p), mkdir(data), mkdir(join(home, '.bingo'))])
  await writeFile(join(home, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1', permissions: { defaultMode: 'default' } }))
  await writeFile(join(data, 'desktop-preferences.json'), JSON.stringify({ version: 1, preferences: { theme: 'light', workspace: p, binaryPath: binary, recentWorkspaces: [p] } }))
  // Fake matches against the full conversation and resets its deck on restart:
  // AFTER_REOPEN must come first so the old MASSIVE_SEED turn cannot claim it again.
  await writeFile(script, JSON.stringify({ responses: [
    { when: { contains: 'AFTER_REOPEN' }, steps: [{ text: 'SMALL_AFTER_REOPEN' }] },
    { when: { contains: 'MASSIVE_SEED' }, steps: [{ text: 'Z'.repeat(17 * 1024 * 1024) }] }
  ] }))
  const seeded = await seedOversizedJournal(home, p, script)
  console.info(`isolated heavy seed: ${seeded.elapsedMs}ms, peak Core RSS ${seeded.peakRssBytes} bytes, largest NDJSON line ${seeded.maxLineBytes} bytes, final seq ${seeded.seq}`)
  const inherited = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]!] ] : []))
  const app = await electron.launch({ args: [resolve(process.env.BINGO_E2E_MAIN || 'out/main/index.js')], env: { ...inherited, HOME: home, USERPROFILE: home, BINGO_GUI_USER_DATA: data, BINGO_GUI_CWD: p, BINGO_GUI_BINARY: binary, BINGO_FAKE_SCRIPT: script } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await page.locator('.session-row-title').filter({ hasText: /^Real Big Saved$/ }).click()
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.bingoDesktop.bootstrap()
      if (!result.ok) throw new Error(result.error.message)
      return result.value.selection?.sessionId
    }), { timeout: 30000 }).toBe(seeded.sessionId)
    await expect(page.getByRole('textbox', { name: 'Message bingo' })).toBeEditable()
    await page.getByRole('button', { name: 'Load earlier messages' }).click()
    const missing = page.locator(`.unloaded-history-item[data-item-id="${seeded.itemId}"]`)
    await expect(missing).toBeVisible()
    const label = await missing.textContent()
    const size = Number(label?.match(/\((\d+) bytes\)/)?.[1])
    expect(size).toBeGreaterThan(17 * 1024 * 1024)
    expect(label).toContain('is not loaded')
    expect(await page.evaluate(() => document.body.innerText.length)).toBeLessThan(1024 * 1024)
    await page.evaluate((session) => {
      const state = window as typeof window & { __smallCompletion: number; __afterReopenEvents: { method: string; type?: string; bytes?: number; seq?: number }[] }
      state.__smallCompletion = 0; state.__afterReopenEvents = []
      window.bingoDesktop.onEvent(event => {
        if (event.type !== 'rpc') return
        const rpc = event as { method: string; params: { session?: string; seq?: number; totalBytes?: number; eventType?: string; event?: { type?: string } } }
        if (rpc.params.session !== session) return
        if (rpc.method === 'eventRef' || rpc.params.event?.type === 'turnCompleted' || rpc.params.event?.type === 'itemCompleted') state.__afterReopenEvents.push({ method: rpc.method, type: rpc.params.eventType ?? rpc.params.event?.type, bytes: rpc.params.totalBytes, seq: rpc.params.seq })
        if (rpc.method === 'event' && rpc.params.event?.type === 'turnCompleted') state.__smallCompletion++
      })
    }, seeded.sessionId)
    await page.getByRole('textbox', { name: 'Message bingo' }).fill('AFTER_REOPEN')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __smallCompletion: number }).__smallCompletion), { timeout: 30000 }).toBeGreaterThan(0)
    const afterEvents = await page.evaluate(() => (window as typeof window & { __afterReopenEvents: { method: string; type?: string; bytes?: number; seq?: number }[] }).__afterReopenEvents)
    console.info(`isolated follow-up RPC: ${JSON.stringify(afterEvents)}`)
    expect(afterEvents.filter(event => event.method === 'eventRef')).toEqual([])
    await expect(page.getByText('SMALL_AFTER_REOPEN', { exact: true })).toBeVisible()
    await assertBackground(app)
  } finally { await app.close() }
})
