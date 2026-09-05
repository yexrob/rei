import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const mocks = vi.hoisted(() => ({ directory: '', handlers: new Map<string, (...args: any[]) => Promise<any>>(), confirm: vi.fn(), setup: vi.fn(), external: vi.fn() }))
vi.mock('electron', () => ({
  app: { getAppPath: () => '/app', getVersion: () => 'test', getPath: (name: string) => name === 'temp' ? mocks.directory : join(mocks.directory, 'preferences'), isPackaged: true },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => Promise<any>) => mocks.handlers.set(name, handler) },
  dialog: { showMessageBox: mocks.confirm }, nativeTheme: {}, shell: { openExternal: mocks.external }
}))
vi.mock('./binary', () => ({ discoverBinary: async () => ({ path: '/approved/bingo', source: 'test' }), executable: async (path: string) => path, workspaceDirectory: async (path: string) => path }))
vi.mock('./provider-setup', async (original) => ({ ...await original<typeof import('./provider-setup')>(), configureProvider: mocks.setup }))
import { DesktopIpc } from './ipc'
import { DESKTOP_IPC } from '../../shared/desktop'
import { PreferencesStore } from './preferences'
import type { DesktopRuntime } from './runtime'
import type { BrowserWindow } from 'electron'

async function harness(workspace: string | null = '/approved/project') {
  const frame = { url: 'file:///app/index.html' }
  const contents = { mainFrame: frame }
  const window = { isDestroyed: () => false, webContents: contents }
  const preferences = new PreferencesStore(join(mocks.directory, 'preferences'))
  await preferences.load()
  if (workspace) await preferences.save({ workspace })
  const runtime = { busy: false, connection: { status: 'ready', binary: '/approved/bingo', workspace, connectionId: 'connection' }, request: vi.fn(async () => ({})), connect: vi.fn(async (binary: string, cwd: string) => {
    runtime.connection = { status: 'ready', binary, workspace: cwd, connectionId: 'connected' }
    return runtime.connection
  }), close: vi.fn(async () => {}), deleteSession: vi.fn(async () => {}) }
  const ipc = new DesktopIpc({ window: () => window as unknown as BrowserWindow, documentUrl: frame.url, preferences: preferences as unknown as PreferencesStore, runtime: runtime as unknown as DesktopRuntime })
  await ipc.initialize()
  const event = { sender: contents, senderFrame: frame }
  const invoke = (channel: string, input?: unknown, sender = event) => mocks.handlers.get(channel)!(sender, input)
  return { ipc, runtime, invoke, event, preferences }
}
beforeEach(async () => {
  mocks.directory = await realpath(await mkdtemp(join(tmpdir(), 'rei-ipc-test-')))
  mocks.handlers.clear(); mocks.confirm.mockReset().mockResolvedValue({ response: 0 }); mocks.setup.mockReset().mockResolvedValue(undefined); mocks.external.mockReset()
})
afterEach(async () => { await rm(mocks.directory, { recursive: true, force: true }) })
describe('registered IPC handlers', () => {
  it('bootstraps and connects without a selected project, keeping scratch out of persisted preferences', async () => {
    const { invoke, runtime, preferences } = await harness(null)
    const bootstrap = await invoke(DESKTOP_IPC.bootstrap)
    expect(bootstrap.ok).toBe(true)
    const scratch = bootstrap.value.scratchWorkspace
    expect(typeof scratch).toBe('string')
    expect(scratch).not.toBe(mocks.directory)
    expect((await stat(scratch)).isDirectory()).toBe(true)
    expect(bootstrap.value.preferences).toMatchObject({ workspace: null, recentWorkspaces: [] })
    expect(await invoke(DESKTOP_IPC.connect, {})).toMatchObject({ ok: true, value: { workspace: scratch } })
    expect(runtime.connect).toHaveBeenCalledWith('/approved/bingo', scratch)
    expect(preferences.preferences).toMatchObject({ workspace: null, recentWorkspaces: [] })
    const reloaded = new PreferencesStore(join(mocks.directory, 'preferences'))
    await reloaded.load()
    expect(reloaded.preferences).toMatchObject({ workspace: null, recentWorkspaces: [] })
    const relaunched = await harness(null)
    expect((await relaunched.invoke(DESKTOP_IPC.bootstrap)).value.scratchWorkspace).toBe(scratch)
  })
  it('switches an approved project back to scratch without making scratch a recent project', async () => {
    const { invoke, preferences } = await harness()
    const scratch = (await invoke(DESKTOP_IPC.bootstrap)).value.scratchWorkspace
    expect(await invoke(DESKTOP_IPC.connect, { workspace: '/approved/project' })).toMatchObject({ ok: true })
    expect(preferences.preferences.workspace).toBe('/approved/project')
    expect(await invoke(DESKTOP_IPC.connect, {})).toMatchObject({ ok: true, value: { workspace: scratch } })
    expect(await invoke(DESKTOP_IPC.connect, { workspace: scratch })).toMatchObject({ ok: true })
    expect(await invoke(DESKTOP_IPC.savePreferences, { workspace: scratch })).toMatchObject({ ok: true, value: { workspace: null, recentWorkspaces: ['/approved/project'] } })
    expect(preferences.preferences).toMatchObject({ workspace: null, recentWorkspaces: ['/approved/project'] })
  })
  it('recreates a removed scratch directory before reconnecting', async () => {
    const { invoke, runtime } = await harness(null)
    const scratch = (await invoke(DESKTOP_IPC.bootstrap)).value.scratchWorkspace
    await rm(scratch, { recursive: true })
    expect(await invoke(DESKTOP_IPC.connect, {})).toMatchObject({ ok: true, value: { workspace: scratch } })
    expect(runtime.connect).toHaveBeenCalledWith('/approved/bingo', scratch)
    expect((await stat(scratch)).isDirectory()).toBe(true)
  })
  it('does not authorize scratch neighbors, children, traversal aliases or arbitrary project paths', async () => {
    const { invoke, runtime } = await harness(null)
    const scratch = (await invoke(DESKTOP_IPC.bootstrap)).value.scratchWorkspace
    for (const workspace of [mocks.directory, join(scratch, 'child'), `${scratch}/../outside`, '/unapproved/project']) {
      expect(await invoke(DESKTOP_IPC.connect, { workspace })).toMatchObject({ ok: false, error: { code: 'WORKSPACE_NOT_APPROVED' } })
      expect(await invoke(DESKTOP_IPC.savePreferences, { workspace })).toMatchObject({ ok: false, error: { code: 'WORKSPACE_NOT_APPROVED' } })
    }
    expect(runtime.connect).not.toHaveBeenCalled()
    expect(await invoke(DESKTOP_IPC.connect, {})).toMatchObject({ ok: true })
    expect(await invoke(DESKTOP_IPC.request, { connectionId: 'connected', method: 'session/open', params: { selector: { kind: 'create', spec: { cwd: '/unapproved/project' } } } })).toMatchObject({ ok: false, error: { code: 'WORKSPACE_MISMATCH' } })
  })
  it('rejects a replaced scratch symlink before stopping an existing connection', async () => {
    const { invoke, runtime } = await harness()
    const scratch = (await invoke(DESKTOP_IPC.bootstrap)).value.scratchWorkspace
    const outside = join(mocks.directory, 'outside')
    await mkdir(outside)
    await rm(scratch, { recursive: true })
    await symlink(outside, scratch, process.platform === 'win32' ? 'junction' : 'dir')
    runtime.busy = true
    expect(await invoke(DESKTOP_IPC.connect, {})).toMatchObject({ ok: false, error: { code: 'UNSAFE_SCRATCH_WORKSPACE' } })
    expect(runtime.connect).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(await invoke(DESKTOP_IPC.connect, { workspace: outside })).toMatchObject({ ok: false, error: { code: 'WORKSPACE_NOT_APPROVED' } })
  })
  it('keeps running work when a switch to scratch is cancelled', async () => {
    const { invoke, runtime, preferences } = await harness()
    runtime.busy = true
    expect(await invoke(DESKTOP_IPC.connect, {})).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
    expect(runtime.connect).not.toHaveBeenCalled()
    expect(preferences.preferences.workspace).toBe('/approved/project')
  })
  it('revalidates scratch after stop confirmation before replacing the runtime', async () => {
    const { invoke, runtime } = await harness()
    const scratch = (await invoke(DESKTOP_IPC.bootstrap)).value.scratchWorkspace
    const outside = join(mocks.directory, 'outside')
    await mkdir(outside)
    runtime.busy = true
    mocks.confirm.mockImplementation(async () => {
      await rm(scratch, { recursive: true })
      await symlink(outside, scratch, process.platform === 'win32' ? 'junction' : 'dir')
      return { response: 1 }
    })
    expect(await invoke(DESKTOP_IPC.connect, {})).toMatchObject({ ok: false, error: { code: 'UNSAFE_SCRATCH_WORKSPACE' } })
    expect(runtime.connect).not.toHaveBeenCalled()
  })
  it('does not apply stop approval to a different connection', async () => {
    const { invoke, runtime } = await harness()
    runtime.busy = true
    mocks.confirm.mockImplementation(async () => {
      runtime.connection = { ...runtime.connection, connectionId: 'replacement' }
      return { response: 1 }
    })
    expect(await invoke(DESKTOP_IPC.connect, {})).toMatchObject({ ok: false, error: { code: 'STALE_CONNECTION' } })
    expect(runtime.connect).not.toHaveBeenCalled()
  })
  it('supports consented provider setup in personal space without a selected project', async () => {
    const { invoke, preferences } = await harness(null)
    const scratch = (await invoke(DESKTOP_IPC.bootstrap)).value.scratchWorkspace
    const input = { name: 'fixture', protocol: 'openai', baseUrl: '', apiKey: '' }
    mocks.confirm.mockResolvedValue({ response: 1 })
    expect(await invoke(DESKTOP_IPC.configureProvider, input)).toEqual({ ok: true, value: undefined })
    expect(mocks.setup).toHaveBeenCalledWith('/approved/bingo', scratch, input)
    expect(preferences.preferences).toMatchObject({ workspace: null, recentWorkspaces: [] })
  })
  it('rejects unauthorized senders before invoking native operations', async () => {
    const { invoke, runtime } = await harness()
    const result = await invoke(DESKTOP_IPC.request, { connectionId: 'connection', method: 'session/list', params: {} }, { sender: {} as any, senderFrame: null as any })
    expect(result).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
    expect(runtime.request).not.toHaveBeenCalled()
  })
  it('rejects arbitrary executable/workspace paths and out-of-scope new sessions', async () => {
    const { invoke, runtime } = await harness()
    expect(await invoke(DESKTOP_IPC.connect, { binary: '/evil/program', workspace: '/approved/project' })).toMatchObject({ ok: false, error: { code: 'BINARY_NOT_APPROVED' } })
    expect(await invoke(DESKTOP_IPC.connect, { workspace: '/unapproved/project' })).toMatchObject({ ok: false, error: { code: 'WORKSPACE_NOT_APPROVED' } })
    expect(await invoke(DESKTOP_IPC.request, { connectionId: 'connection', method: 'session/open', params: { selector: { kind: 'create', spec: { cwd: '/elsewhere' } } } })).toMatchObject({ ok: false, error: { code: 'WORKSPACE_MISMATCH' } })
    expect(runtime.connect).not.toHaveBeenCalled()
    expect(runtime.request).not.toHaveBeenCalled()
  })
  it('cannot bypass deletion or running-work native confirmation with renderer flags', async () => {
    const { invoke, runtime } = await harness()
    expect(await invoke(DESKTOP_IPC.deleteSession, { connectionId: 'connection', session: 's' })).toEqual({ ok: true, value: false })
    expect(runtime.deleteSession).not.toHaveBeenCalled()
    runtime.busy = true
    expect(await invoke(DESKTOP_IPC.connect, { workspace: '/approved/project' })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
    expect(runtime.connect).not.toHaveBeenCalled()
  })
  it('requires native provider-save consent and excludes the key from dialog text', async () => {
    const { invoke, runtime } = await harness()
    const input = { name: 'fixture', protocol: 'openai', baseUrl: 'https://example.test', apiKey: 'test-secret-no-output' }
    expect(await invoke(DESKTOP_IPC.configureProvider, input)).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
    expect(mocks.setup).not.toHaveBeenCalled()
    expect(runtime.close).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.confirm.mock.calls)).not.toContain(input.apiKey)
    mocks.confirm.mockResolvedValue({ response: 1 })
    expect(await invoke(DESKTOP_IPC.configureProvider, input)).toEqual({ ok: true, value: undefined })
    expect(runtime.close).toHaveBeenCalledOnce()
    expect(mocks.setup).toHaveBeenCalledWith('/approved/bingo', '/approved/project', input)
  })
  it.each(['busy', 'connection'])('rechecks %s after provider-save confirmation, before disconnect or write', async (change) => {
    const { invoke, runtime } = await harness()
    mocks.confirm.mockImplementation(async () => {
      if (change === 'busy') runtime.busy = true
      else runtime.connection = { ...runtime.connection, connectionId: 'replacement' }
      return { response: 1 }
    })
    const input = { name: 'fixture', protocol: 'openai', baseUrl: '', apiKey: 'test-only' }
    expect(await invoke(DESKTOP_IPC.configureProvider, input)).toMatchObject({ ok: false, error: { code: change === 'busy' ? 'RUNTIME_BUSY' : 'STALE_CONNECTION' } })
    expect(runtime.close).not.toHaveBeenCalled()
    expect(mocks.setup).not.toHaveBeenCalled()
  })
  it('does not show credentials in validation errors or run setup during work', async () => {
    const { invoke, runtime } = await harness()
    const invalid = { name: 'fixture', protocol: 'openai', baseUrl: '', apiKey: 'sensitive\nline' }
    const result = await invoke(DESKTOP_IPC.configureProvider, invalid)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(JSON.stringify(result)).not.toContain('sensitive')
    runtime.busy = true
    expect(await invoke(DESKTOP_IPC.configureProvider, { ...invalid, apiKey: 'safe-fixture' })).toMatchObject({ ok: false, error: { code: 'RUNTIME_BUSY' } })
    expect(mocks.setup).not.toHaveBeenCalled()
  })
})
