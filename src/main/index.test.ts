import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ background: false, loadingMainFrame: false, trustedDocument: true, ipcReady: vi.fn(), ipcInvalidated: vi.fn(), contents: undefined as unknown as EventEmitter, window: undefined as unknown as EventEmitter, options: {} as Electron.BrowserWindowConstructorOptions, handlers: new Map<string, () => void>(), reset: vi.fn(), close: vi.fn(async () => {}), show: vi.fn(), focus: vi.fn(), maximize: vi.fn(), guard: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: { isPackaged: true, requestSingleInstanceLock: () => true, on: (name: string, fn: () => void) => state.handlers.set(name, fn), isReady: () => true, whenReady: () => Promise.resolve(), getPath: () => '/isolated', name: 'Rei' },
    BrowserWindow: class extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), { mainFrame: { url: 'file:///app/index.html' }, isDestroyed: () => false, isLoadingMainFrame: () => state.loadingMainFrame, session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }, setWindowOpenHandler: vi.fn() })
      constructor(options: Electron.BrowserWindowConstructorOptions) { super(); state.contents = this.webContents; state.window = this; state.options = options }
      loadURL = async () => {}
      isDestroyed = () => false
      isMinimized = () => false
      show = state.show
      focus = state.focus
      maximize = state.maximize
    },
    dialog: { showErrorBox: vi.fn(), showMessageBox: () => new Promise(() => {}) },
    Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
    nativeTheme: { shouldUseDarkColors: false }, screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { width: 1440, height: 900 } }) }, shell: {}
  }
})
vi.mock('./background-test-mode', async original => ({ ...await original<typeof import('./background-test-mode')>(), backgroundTestEnabled: () => state.background, installBackgroundTestGuards: state.guard }))
vi.mock('./desktop/event-delivery', () => ({ EventDelivery: class { reset = state.reset; send = vi.fn(); recover = vi.fn() } }))
vi.mock('./desktop/runtime-pool', () => ({ RuntimePool: class { close = state.close } }))
vi.mock('./desktop/preferences', () => ({ restoreBounds: () => ({ width: 1200, height: 900, x: 0, y: 0, maximized: true }), PreferencesStore: class { preferences = { theme: 'system' }; load = async () => {} } }))
vi.mock('./desktop/security', () => ({ allowsClipboardWrite: vi.fn(() => true), externalUrl: vi.fn(), sameDocument: () => state.trustedDocument }))
vi.mock('./desktop/ipc', () => ({ DesktopIpc: class { initialize = async () => {}; flushExports = async () => {}; invalidateRenderer = state.ipcInvalidated; rendererReady = state.ipcReady; observeRuntimeEvent = vi.fn() }, confirmStop: vi.fn() }))
vi.mock('./desktop/panels', () => ({ Panels: class {} }))
vi.mock('./desktop/review', () => ({ Review: class {} }))
vi.mock('./desktop/agent-browser', () => ({ AgentBrowser: class {} }))

async function boot(background: boolean) {
  vi.resetModules(); vi.clearAllMocks(); state.handlers.clear(); state.background = background; state.loadingMainFrame = false; state.trustedDocument = true
  state.contents = undefined as unknown as EventEmitter
  await import('./index')
  await vi.waitFor(() => expect(state.contents).toBeDefined())
}
describe('renderer lifetime', () => {
  beforeEach(() => boot(false))
  it('retains IPC accounting if main-frame navigation starts but fails or is cancelled', () => {
    state.contents.emit('did-start-navigation', {}, 'file:///app/index.html', false, true)
    state.contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'file:///app/index.html', true)
    expect(state.close).toHaveBeenCalledOnce()
    expect(state.reset).not.toHaveBeenCalled()
    expect(state.ipcInvalidated).toHaveBeenCalledOnce()
    expect(state.ipcReady).toHaveBeenCalledOnce()
  })
  it('waits until failed provisional navigation stops loading before restoring the old document admission', () => {
    state.loadingMainFrame = true
    state.contents.emit('did-start-navigation', {}, 'file:///app/index.html', false, true)
    state.contents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'file:///app/index.html', true)
    state.contents.emit('did-stop-loading')
    expect(state.ipcReady).not.toHaveBeenCalled()
    state.loadingMainFrame = false
    state.contents.emit('did-stop-loading')
    expect(state.ipcReady).toHaveBeenCalledOnce()
    expect(state.reset).not.toHaveBeenCalled()
  })
  it('does not restore admission for a redirect still navigating or an untrusted surviving document', () => {
    state.loadingMainFrame = true
    state.contents.emit('did-start-navigation', {}, 'file:///app/index.html', false, true)
    state.contents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'file:///app/index.html', true)
    state.contents.emit('did-start-navigation', {}, 'file:///app/index.html?next', false, true)
    state.loadingMainFrame = false
    state.contents.emit('did-stop-loading')
    expect(state.ipcReady).not.toHaveBeenCalled()
    state.trustedDocument = false
    state.contents.emit('did-fail-load', {}, -2, 'FAILED', 'file:///app/index.html?next', true)
    state.contents.emit('did-stop-loading')
    expect(state.ipcReady).not.toHaveBeenCalled()
    expect(state.reset).not.toHaveBeenCalled()
  })
  it('resets only when a new main-frame document commits, not in-page or subframe navigation', () => {
    state.contents.emit('did-start-navigation', {}, 'file:///app/index.html#hash', true, true)
    state.contents.emit('did-start-navigation', {}, 'about:blank', false, false)
    state.contents.emit('did-frame-navigate', {}, 'about:blank', 200, 'OK', false)
    expect(state.close).not.toHaveBeenCalled()
    expect(state.reset).not.toHaveBeenCalled()
    state.contents.emit('did-navigate', {}, 'file:///app/index.html', 200, 'OK')
    expect(state.reset).toHaveBeenCalledOnce()
  })
  it('disconnects then releases outstanding IPC when the renderer process is gone', () => {
    state.contents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(state.close).toHaveBeenCalledOnce()
    expect(state.reset).toHaveBeenCalledOnce()
    expect(state.close.mock.invocationCallOrder[0]).toBeLessThan(state.reset.mock.invocationCallOrder[0])
  })
  it('retains normal production show, activation and restored maximization', () => {
    state.window.emit('ready-to-show'); state.handlers.get('activate')!()
    expect(state.show).toHaveBeenCalledTimes(2)
    expect(state.focus).toHaveBeenCalledOnce()
    expect(state.maximize).toHaveBeenCalledOnce()
    expect(state.guard).not.toHaveBeenCalled()
  })
})
describe('background E2E window wiring', () => {
  beforeEach(() => boot(true))
  it('never shows, focuses or maximizes on ready, activation or second instance', () => {
    state.window.emit('ready-to-show'); state.handlers.get('activate')!(); state.handlers.get('second-instance')!()
    expect(state.guard).toHaveBeenCalledOnce()
    expect(state.show).not.toHaveBeenCalled()
    expect(state.focus).not.toHaveBeenCalled()
    expect(state.maximize).not.toHaveBeenCalled()
    expect(state.options).toMatchObject({ show: false, focusable: false, paintWhenInitiallyHidden: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, focusOnNavigation: false, disableDialogs: true } })
  })
  it('denies native clipboard writes even from a document trusted by the production policy', () => {
    const contents = state.contents as EventEmitter & { session: { setPermissionRequestHandler: ReturnType<typeof vi.fn>; setPermissionCheckHandler: ReturnType<typeof vi.fn> } }
    const respond = vi.fn()
    contents.session.setPermissionRequestHandler.mock.calls[0][0](contents, 'clipboard-sanitized-write', respond, {})
    expect(respond).toHaveBeenCalledWith(false)
    expect(contents.session.setPermissionCheckHandler.mock.calls[0][0](contents, 'clipboard-sanitized-write', '', {})).toBe(false)
  })
})
