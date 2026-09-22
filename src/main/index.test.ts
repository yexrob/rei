import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ contents: undefined as unknown as EventEmitter, reset: vi.fn(), close: vi.fn(async () => {}) }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: { isPackaged: true, requestSingleInstanceLock: () => true, on: vi.fn(), whenReady: () => Promise.resolve(), getPath: () => '/isolated', name: 'Rei' },
    BrowserWindow: class extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), { session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }, setWindowOpenHandler: vi.fn() })
      constructor() { super(); state.contents = this.webContents }
      loadURL = async () => {}
    },
    dialog: { showErrorBox: vi.fn(), showMessageBox: () => new Promise(() => {}) },
    Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
    nativeTheme: { shouldUseDarkColors: false }, screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { width: 1440, height: 900 } }) }, shell: {}
  }
})
vi.mock('./desktop/event-delivery', () => ({ EventDelivery: class { reset = state.reset; send = vi.fn(); recover = vi.fn() } }))
vi.mock('./desktop/runtime', () => ({ DesktopRuntime: class { close = state.close } }))
vi.mock('./desktop/preferences', () => ({ restoreBounds: () => null, PreferencesStore: class { preferences = { theme: 'system' }; load = async () => {} } }))
vi.mock('./desktop/security', () => ({ allowsClipboardWrite: vi.fn(), externalUrl: vi.fn(), sameDocument: () => true }))
vi.mock('./desktop/ipc', () => ({ DesktopIpc: class { initialize = async () => {} }, confirmStop: vi.fn() }))
vi.mock('./desktop/panels', () => ({ Panels: class {} }))
vi.mock('./desktop/review', () => ({ Review: class {} }))
vi.mock('./desktop/agent-browser', () => ({ AgentBrowser: class {} }))

beforeEach(async () => {
  vi.resetModules(); state.reset.mockClear(); state.close.mockClear()
  state.contents = undefined as unknown as EventEmitter
  await import('./index')
  await vi.waitFor(() => expect(state.contents).toBeDefined())
})
it('retains IPC accounting if main-frame navigation starts but fails or is cancelled', () => {
  state.contents.emit('did-start-navigation', {}, 'file:///app/index.html', false, true)
  state.contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'file:///app/index.html', true)
  expect(state.close).toHaveBeenCalledOnce()
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
