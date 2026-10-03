import { expect, test, type Page } from '@playwright/test'
import { multisessionFixture, selectSession } from './helpers/multisession'
import { settledMotion } from './helpers/electron'

// Scripted streaming turn over the protocol-1 double: reasoning → tools → streamed answer.
// Captures stage screenshots (test-results/conversation-motion) for visual review.
test.beforeEach(() => { test.skip(process.platform === 'win32', 'This offline stdio fixture requires a POSIX Node executable wrapper.') })

const now = (offset = 0) => new Date(Date.now() + offset).toISOString()
const answer = `## Fixed the flaky retry test

The retry loop compared **wall-clock** time, so a slow CI runner could skip the final attempt.

- Switched \`retryUntil\` to a monotonic clock
- Added a regression test that freezes time between attempts
- Kept the public API unchanged

\`\`\`ts
const deadline = performance.now() + timeoutMs
while (performance.now() < deadline) await attempt()
\`\`\`

All 42 tests pass locally.`

async function shot(page: Page, name: string) {
  // A hidden test window only advances animations when a frame is produced; capturing produces one.
  await expect.poll(async () => { await page.screenshot(); return page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)).length) }, { timeout: 10000 }).toBe(0)
  await settledMotion(page)
  await page.screenshot({ path: `test-results/conversation-motion/${name}.png` })
}

test('streamed turn presents thinking, live tools and the answer with stable motion', async () => {
  const f = await multisessionFixture()
  const page = f.page
  const frames = (events: unknown[]) => f.command('P', { op: 'frames', session: 'P-a', events })
  let n = 0
  try {
    await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {})
    await selectSession(page, 'P A')
    const turn = 'show-turn-1'
    const tool = (id: string, name: string, input: unknown, extra: Record<string, unknown> = {}) => ({ id, turn, status: 'running', startedAt: now(), body: { kind: 'toolCall', callId: id, name, input, ...extra } })
    await frames([
      { type: 'itemCompleted', item: { id: `${turn}-user`, turn, status: 'completed', startedAt: now(), completedAt: now(), body: { kind: 'user', parts: [{ type: 'text', text: 'The retry test is flaky on CI. Can you find out why and fix it?' }], origin: { surface: 'desktop' } } } },
      { type: 'turnStarted', turn, inputs: [`${turn}-user`], origin: 'submit' },
      { type: 'itemStarted', item: { id: `${turn}-reasoning`, turn, status: 'running', startedAt: now(), body: { kind: 'reasoning', text: '' } } }
    ])
    for (const chunk of ['Let me look at the retry helper first. ', 'The test probably depends on timing; ', 'I should check which clock it uses.']) await frames([{ type: 'itemDelta', item: `${turn}-reasoning`, n: ++n, kind: 'reasoning', data: chunk }])
    await expect(page.locator('.reasoning')).toBeVisible()
    await shot(page, '01-thinking')
    await frames([{ type: 'itemCompleted', item: { id: `${turn}-reasoning`, turn, status: 'completed', startedAt: now(-4200), completedAt: now(), body: { kind: 'reasoning', text: 'Let me look at the retry helper first. The test probably depends on timing; I should check which clock it uses.' } } }])
    const read = tool(`${turn}-read`, 'Read', { file_path: `${f.projects.P}/src/retry.ts` })
    await frames([{ type: 'itemStarted', item: read }])
    await expect(page.locator('.tool-card').first()).toBeVisible()
    await shot(page, '02-tool-running')
    await frames([{ type: 'itemCompleted', item: { ...read, status: 'completed', completedAt: now(), body: { ...read.body, durationMs: 180, output: { parts: [{ type: 'text', text: '1\texport async function retryUntil(fn, timeoutMs) {\n2\t  const deadline = Date.now() + timeoutMs\n3\t  while (Date.now() < deadline) await fn()\n4\t}' }] } } } }])
    const grep = tool(`${turn}-grep`, 'Grep', { pattern: 'retryUntil', path: f.projects.P, output_mode: 'files_with_matches' })
    await frames([{ type: 'itemStarted', item: grep }, { type: 'itemCompleted', item: { ...grep, status: 'completed', completedAt: now(), body: { ...grep.body, durationMs: 90, output: { parts: [{ type: 'text', text: 'src/retry.ts\ntest/retry.test.ts' }] } } } }])
    const edit = tool(`${turn}-edit`, 'Edit', { file_path: `${f.projects.P}/src/retry.ts`, old_string: '  const deadline = Date.now() + timeoutMs\n  while (Date.now() < deadline) await fn()', new_string: '  const deadline = performance.now() + timeoutMs\n  while (performance.now() < deadline) await fn()' })
    await frames([{ type: 'itemStarted', item: edit }, { type: 'itemCompleted', item: { ...edit, status: 'completed', completedAt: now(), body: { ...edit.body, durationMs: 40, output: { parts: [{ type: 'text', text: 'The file has been updated.' }] } } } }])
    const bash = tool(`${turn}-bash`, 'Bash', { command: 'npm test -- retry', description: 'Run the retry tests' })
    await frames([{ type: 'itemStarted', item: bash }, { type: 'itemDelta', item: bash.id, n: ++n, kind: 'tail', data: '> vitest run retry\n\n ✓ test/retry.test.ts (3)\n   ✓ retries until deadline' }])
    await expect(page.locator('.tool-card').filter({ hasText: 'npm test' })).toBeVisible()
    await shot(page, '03-tools-live')
    await frames([{ type: 'itemCompleted', item: { ...bash, status: 'completed', completedAt: now(), body: { ...bash.body, durationMs: 2400, output: { parts: [{ type: 'text', text: '$ npm test -- retry\n> vitest run retry\n\n ✓ test/retry.test.ts (3)\n\nTest Files  1 passed (1)\n     Tests  42 passed (42)\n[Exited with code 0]' }] } } } }])
    await frames([{ type: 'itemStarted', item: { id: `${turn}-answer`, turn, status: 'running', startedAt: now(), body: { kind: 'assistant', text: '' } } }])
    const pieces = answer.match(/[\s\S]{1,18}/g) ?? []
    for (const [index, piece] of pieces.entries()) {
      await frames([{ type: 'itemDelta', item: `${turn}-answer`, n: ++n, kind: 'text', data: piece }])
      if (index === Math.floor(pieces.length / 2)) await shot(page, '04-streaming')
    }
    await frames([{ type: 'itemCompleted', item: { id: `${turn}-answer`, turn, status: 'completed', startedAt: now(), completedAt: now(), body: { kind: 'assistant', text: answer } } }, { type: 'turnCompleted', turn, status: { kind: 'completed' }, usage: { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 60 } }])
    await expect(page.getByRole('heading', { name: 'Fixed the flaky retry test' })).toBeVisible()
    await expect(page.locator('.timeline .live-working')).toHaveCount(0)
    await page.waitForTimeout(600)
    await shot(page, '05-complete')
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    await page.waitForTimeout(300)
    await shot(page, '06-complete-dark')
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    const failed = 'show-turn-2'
    await frames([
      { type: 'itemCompleted', item: { id: `${failed}-user`, turn: failed, status: 'completed', startedAt: now(), completedAt: now(), body: { kind: 'user', parts: [{ type: 'text', text: 'Now push it.' }], origin: { surface: 'desktop' } } } },
      { type: 'turnStarted', turn: failed, inputs: [`${failed}-user`], origin: 'submit' },
      { type: 'turnCompleted', turn: failed, status: { kind: 'failed', error: { code: 'RATE_LIMITED', message: 'The provider rejected the request: rate limit exceeded. Try again in 20 seconds.' } }, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } }
    ])
    await expect(page.locator('.turn-failure')).toBeVisible()
    await page.waitForTimeout(400)
    await shot(page, '07-failed')
  } finally { await f.close() }
})
