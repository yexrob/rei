import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { electron, assertBackground, foregroundEnabled } from './electron'
import type { SessionState } from '../../src/shared/rpc'
import type {} from '../../src/shared/panels'

// Separate fixture helper: the shared hidden Electron guard is deliberately unchanged.
export type AuditRow = { epoch: string; pid: number; project: string; kind: string; session?: string; method?: string; params?: { session?: string; parent?: string; interaction?: string; filter?: { cwd?: string; parent?: string }; selector?: { kind: string; id?: string }; options?: { children?: boolean; maxSnapshotBytes?: number }; input?: { text?: string; action?: { name: string; args?: unknown } } }; [key: string]: unknown }
export type FixtureHostState = { project: string; epoch: string; pid: number; sessions: SessionState[]; deferred: string[] }
export async function multisessionFixture(options: { heldProject?: string; sessionTitles?: [string, string]; startupOversizedTitle?: boolean } = {}) {
  if (foregroundEnabled) throw new Error('Multisession acceptance must use REI_E2E_FOREGROUND=0; foreground runs are not authorized.')
  // macOS /var can alias /private/var; native workspace approval requires canonical paths.
  const home = await realpath(await mkdtemp(join(tmpdir(), 'rei-multisession-')))
  const data = join(home, 'desktop'), control = join(home, 'control')
  const projects = Object.fromEntries(['P', 'Q', 'R'].map(name => [name, join(home, name)]))
  await mkdir(data); await mkdir(control)
  for (const [name, path] of Object.entries(projects)) { await mkdir(path); await writeFile(join(path, 'fixture-config.json'), JSON.stringify({ uniqueSessions: true, holdInitialize: name === options.heldProject, ...(name === 'P' && options.sessionTitles ? { sessionTitles: options.sessionTitles } : {}), ...(name === 'P' && options.startupOversizedTitle ? { startupOversizedTitle: true } : {}) })) }
  const binary = join(home, 'runtime-fixture')
  await writeFile(binary, `#!${process.execPath}\nprocess.env.REI_FIXTURE_CONTROL=${JSON.stringify(control)};require(${JSON.stringify(resolve('tests/fixtures/multisession-host.cjs'))})\n`, { mode: 0o755 })
  // Imported preferences model previously approved folders, not arbitrary path authorization.
  await writeFile(join(data, 'desktop-preferences.json'), JSON.stringify({ version: 1, preferences: { theme: 'light', workspace: projects.P, binaryPath: binary, recentWorkspaces: Object.values(projects) } }))
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve(process.env.BINGO_E2E_MAIN || 'out/main/index.js')], env: { ...env, HOME: home, USERPROFILE: home, BINGO_GUI_USER_DATA: data, BINGO_GUI_CWD: projects.P, BINGO_GUI_BINARY: binary } })
  const page = await app.firstWindow()
  try {
    if (!options.startupOversizedTitle) {
      await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
      await expect(page.locator('.session-row-title').filter({ hasText: new RegExp(`^${options.sessionTitles?.[0] ?? 'P A'}$`) })).toBeVisible()
    }
  } catch (error) { await app.close(); throw error }
  const endpoint = async (project: string): Promise<{ endpoint: string; epoch: string; pid: number }> => JSON.parse(await readFile(join(control, `${project}.json`), 'utf8'))
  const state = async (project: string): Promise<FixtureHostState> => { const host = await endpoint(project); const response = await fetch(`${host.endpoint}/state`); if (!response.ok) throw new Error(`Fixture state failed: ${response.status}`); return response.json() }
  const command = async (project: string, operation: Record<string, unknown>) => { const host = await endpoint(project); const response = await fetch(`${host.endpoint}/control`, { method: 'POST', body: JSON.stringify(operation) }); if (!response.ok) throw new Error(`Fixture control failed: ${await response.text()}`) }
  const audit = async (project: string): Promise<AuditRow[]> => { try { return (await readFile(join(control, `${project}.ndjson`), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error } }
  const close = async () => { await assertBackground(app); await app.close() }
  return { app, page, home, data, control, projects, binary, endpoint, state, command, audit, close }
}
export async function selectSession(page: Page, title: string) {
  await page.locator('.session-row-title').filter({ hasText: new RegExp(`^${title}$`) }).click()
  await expect(page.locator('h1')).toHaveText(title)
}
export async function selectProject(page: Page, name: string) {
  // Opening Browser can collapse navigation at the CI runner's narrower size.
  const showSidebar = page.getByRole('button', { name: 'Show sidebar', exact: true })
  if (await showSidebar.isVisible()) await showSidebar.click()
  const heading = page.locator('.project-heading').filter({ hasText: new RegExp(`^${name}$`) })
  const label = await heading.getAttribute('aria-label')
  if (label === `Open project ${name}` || label === `Expand project ${name}`) await heading.click()
  await expect(heading).toHaveAttribute('aria-label', `Collapse project ${name}`)
  await expect(page.locator('.session-row-title').filter({ hasText: new RegExp(`^${name} A$`) })).toBeVisible()
}
export async function sendMessage(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message bingo' }).fill(text)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
}
export async function observeDesktopEvents(page: Page) {
  await page.evaluate(() => {
    const state = window as typeof window & { __multisessionEvents: unknown[] }
    state.__multisessionEvents = []
    window.bingoDesktop.onEvent(event => state.__multisessionEvents.push(event))
  })
}
export async function browserState(page: Page) {
  return page.evaluate(async () => { const result = await window.bingoPanels.snapshot(); if (!result.ok) throw new Error(result.error.message); return result.value.browser })
}
export async function assertNoNativeInterruption(app: ElectronApplication) { await assertBackground(app) }
