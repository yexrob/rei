import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const mocks = vi.hoisted(() => ({ directory: '', handlers: new Map<string, (...args: any[]) => Promise<any>>(), confirm: vi.fn(), save: vi.fn(), setup: vi.fn(), external: vi.fn(), executable: vi.fn(async (path: string) => path) }))
vi.mock('electron', () => ({
  app: { getAppPath: () => '/app', getVersion: () => 'test', getPath: (name: string) => name === 'temp' ? mocks.directory : join(mocks.directory, 'preferences'), isPackaged: true },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => Promise<any>) => mocks.handlers.set(name, handler) },
  dialog: { showMessageBox: mocks.confirm, showSaveDialog: mocks.save }, nativeTheme: {}, shell: { openExternal: mocks.external }
}))
vi.mock('./binary', () => ({ discoverBinary: async () => ({ path: '/approved/bingo', source: 'test' }), executable: mocks.executable, workspaceDirectory: async (path: string) => path }))
vi.mock('./provider-setup', async (original) => ({ ...await original<typeof import('./provider-setup')>(), configureProvider: mocks.setup }))
import { DesktopIpc } from './ipc'
import { DESKTOP_IPC } from '../../shared/desktop'
import { PreferencesStore } from './preferences'
import type { RuntimePool } from './runtime-pool'
import { DesktopFailure } from './rpc-client'
import { rejectedSelections, rejectedAgentPages } from '../../shared/desktop.fixtures'
import type { BrowserWindow } from 'electron'

async function harness(workspace: string | null = '/approved/project') {
  const frame = { url: 'file:///app/index.html' }
  const contents = { mainFrame: frame }
  const window = { isDestroyed: () => false, webContents: contents }
  const preferences = new PreferencesStore(join(mocks.directory, 'preferences'))
  await preferences.load()
  if (workspace) await preferences.save({ workspace })
  let connected = { hostId: 'connected-host', busy: false, status: 'ready', binary: '/approved/bingo', workspace, connectionId: 'connected' }
  const runtime = { busy: false, connection: { hostId: 'host', busy: false, status: 'ready', binary: '/approved/bingo', workspace, connectionId: 'connection' },
    get selectedConnection() { return this.connection }, get connections() { return [this.connection] }, get selection() { return { hostId: this.connection.hostId, connectionId: this.connection.connectionId, sessionId: null } },
    getConnection: (id: string) => id === connected.connectionId ? connected : runtime.connection,
    getHost: (input: { hostId: string; connectionId: string }) => {
      if (input.hostId !== runtime.connection.hostId || input.connectionId !== runtime.connection.connectionId) throw new DesktopFailure('STALE_CONNECTION', 'stale')
      return { ...runtime.connection, busy: runtime.busy }
    }, isLive: () => true,
    reconnect: vi.fn(async (input: { hostId: string; connectionId: string }) => { runtime.getHost(input); return runtime.connection }),
    closeHost: vi.fn(async () => {}), selectConversation: vi.fn(), waitForClose: vi.fn(async () => {}),
    referenceFor: vi.fn((input: {hostId:string;connectionId:string;session:string;totalBytes:number;checksum:string}) => ({ ...input })), holdDelivery: vi.fn(() => vi.fn()), readCorePart: vi.fn(),
    request: vi.fn(async () => ({})), connect: vi.fn(async (binary: string, cwd: string) => {
      connected = { ...connected, binary, workspace: cwd }; return connected
    }), close: vi.fn(async () => {}), deleteSession: vi.fn(async () => {}) }
  const ipc = new DesktopIpc({ window: () => window as unknown as BrowserWindow, documentUrl: frame.url, preferences: preferences as unknown as PreferencesStore, runtime: runtime as unknown as RuntimePool })
  await ipc.initialize()
  const event = { sender: contents, senderFrame: frame }
  const invoke = (channel: string, input?: unknown, sender = event) => mocks.handlers.get(channel)!(sender, input)
  return { ipc, runtime, invoke, event, preferences }
}
beforeEach(async () => {
  mocks.directory = await realpath(await mkdtemp(join(tmpdir(), 'rei-ipc-test-')))
  mocks.handlers.clear(); mocks.confirm.mockReset().mockResolvedValue({ response: 0 }); mocks.save.mockReset().mockResolvedValue({ canceled: true }); mocks.setup.mockReset().mockResolvedValue(undefined); mocks.external.mockReset(); mocks.executable.mockReset().mockImplementation(async (path: string) => path)
})
afterEach(async () => { await rm(mocks.directory, { recursive: true, force: true }) })
describe('registered IPC handlers', () => {
  it('waits for the old renderer close barrier before publishing a fresh bootstrap', async () => {
    const { invoke, runtime } = await harness()
    let release!: () => void
    runtime.waitForClose.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    let settled = false
    const bootstrap = invoke(DESKTOP_IPC.bootstrap).then(value => { settled = true; return value })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    expect(await bootstrap).toMatchObject({ ok: true })
    expect(await invoke(DESKTOP_IPC.connect, { workspace: '/approved/project' })).toMatchObject({ ok: true })
  })
  it('keeps old pending work stale after failed navigation admission recovers, while fresh bootstrap/ensure work', async () => {
    const { invoke, runtime, ipc } = await harness()
    let release!: (value: string) => void
    mocks.executable.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve }))
    const connecting = invoke(DESKTOP_IPC.connect, { workspace: '/approved/project' })
    ipc.invalidateRenderer()
    ipc.rendererReady() // Failed navigation left the trusted original document alive.
    release('/approved/bingo')
    expect(await connecting).toMatchObject({ ok: false, error: { code: 'STALE_RENDERER' } })
    expect(runtime.connect).not.toHaveBeenCalled()
    expect(await invoke(DESKTOP_IPC.bootstrap)).toMatchObject({ ok: true })
    expect(await invoke(DESKTOP_IPC.connect, { workspace: '/approved/project' })).toMatchObject({ ok: true })
  })
  it.each(['connect', 'reconnect'] as const)('rechecks global provider setup after delayed %s path validation', async method => {
    const { invoke, runtime } = await harness()
    let validate!: (path: string) => void, saved!: () => void
    mocks.executable.mockImplementationOnce(() => new Promise<string>(resolve => { validate = resolve }))
    const pending = invoke(DESKTOP_IPC[method], method === 'connect' ? { workspace: '/approved/project' } : { hostId: 'host', connectionId: 'connection' })
    mocks.confirm.mockResolvedValue({ response: 1 })
    mocks.setup.mockImplementationOnce(() => new Promise<void>(resolve => { saved = resolve }))
    const setup = invoke(DESKTOP_IPC.configureProvider, { name: 'test', protocol: 'openai', baseUrl: '', apiKey: '' })
    await vi.waitFor(() => expect(mocks.setup).toHaveBeenCalledOnce())
    validate('/approved/bingo')
    const result = await pending
    saved(); await setup
    expect(result).toMatchObject({ ok: false, error: { code: 'SETUP_IN_PROGRESS' } })
    expect(runtime[method]).not.toHaveBeenCalled()
  })
  it('refuses old-document requests between navigation start and new document commit', async () => {
    const { invoke, runtime, ipc } = await harness()
    ipc.invalidateRenderer()
    expect(await invoke(DESKTOP_IPC.connect, { workspace: '/approved/project' })).toMatchObject({ ok: false, error: { code: 'STALE_RENDERER' } })
    expect(runtime.connect).not.toHaveBeenCalled()
    ipc.rendererReady()
    expect(await invoke(DESKTOP_IPC.connect, { workspace: '/approved/project' })).toMatchObject({ ok: true })
  })
  it('bootstraps the host registry and selection without a competing legacy connection field', async () => {
    const { invoke } = await harness()
    const { value } = await invoke(DESKTOP_IPC.bootstrap)
    expect(value).not.toHaveProperty('connection')
    expect(value.connections).toHaveLength(1)
    expect(value.connections[0]).toMatchObject({ hostId: 'host', busy: false })
    expect(value.selection).toEqual({ hostId: 'host', connectionId: 'connection', sessionId: null })
    expect(value.agentPages).toEqual([])
  })
  it('preserves sender admission for all new selection/page/lifetime APIs using shared hostile fixtures', async () => {
    const { invoke, runtime } = await harness()
    const untrusted = { sender: {} as any, senderFrame: null as any }
    for (const { input } of rejectedSelections) expect(await invoke(DESKTOP_IPC.selectConversation, input, untrusted)).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
    for (const { input } of rejectedAgentPages) expect(await invoke(DESKTOP_IPC.openAgentPage, input, untrusted)).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
    for (const channel of [DESKTOP_IPC.reconnect, DESKTOP_IPC.closeHost]) expect(await invoke(channel, { hostId: 'host', connectionId: 'connection' }, untrusted)).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
    expect(runtime.selectConversation).not.toHaveBeenCalled(); expect(runtime.closeHost).not.toHaveBeenCalled(); expect(runtime.reconnect).not.toHaveBeenCalled()
  })
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
  it('ensures another project without stopping work, prompting, or changing selection', async () => {
    const { invoke, runtime, preferences } = await harness()
    runtime.busy = true
    expect(await invoke(DESKTOP_IPC.connect, {})).toMatchObject({ ok: true })
    expect(runtime.connect).toHaveBeenCalledOnce()
    expect(runtime.close).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(preferences.preferences.workspace).toBe('/approved/project')
    expect(runtime.selection.hostId).toBe('host')
  })
  it('revalidates scratch after targeted reconnect approval before replacing the host', async () => {
    const { invoke, runtime } = await harness()
    const scratch = (await invoke(DESKTOP_IPC.bootstrap)).value.scratchWorkspace
    runtime.connection = (await invoke(DESKTOP_IPC.connect, {})).value
    runtime.connect.mockClear()
    const outside = join(mocks.directory, 'outside')
    await mkdir(outside)
    runtime.busy = true
    mocks.confirm.mockImplementation(async () => {
      await rm(scratch, { recursive: true })
      await symlink(outside, scratch, process.platform === 'win32' ? 'junction' : 'dir')
      return { response: 1 }
    })
    expect(await invoke(DESKTOP_IPC.reconnect, { hostId: runtime.connection.hostId, connectionId: runtime.connection.connectionId })).toMatchObject({ ok: false, error: { code: 'UNSAFE_SCRATCH_WORKSPACE' } })
    expect(runtime.reconnect).not.toHaveBeenCalled()
  })
  it('does not apply stop approval to a different connection', async () => {
    const { invoke, runtime } = await harness()
    runtime.busy = true
    mocks.confirm.mockImplementation(async () => {
      runtime.connection = { ...runtime.connection, connectionId: 'replacement' }
      return { response: 1 }
    })
    expect(await invoke(DESKTOP_IPC.reconnect, { hostId: 'host', connectionId: 'connection' })).toMatchObject({ ok: false, error: { code: 'STALE_CONNECTION' } })
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
  it('requires trusted native source and Save authorization before raw-reference export writes', async () => {
    const { invoke, runtime } = await harness()
    const input = { transferId: 'save-1', hostId: 'host', connectionId: 'connection', session: 's', kind: 'item', item: 'i', generation: 0, token: 'core-token', totalBytes: 5, checksum: 'a430d84680aabd0b', suggestedName: 'recorded.json' }
    expect(await invoke(DESKTOP_IPC.exportReference, { ...input, destination: '/etc/private' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(await invoke(DESKTOP_IPC.exportReference, input, { sender: {} as any, senderFrame: null as any })).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
    expect(mocks.save).not.toHaveBeenCalled()
    expect(await invoke(DESKTOP_IPC.exportReference, input)).toEqual({ ok: true, value: false })
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(runtime.readCorePart).not.toHaveBeenCalled()
  })
  it('never returns opt-in snapshots, history or session heads through the old unacknowledged invoke bridge', async () => {
    const { invoke, runtime } = await harness()
    const inputs = [
      { method: 'session/list', params: {} },
      { method: 'session/listHeads', params: { filter: { cwd: '/approved/project' }, maxBytes: 4096 } },
      { method: 'session/open', params: { selector: { kind: 'byId', id: 's' }, options: { maxSnapshotBytes: 4096 } } },
      { method: 'session/history', params: { session: 's', page: { maxBytes: 4096 } } },
      { method: 'session/children', params: { parent: 's', maxBytes: 4096 } }
    ]
    for (const input of inputs) expect(await invoke(DESKTOP_IPC.request, { connectionId: 'connection', ...input })).toMatchObject({ ok: false, error: { code: 'BOUNDED_REQUIRED' } })
    expect(runtime.request).not.toHaveBeenCalled()
    const invalid = await invoke(DESKTOP_IPC.requestBounded, { transferId: 'x', hostId: 'host', request: { connectionId: 'connection', method: 'session/submit', params: {} } })
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
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
    expect(await invoke(DESKTOP_IPC.reconnect, { hostId: 'host', connectionId: 'connection', force: true })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(await invoke(DESKTOP_IPC.reconnect, { hostId: 'host', connectionId: 'connection' })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
    expect(runtime.reconnect).not.toHaveBeenCalled()
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
