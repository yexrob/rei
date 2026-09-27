import { expect, test } from '@playwright/test'
import { multisessionFixture, selectSession, selectProject, sendMessage, browserState, observeDesktopEvents } from './helpers/multisession'

// Native Electron + real IPC + deterministic protocol-1 stdio DOUBLE.
// Core actor/provider concurrency is separately tested by multisession-core.e2e.ts.
test.beforeEach(() => { test.skip(process.platform === 'win32', 'This offline stdio fixture requires a POSIX Node executable wrapper.') })

test('same-host A pending acknowledgment never locks B or a new draft, and late rejection stays with A', async () => {
  const f = await multisessionFixture()
  try {
    await selectSession(f.page, 'P A')
    await sendMessage(f.page, 'reject-later')
    await expect.poll(async () => (await f.state('P')).deferred).toEqual(['P-a'])
    await selectSession(f.page, 'P B')
    const input = f.page.getByRole('textbox', { name: 'Message bingo' })
    await expect(input).toBeEditable()
    await input.fill('B independent draft')
    await f.page.getByRole('button', { name: 'New thread', exact: true }).click()
    await expect(f.page.locator('h1')).toHaveText('New thread')
    await expect(input).toBeEditable()
    await expect(input).toHaveValue('')
    await input.fill('New thread independent draft')
    await selectSession(f.page, 'P B')
    await expect(input).toHaveValue('B independent draft')
    await sendMessage(f.page, 'B work before A ack')
    await expect.poll(async () => (await f.state('P')).sessions.find(s => s.summary.id === 'P-b')?.turn?.id).toBeTruthy()
    await input.fill('Keep B unsent')
    await f.command('P', { op: 'rejectAck', session: 'P-a' })
    await expect(input).toHaveValue('Keep B unsent')
    await expect(f.page.locator('h1')).toHaveText('P B')
    await expect(f.page.getByText('P/P-a: rejected delayed input', { exact: true })).toHaveCount(0)
    await selectSession(f.page, 'P A')
    await expect(input).toHaveValue('reject-later')
    await expect(f.page.getByText('P/P-a: rejected delayed input', { exact: true })).toBeVisible()
    const audit = await f.audit('P')
    expect(audit.filter(row => row.kind === 'request' && row.method === 'session/submit').map(row => row.params?.session)).toEqual(['P-a', 'P-b'])
    expect(audit.filter(row => row.kind === 'shutdown')).toEqual([])
  } finally { await f.close() }
})

test('first connection discovers a 17MiB-title root through bounded heads without requesting a huge legacy list', async () => {
  const f = await multisessionFixture({ startupOversizedTitle: true })
  try {
    const reads = ['session/list', 'session/listHeads']
    await expect.poll(async () => (await f.audit('P')).filter(row => row.kind === 'request' && reads.includes(row.method ?? '')).length, { timeout: 8000 }).toBeGreaterThan(0)
    const audit = await f.audit('P')
    const first = audit.find(row => row.kind === 'request' && reads.includes(row.method ?? ''))
    expect(first?.method, 'the initial renderer list must not exceed the 16MiB protocol line').toBe('session/listHeads')
    await expect(f.page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(f.page.locator('.session-row-title').filter({ hasText: /^P B$/ })).toBeVisible()
    expect((await f.audit('P')).filter(row => row.kind === 'request' && row.method === 'session/list')).toEqual([])
  } finally { await f.close() }
})

test('bounded owner preflight opens a 17MiB-title session without asking legacy session/list for the huge line', async () => {
  const f = await multisessionFixture()
  try {
    const before = await f.audit('P')
    await f.command('P', { op: 'oversizeSummary', session: 'P-a', field: 'title' })
    // The already-visible row names a known id; Native must still verify this
    // host's real cwd through bounded heads before it can attach the port.
    await f.page.locator('.session-row-title').filter({ hasText: /^P A$/ }).click()
    const readMethods = ['session/list', 'session/listHeads']
    await expect.poll(async () => (await f.audit('P')).slice(before.length).filter(row => row.kind === 'request' && readMethods.includes(row.method ?? '')).length, { timeout: 5000 }).toBeGreaterThan(0)
    const firstRead = (await f.audit('P')).slice(before.length).find(row => row.kind === 'request' && readMethods.includes(row.method ?? ''))
    expect(firstRead?.method, 'Native must verify the real cwd without requesting a huge legacy list').toBe('session/listHeads')
    await expect.poll(async () => (await f.audit('P')).filter(row => row.kind === 'request' && row.method === 'session/open' && row.params?.selector?.kind === 'byId' && row.params?.selector?.id === 'P-a').length, { timeout: 8000 }).toBe(1)
    const requests = (await f.audit('P')).slice(before.length)
    const heads = requests.filter(row => row.kind === 'request' && row.method === 'session/listHeads')
    expect(heads.length).toBeGreaterThan(0)
    expect(heads[0].params?.filter).toMatchObject({ cwd: f.projects.P })
    expect(requests.filter(row => row.kind === 'request' && row.method === 'session/list')).toEqual([])
    const opened = requests.findIndex(row => row.kind === 'request' && row.method === 'session/open' && row.params?.selector?.id === 'P-a')
    expect(requests.findIndex(row => row.kind === 'request' && row.method === 'session/listHeads')).toBeLessThan(opened)
    await expect.poll(async () => f.page.evaluate(async () => { const result = await window.bingoDesktop.bootstrap(); if (!result.ok) throw new Error(result.error.message); return result.value.selection?.sessionId }), { timeout: 8000 }).toBe('P-a')
    await expect(f.page.getByRole('textbox', { name: 'Message bingo' })).toBeEditable()
  } finally { await f.close() }
})

test('17MiB historical item opens as an explicit incomplete bounded shell, never as a legacy giant reply', async () => {
  const f = await multisessionFixture()
  try {
    await f.command('P', { op: 'oversizeHistory', session: 'P-a' })
    await f.page.locator('.session-row-title').filter({ hasText: /^P A$/ }).click()
    await expect.poll(async () => (await f.audit('P')).filter(row => row.kind === 'request' && row.method === 'session/open' && row.params?.selector?.id === 'P-a').length).toBe(1)
    const opened = (await f.audit('P')).find(row => row.kind === 'request' && row.method === 'session/open' && row.params?.selector?.id === 'P-a')
    expect(opened?.params?.options?.maxSnapshotBytes, 'a complete 17MiB snapshot cannot fit one protocol line').toBe(4 * 1024 * 1024)
    await expect(f.page.getByRole('textbox', { name: 'Message bingo' })).toBeEditable()
    expect(await f.page.evaluate(() => document.body.innerText.length)).toBeLessThan(1024 * 1024)
    const selection = await f.page.evaluate(async () => { const result = await window.bingoDesktop.bootstrap(); if (!result.ok) throw new Error(result.error.message); return result.value.selection })
    expect(selection?.sessionId).toBe('P-a')
  } finally { await f.close() }
})

test('17MiB live item reference does not block a subsequent small completion frame or ship the body to the page', async () => {
  const f = await multisessionFixture()
  try {
    await selectSession(f.page, 'P A')
    const open = (await f.audit('P')).find(row => row.kind === 'request' && row.method === 'session/open' && row.params?.selector?.id === 'P-a')
    expect(open?.params?.options?.maxSnapshotBytes).toBe(4 * 1024 * 1024)
    await f.page.evaluate(() => {
      const state = window as typeof window & { __boundedFrames: { method: string; seq: number; eventType?: string }[] }
      state.__boundedFrames = []
      window.bingoDesktop.onEvent(event => {
        const rpc = event as { type: string; method?: string; params?: { seq?: number; eventType?: string; event?: { type?: string } } }
        if (rpc.type === 'rpc' && (rpc.method === 'eventRef' || rpc.params?.event?.type === 'turnCompleted')) state.__boundedFrames.push({ method: rpc.method ?? '', seq: rpc.params?.seq ?? -1, eventType: rpc.params?.eventType ?? rpc.params?.event?.type })
      })
    })
    await f.command('P', { op: 'oversizeEvent', session: 'P-a' })
    await expect.poll(async () => f.page.evaluate(() => (window as typeof window & { __boundedFrames: { method: string }[] }).__boundedFrames.map(frame => frame.method))).toEqual(['eventRef', 'event'])
    const seen = await f.page.evaluate(() => (window as typeof window & { __boundedFrames: { method: string; seq: number; eventType?: string }[] }).__boundedFrames)
    expect(seen[0]).toMatchObject({ method: 'eventRef', eventType: 'itemCompleted' })
    expect(seen[1]).toMatchObject({ method: 'event', eventType: 'turnCompleted', seq: seen[0].seq + 1 })
    expect(await f.page.evaluate(() => document.body.innerText.length)).toBeLessThan(1024 * 1024)
    await expect(f.page.getByRole('textbox', { name: 'Message bingo' })).toBeEditable()
  } finally { await f.close() }
})

test('a root with a thousand old child IDs discovers them without directly opening every child', async () => {
  const f = await multisessionFixture()
  try {
    await f.command('P', { op: 'seedTree', session: 'P-a', count: 1000 })
    await selectSession(f.page, 'P A')
    await expect.poll(async () => (await f.audit('P')).filter(row => row.kind === 'request' && row.method === 'session/children' && row.params?.parent === 'P-a').length, { timeout: 8000 }).toBeGreaterThan(0)
    await expect.poll(async () => (await f.audit('P')).filter(row => row.kind === 'childrenPage' && row.parent === 'P-a').reduce((total, row) => total + Number(row.count), 0), { timeout: 12000 }).toBe(1000)
    const audit = await f.audit('P')
    expect(audit.filter(row => row.kind === 'request' && row.method === 'session/open' && String(row.params?.selector?.id).startsWith('P-child-'))).toEqual([])
    expect(audit.filter(row => row.kind === 'request' && row.method === 'session/children' && row.params?.parent === 'P-child-0000')).toEqual([])
    expect(audit.filter(row => row.kind === 'request' && row.method === 'session/open' && row.params?.selector?.id === 'P-a')).toHaveLength(1)
    await expect(f.page.locator('.unloaded-content')).toContainText('Older child sessions have not been loaded.')
    await f.page.locator('details.unloaded-children > summary').click()
    await f.page.getByRole('button', { name: 'Open discovered child P-child-0000' }).click()
    await expect.poll(async () => (await f.audit('P')).filter(row => row.kind === 'request' && row.method === 'session/open' && row.params?.selector?.id === 'P-child-0000').length).toBe(1)
    const childOpen = (await f.audit('P')).find(row => row.kind === 'request' && row.method === 'session/open' && row.params?.selector?.id === 'P-child-0000')
    expect(childOpen?.params?.options?.children).toBe(false)
    await expect.poll(async () => (await f.audit('P')).filter(row => row.kind === 'request' && row.method === 'session/children' && row.params?.parent === 'P-child-0000').length).toBeGreaterThan(0)
    const finalAudit = await f.audit('P')
    expect(finalAudit.filter(row => row.kind === 'request' && row.method === 'session/open' && row.params?.selector?.id === 'P-grandchild-0000')).toEqual([])
    expect(finalAudit.filter(row => row.kind === 'childrenPage' && row.parent === 'P-child-0000').reduce((total, row) => total + Number(row.count), 0)).toBe(1)
  } finally { await f.close() }
})

test('warm same-host A→B→A selects without reopening history, but tree replay child requires a direct port', async () => {
  const f = await multisessionFixture()
  const opened = async () => (await f.audit('P')).filter(row => row.kind === 'request' && row.method === 'session/open' && row.params?.selector?.kind === 'byId')
  try {
    await selectSession(f.page, 'P A'); await sendMessage(f.page, 'A_FIRST_HISTORY')
    await expect(f.page.getByText('A_FIRST_HISTORY', { exact: true })).toBeVisible()
    await selectSession(f.page, 'P B'); await sendMessage(f.page, 'B_HISTORY')
    await expect(f.page.getByText('B_HISTORY', { exact: true })).toBeVisible()
    await expect.poll(async () => (await opened()).map(row => row.params?.selector?.id)).toEqual(['P-a', 'P-b'])
    const before = await f.page.evaluate(async () => { const result = await window.bingoDesktop.bootstrap(); if (!result.ok) throw new Error(result.error.message); return result.value.selection })
    await f.page.getByRole('textbox', { name: 'Message bingo' }).fill('B draft survives A switch')
    await selectSession(f.page, 'P A')
    await expect(f.page.getByText('A_FIRST_HISTORY', { exact: true })).toBeVisible()
    await f.command('P', { op: 'append', session: 'P-a', text: '|A after warm switch|' })
    await expect(f.page.getByText(/A after warm switch/)).toBeVisible()
    const after = await f.page.evaluate(async () => { const result = await window.bingoDesktop.bootstrap(); if (!result.ok) throw new Error(result.error.message); return result.value.selection })
    expect(after?.connectionId).toBe(before?.connectionId)
    expect(after?.sessionId).toBe('P-a')
    expect((await opened()).map(row => row.params?.selector?.id)).toEqual(['P-a', 'P-b'])
    await selectSession(f.page, 'P B')
    await expect(f.page.getByRole('textbox', { name: 'Message bingo' })).toHaveValue('B draft survives A switch')
    await selectSession(f.page, 'P A')
    expect((await opened()).map(row => row.params?.selector?.id)).toEqual(['P-a', 'P-b'])

    await f.command('P', { op: 'treeChild', session: 'P-a' })
    await f.page.getByRole('button', { name: 'Environment', exact: true }).click()
    await f.page.getByRole('button', { name: 'Collaborators', exact: true }).hover()
    const child = f.page.getByRole('navigation', { name: 'Collaborators' }).getByRole('button', { name: /^P Child · Agent/ })
    await expect(child).toContainText('TREE_REPLAY_ONLY')
    expect((await opened()).map(row => row.params?.selector?.id)).toEqual(['P-a', 'P-b'])
    await child.click()
    await expect(f.page.locator('h1')).toHaveText('P Child')
    await expect.poll(async () => (await opened()).filter(row => row.params?.selector?.id === 'P-child').length).toBe(1)
    const childOpen = (await opened()).find(row => row.params?.selector?.id === 'P-child')
    expect(childOpen?.params?.options?.children).toBe(false)
    await f.page.getByRole('textbox', { name: 'Message P Child' }).fill('CHILD_DIRECT_SUBMIT')
    await f.page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(f.page.getByText('CHILD_DIRECT_SUBMIT', { exact: true })).toBeVisible()
    expect((await f.audit('P')).filter(row => row.kind === 'request' && row.method === 'session/submit').map(row => row.params?.session)).toEqual(['P-a', 'P-b', 'P-child'])
    expect((await opened()).map(row => row.params?.selector?.id)).toEqual(['P-a', 'P-b', 'P-child'])
  } finally { await f.close() }
})

test('project switch retains P work, permission and error source while Q submits and stops independently', async ({}, testInfo) => {
  const f = await multisessionFixture()
  try {
    await selectSession(f.page, 'P A'); await sendMessage(f.page, 'P work')
    await expect(f.page.getByRole('button', { name: 'Stop generation' })).toBeVisible()
    const p = await f.state('P')
    await selectProject(f.page, 'Q'); await selectSession(f.page, 'Q A'); await sendMessage(f.page, 'Q work')
    await expect(f.page.getByRole('button', { name: 'Stop generation' })).toBeVisible()
    const q = await f.state('Q')
    expect(q.pid).not.toBe(p.pid)
    expect((await f.state('P')).sessions.find(s => s.summary.id === 'P-a')?.turn).toBeDefined()
    await f.command('P', { op: 'permission', session: 'P-a' })
    await f.command('Q', { op: 'permission', session: 'Q-a' })
    // Both hosts deliberately use interaction ID a-permission and the same item/turn IDs.
    const permission = f.page.getByRole('region', { name: 'Permission required' })
    await expect(permission.getByText('Q/Q-a: approve fixture read', { exact: false })).toBeVisible()
    await expect(permission.getByText('P/P-a: approve fixture read', { exact: false })).toHaveCount(0)
    await f.page.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect.poll(async () => (await f.state('Q')).sessions.find(s => s.summary.id === 'Q-a')?.interactions?.length).toBe(0)
    expect((await f.state('P')).sessions.find(s => s.summary.id === 'P-a')?.interactions).toHaveLength(1)
    await expect(f.page.getByRole('button', { name: 'Stop generation' })).toBeVisible()
    const waitingRow = f.page.locator('.session-row').filter({ has: f.page.locator('.session-row-title').filter({ hasText: /^P A$/ }) })
    const waitingTitle = waitingRow.locator('.session-row-title')
    await expect.poll(() => waitingTitle.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(40)
    await expect(waitingTitle).toBeVisible()
    await expect(waitingRow.locator('.session-row-state')).toContainText('Needs attention')
    await expect(waitingRow.getByText('Unread', { exact: true })).toBeVisible()
    await expect(waitingRow.locator('time')).toBeVisible()
    await expect(waitingRow.locator('time')).not.toHaveText('')
    await testInfo.attach('two-projects-background-approval', { body: await f.page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    await f.command('P', { op: 'notice', session: 'P-a', text: 'P SOURCE ERROR' })
    await expect(f.page.getByText('P SOURCE ERROR', { exact: true })).toHaveCount(0)
    await f.page.getByRole('textbox', { name: 'Message bingo' }).fill('Q unsent across projects')
    await f.page.getByRole('button', { name: 'Stop generation' }).click()
    await expect.poll(async () => (await f.state('Q')).sessions.find(s => s.summary.id === 'Q-a')?.lastTurn?.status.kind).toBe('interrupted')
    expect((await f.state('P')).sessions.find(s => s.summary.id === 'P-a')?.turn).toBeDefined()
    await expect(f.page.locator('h1')).toHaveText('Q A')
    await expect(f.page.getByRole('textbox', { name: 'Message bingo' })).toHaveValue('Q unsent across projects')
    await selectProject(f.page, 'P'); await selectSession(f.page, 'P A')
    await expect(f.page.getByText('P SOURCE ERROR', { exact: true })).toBeVisible()
    await expect(f.page.getByRole('region', { name: 'Permission required' }).getByText('P/P-a: approve fixture read', { exact: false })).toBeVisible()
    await f.page.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect.poll(async () => (await f.state('P')).sessions.find(s => s.summary.id === 'P-a')?.interactions?.length).toBe(0)
    await selectProject(f.page, 'Q'); await selectSession(f.page, 'Q A')
    await expect(f.page.getByRole('textbox', { name: 'Message bingo' })).toHaveValue('Q unsent across projects')
    expect((await f.audit('P')).filter(row => row.kind === 'request' && row.method === 'session/interrupt')).toEqual([])
    expect((await f.audit('Q')).filter(row => row.kind === 'request' && row.method === 'session/answer').map(row => row.params?.session)).toEqual(['Q-a'])
    expect((await f.audit('P')).filter(row => row.kind === 'shutdown')).toEqual([])
  } finally { await f.close() }
})

test('late project initialization never hijacks a newer foreground selection', async () => {
  const f = await multisessionFixture({ heldProject: 'Q' })
  try {
    await selectSession(f.page, 'P A')
    await f.page.locator('.project-heading').filter({ hasText: /^Q$/ }).click()
    await expect.poll(async () => (await f.audit('Q')).filter(row => row.method === 'initialize').length).toBe(1)
    const r = f.page.locator('.project-heading').filter({ hasText: /^R$/ })
    await expect(r).toBeEnabled()
    await r.click()
    await selectSession(f.page, 'R A')
    await f.page.getByRole('textbox', { name: 'Message bingo' }).fill('R wins selection')
    await f.command('Q', { op: 'releaseInitialize' })
    await expect.poll(async () => (await f.audit('Q')).filter(row => row.kind === 'initialized').length).toBe(1)
    await expect(f.page.locator('h1')).toHaveText('R A')
    await expect(f.page.getByRole('textbox', { name: 'Message bingo' })).toHaveValue('R wins selection')
    const selected = await f.page.evaluate(async () => { const result = await window.bingoDesktop.bootstrap(); if (!result.ok) throw new Error(result.error.message); return (result.value as any).selection })
    expect(selected.sessionId).toBe('R-a')
    expect((await f.audit('P')).filter(row => row.kind === 'shutdown')).toEqual([])
  } finally { await f.close() }
})

test('background ShowPage cannot navigate the foreground browser and completed source identities are rejected', async () => {
  const f = await multisessionFixture()
  try {
    // Reproduce the CI work-area width that collapses navigation when Browser opens.
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700))
    await expect.poll(() => f.page.evaluate(() => innerWidth)).toBe(1000)
    await observeDesktopEvents(f.page)
    await selectSession(f.page, 'P A'); await sendMessage(f.page, 'P page work')
    await selectProject(f.page, 'Q'); await selectSession(f.page, 'Q A'); await sendMessage(f.page, 'Q browser work')
    await f.command('Q', { op: 'showPage', session: 'Q-a' })
    await expect.poll(async () => (await browserState(f.page)).url).toBe(`${(await f.endpoint('Q')).endpoint}/${'s'.repeat(43)}`)
    await expect(f.page.getByRole('region', { name: 'Browser', exact: true })).toBeVisible()
    await expect(f.page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeVisible()
    const before = await browserState(f.page)
    await f.command('P', { op: 'showPage', session: 'P-a' })
    await expect.poll(() => f.page.evaluate(() => (window as any).__multisessionEvents.filter((event: any) => event.type === 'agent-page' && event.page.sessionId === 'P-a' && event.page.status === 'available').length)).toBe(1)
    expect((await browserState(f.page)).url).toBe(before.url)
    expect((await f.audit('P')).filter(row => row.kind === 'pageVisited')).toEqual([])
    const source = await f.page.evaluate(() => (window as any).__multisessionEvents.find((event: any) => event.type === 'agent-page' && event.page.sessionId === 'P-a').page)
    await selectProject(f.page, 'P'); await selectSession(f.page, 'P A')
    await f.page.getByRole('button', { name: /^Open page from P/ }).click()
    await expect.poll(async () => (await browserState(f.page)).url).toBe(`${(await f.endpoint('P')).endpoint}/${'s'.repeat(43)}`)
    // Native navigation precedes the opened notification. Wait until React's
    // resulting responsive collapse completes before selecting another project.
    await expect(f.page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeVisible()
    const explicitlyOpened = await browserState(f.page)
    await selectProject(f.page, 'Q'); await selectSession(f.page, 'Q A')
    await f.command('P', { op: 'closePage', session: 'P-a' })
    await expect.poll(() => f.page.evaluate(() => (window as any).__multisessionEvents.filter((event: any) => event.type === 'agent-page' && event.page.sessionId === 'P-a' && event.page.status === 'invalidated').length)).toBe(1)
    const outcome = await f.page.evaluate(async target => (window.bingoDesktop as any).openAgentPage({ hostId: target.hostId, connectionId: target.connectionId, sessionId: target.sessionId, itemId: target.itemId }), source)
    expect(outcome.ok).toBe(false)
    expect((await browserState(f.page)).url).toBe(explicitlyOpened.url)
    await expect(f.page.locator('h1')).toHaveText('Q A')
  } finally { await f.close() }
})

test('interleaved burst frames retain their host source and completion never steals the foreground', async () => {
  const f = await multisessionFixture()
  try {
    await observeDesktopEvents(f.page)
    await selectSession(f.page, 'P A'); await sendMessage(f.page, 'P work')
    await selectProject(f.page, 'Q'); await selectSession(f.page, 'Q A'); await sendMessage(f.page, 'Q work')
    await Promise.all([f.command('P', { op: 'burst', session: 'P-a', count: 1000 }), f.command('Q', { op: 'burst', session: 'Q-a', count: 1000 })])
    await expect.poll(() => f.page.evaluate(() => (window as any).__multisessionEvents.filter((event: any) => event.type === 'rpc' && event.method === 'event' && event.params.event.type === 'itemDelta').length)).toBe(2000)
    const frames = await f.page.evaluate(() => (window as any).__multisessionEvents.filter((event: any) => event.type === 'rpc' && event.method === 'event').map((event: any) => ({ connectionId: event.connectionId, ...event.params })))
    for (const session of ['P-a', 'Q-a']) {
      const own = frames.filter((frame: any) => frame.session === session)
      expect(new Set(own.map((frame: any) => frame.connectionId)).size).toBe(1)
      expect(own.map((frame: any) => frame.seq)).toEqual(Array.from({ length: own.length }, (_, n) => n + 1))
      expect(own.filter((frame: any) => frame.event.type === 'itemDelta')).toHaveLength(1000)
    }
    await f.page.getByRole('textbox', { name: 'Message bingo' }).fill('Q draft while P completes')
    await f.command('P', { op: 'complete', session: 'P-a' })
    await expect(f.page.locator('h1')).toHaveText('Q A')
    await expect(f.page.getByRole('textbox', { name: 'Message bingo' })).toHaveValue('Q draft while P completes')
    await expect.poll(async () => (await f.state('P')).sessions.find(s => s.summary.id === 'P-a')?.lastTurn?.status.kind).toBe('completed')
  } finally { await f.close() }
})

test('background completion marks only its own row unread without affecting the active draft', async ({}, testInfo) => {
  const f = await multisessionFixture()
  try {
    await selectSession(f.page, 'P A'); await sendMessage(f.page, 'A background work')
    await selectSession(f.page, 'P B')
    await f.page.getByRole('textbox', { name: 'Message bingo' }).fill('B unread-check draft')
    await f.command('P', { op: 'complete', session: 'P-a' })
    const row = f.page.locator('.session-row').filter({ hasText: 'P A' })
    await expect(row.getByText('Unread', { exact: true })).toBeVisible()
    await expect(f.page.locator('.session-row').filter({ hasText: 'P B' }).getByText('Unread', { exact: true })).toHaveCount(0)
    await expect(f.page.locator('h1')).toHaveText('P B')
    await expect(f.page.getByRole('textbox', { name: 'Message bingo' })).toHaveValue('B unread-check draft')
    await testInfo.attach('background-completion-unread', { body: await f.page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    expect((await f.audit('P')).filter(row => row.kind === 'request' && /^session\/(?:read|seen|mark)/i.test(row.method ?? ''))).toEqual([])
  } finally { await f.close() }
})

test('short unread and failed badges align with their titles at wide and narrow sidebar widths', async ({}, testInfo) => {
  const f = await multisessionFixture({ sessionTitles: ['Hi', 'Go'] })
  try {
    await selectSession(f.page, 'Hi'); await sendMessage(f.page, 'A completes out of view')
    await selectSession(f.page, 'Go'); await sendMessage(f.page, 'B fails in view')
    await f.command('P', { op: 'complete', session: 'P-a' })
    await f.command('P', { op: 'fail', session: 'P-b' })
    await expect.poll(async () => (await f.state('P')).sessions.find(session => session.summary.id === 'P-a')?.lastTurn?.status.kind).toBe('completed')
    await expect.poll(async () => (await f.state('P')).sessions.find(session => session.summary.id === 'P-b')?.lastTurn?.status.kind).toBe('failed')
    const rows = [{ title: 'Hi', badge: 'Unread' }, { title: 'Go', badge: 'Failed' }]
    const unreadRow = f.page.locator('.session-row').filter({ has: f.page.locator('.session-row-title').filter({ hasText: /^Hi$/ }) })
    const failedRow = f.page.locator('.session-row').filter({ has: f.page.locator('.session-row-title').filter({ hasText: /^Go$/ }) })
    await expect(unreadRow.locator('.session-row-state')).toHaveText('Unread')
    await expect(failedRow.locator('.session-row-state')).toHaveText('Failed')
    await expect(failedRow.getByText('Unread', { exact: true })).toHaveCount(0)
    const measurements = []
    for (const [width, sidebarWidth] of [[1200, 252], [850, 220]]) {
      await f.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 700), width)
      await expect.poll(() => f.page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().width)).toBe(sidebarWidth)
      for (const { title, badge } of rows) {
        const row = f.page.locator('.session-row').filter({ has: f.page.locator('.session-row-title').filter({ hasText: new RegExp(`^${title}$`) }) })
        await expect(row.locator('.session-row-state')).toHaveText(badge)
        await expect(row.locator('.session-row-title')).toBeVisible()
        await expect(row.locator('.session-row-state')).toBeVisible()
        if (width === 1200) await expect(row.locator('time')).toBeVisible()
        else await expect(row.locator('time')).toBeHidden()
        measurements.push({ width, title, badge, ...await row.evaluate(element => {
          const title = element.querySelector('.session-row-title')!.getBoundingClientRect()
          const state = element.querySelector('.session-row-state')!.getBoundingClientRect()
          return { titleWidth: title.width, badgeWidth: state.width, rowHeight: element.getBoundingClientRect().height, centerDeltaY: Math.abs((title.top + title.bottom - state.top - state.bottom) / 2) }
        }) })
      }
      await testInfo.attach(`short-status-${width}`, { body: await f.page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    }
    console.info('Short status row geometry:', measurements)
    for (const measurement of measurements) {
      expect(measurement.titleWidth).toBeGreaterThan(20)
      expect(measurement.badgeWidth).toBeGreaterThan(20)
      expect(measurement.centerDeltaY).toBeLessThan(6)
      expect(measurement.rowHeight).toBeLessThan(42)
    }
    expect((await f.audit('P')).filter(row => row.kind === 'request' && row.method === 'session/submit').map(row => row.params?.session)).toEqual(['P-a', 'P-b'])
  } finally { await f.close() }
})

test('closing an idle background project preserves foreground work and reopening restores the original draft', async () => {
  const f = await multisessionFixture()
  try {
    await selectSession(f.page, 'P A'); await sendMessage(f.page, 'P history before closing')
    await expect(f.page.getByRole('button', { name: 'Stop generation' })).toBeVisible()
    await f.command('P', { op: 'complete', session: 'P-a' })
    await expect(f.page.getByText('P/P-a: complete', { exact: true })).toBeVisible()
    await expect(f.page.getByRole('button', { name: 'Stop generation' })).toHaveCount(0)
    await f.page.getByRole('textbox', { name: 'Message bingo' }).fill('P retained after closing host')
    const original = await f.state('P')
    const originalSelection = await f.page.evaluate(async () => { const result = await window.bingoDesktop.bootstrap(); if (!result.ok) throw new Error(result.error.message); return (result.value as any).selection })
    await selectProject(f.page, 'Q'); await selectSession(f.page, 'Q A'); await sendMessage(f.page, 'Q continues while P closes')
    const closeP = f.page.getByRole('button', { name: 'Close idle project P', exact: true })
    await expect(closeP).toBeEnabled()
    await closeP.click()
    await expect.poll(async () => (await f.audit('P')).some(row => row.kind === 'exit' && row.epoch === original.epoch)).toBe(true)
    await expect(f.page.locator('h1')).toHaveText('Q A')
    await expect(f.page.getByRole('button', { name: 'Stop generation' })).toBeVisible()
    await f.command('Q', { op: 'append', session: 'Q-a', text: '|Q remains running after close P|' })
    await expect(f.page.getByText(/Q remains running after close P/)).toBeVisible()
    await selectProject(f.page, 'P'); await selectSession(f.page, 'P A')
    await expect.poll(async () => (await f.state('P')).epoch).not.toBe(original.epoch)
    await expect(f.page.getByRole('textbox', { name: 'Message bingo' })).toBeEditable()
    await expect(f.page.getByRole('textbox', { name: 'Message bingo' })).toHaveValue('P retained after closing host')
    await expect(f.page.getByText('P/P-a: complete', { exact: true })).toBeVisible()
    expect((await f.state('P')).pid).not.toBe(original.pid)
    await expect.poll(async () => f.page.evaluate(async () => { const result = await window.bingoDesktop.bootstrap(); if (!result.ok) throw new Error(result.error.message); return result.value.selection?.hostId })).toBe(originalSelection.hostId)
    const resumedSelection = await f.page.evaluate(async () => { const result = await window.bingoDesktop.bootstrap(); if (!result.ok) throw new Error(result.error.message); return result.value.selection })
    expect(resumedSelection?.connectionId).not.toBe(originalSelection.connectionId)
    expect((await f.audit('P')).filter(row => row.kind === 'request' && row.method === 'session/submit').map(row => row.params?.input?.text)).toEqual(['P history before closing'])
    expect((await f.state('Q')).sessions.find(s => s.summary.id === 'Q-a')?.turn).toBeDefined()
  } finally { await f.close() }
})

test('single host crash does not stop its neighbor and renderer reload/quit terminate all old hosts', async () => {
  const f = await multisessionFixture()
  let closed = false
  try {
    await selectSession(f.page, 'P A'); await sendMessage(f.page, 'P work')
    await selectProject(f.page, 'Q'); await selectSession(f.page, 'Q A'); await sendMessage(f.page, 'Q work')
    await expect(f.page.getByText('Q/Q-a: working on Q work', { exact: true })).toBeVisible()
    const p = await f.state('P'), q = await f.state('Q')
    await f.command('P', { op: 'crash' })
    await expect.poll(async () => (await f.audit('P')).some(row => row.kind === 'exit' && row.code === 27)).toBe(true)
    await f.command('Q', { op: 'append', session: 'Q-a', text: '|Q survives P failure|' })
    await expect(f.page.getByText(/Q survives P failure/)).toBeVisible()
    await expect(f.page.locator('h1')).toHaveText('Q A')
    await expect(f.page.getByRole('button', { name: 'Stop generation' })).toBeVisible()
    expect((await f.state('Q')).epoch).toBe(q.epoch)
    await f.page.getByRole('textbox', { name: 'Message bingo' }).fill('Q reload draft')
    // No sleep: wait for the existing draft persistence effect's observable write.
    await expect.poll(() => f.page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.includes('draft') && value.includes('Q reload draft')))).toBe(true)
    await f.page.reload()
    await expect(f.page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect.poll(async () => (await f.audit('Q')).some(row => row.kind === 'exit' && row.epoch === q.epoch)).toBe(true)
    await expect.poll(async () => (await f.state('Q')).epoch).not.toBe(q.epoch)
    await selectSession(f.page, 'Q A')
    await expect(f.page.getByRole('textbox', { name: 'Message bingo' })).toHaveValue('Q reload draft')
    const submissions = (await f.audit('Q')).filter(row => row.kind === 'request' && row.method === 'session/submit')
    expect(submissions).toHaveLength(1)
    expect((await f.audit('P')).filter(row => row.kind === 'started' && row.epoch === p.epoch)).toHaveLength(1)
    const lastQ = await f.state('Q')
    await f.close(); closed = true
    await expect.poll(async () => (await f.audit('Q')).some(row => row.kind === 'exit' && row.epoch === lastQ.epoch)).toBe(true)
  } finally { if (!closed) await f.close() }
})
