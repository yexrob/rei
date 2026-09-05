import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => Promise<any>>(), views: [] as any[], session: null as any, partition: vi.fn(), external: vi.fn(), spawn: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    ipcMain: { handle: (channel: string, callback: (...args: any[]) => Promise<any>) => mocks.handlers.set(channel, callback), removeHandler: (channel: string) => mocks.handlers.delete(channel) },
    shell: { openExternal: mocks.external },
    session: { fromPartition: (name: string) => { mocks.partition(name); return mocks.session } },
    WebContentsView: class {
      options: any
      bounds: any
      visible = false
      webContents = Object.assign(new EventEmitter(), {
        url: '', title: '', loading: false, destroyed: false, popup: null as any,
        navigationHistory: { canGoBack: vi.fn(() => false), canGoForward: vi.fn(() => false), goBack: vi.fn(), goForward: vi.fn() },
        getURL() { return this.url }, getTitle() { return this.title }, isLoading() { return this.loading }, isDestroyed() { return this.destroyed },
        loadURL: vi.fn(async (url: string) => { this.webContents.url = url }),
        setWindowOpenHandler: (handler: unknown) => { this.webContents.popup = handler },
        reload: vi.fn(), stop: vi.fn(), focus: vi.fn(),
        close: vi.fn(() => { this.webContents.destroyed = true })
      })
      constructor(options: any) { this.options = options; mocks.views.push(this) }
      setBounds(bounds: any) { this.bounds = bounds }
      setVisible(visible: boolean) { this.visible = visible }
      getVisible() { return this.visible }
    }
  }
})
vi.mock('node-pty', () => ({ spawn: mocks.spawn }))
vi.mock('../binary', () => ({ workspaceDirectory: async (path: string) => path }))
import { Panels } from './index'
import { PANELS_IPC } from '../../../shared/panels'

const owners: Panels[] = []
function harness() {
  const frame = { url: 'file:///app/index.html' }
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false, getZoomFactor: () => 1.5, focus: vi.fn(), send: vi.fn() })
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: contents, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, getContentBounds: () => ({ x: 80, y: 50, width: 900, height: 700 }) })
  const panels = new Panels({ window: () => window as unknown as BrowserWindow, documentUrl: frame.url, workspace: () => '/approved' })
  owners.push(panels)
  const event = { sender: contents, senderFrame: frame }
  const invoke = (channel: string, input?: unknown, sender: any = event) => mocks.handlers.get(channel)!(sender, input)
  return { panels, window, contents, frame, event, invoke }
}
beforeEach(() => {
  vi.useFakeTimers()
  mocks.handlers.clear(); mocks.views.length = 0; mocks.partition.mockClear(); mocks.external.mockReset().mockResolvedValue(undefined)
  mocks.session = Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn() } })
  let exit: ((event: { exitCode: number }) => void) | null = null
  mocks.spawn.mockReset().mockReturnValue({ write: vi.fn(), resize: vi.fn(), kill: vi.fn(() => exit?.({ exitCode: 0 })), pause: vi.fn(), resume: vi.fn(), onData: vi.fn(() => ({ dispose: vi.fn() })), onExit: vi.fn((callback) => { exit = callback; return { dispose: vi.fn() } }) })
})
afterEach(async () => { for (const owner of owners.splice(0)) await owner.close(); vi.useRealTimers() })
describe('production Panels registration with mocked Electron/PTY natives', () => {
  it('registers only the typed allowlist and rejects foreign/subframe/navigated senders on every channel', async () => {
    const h = harness()
    expect(mocks.handlers.size).toBe(9)
    for (const channel of mocks.handlers.keys()) {
      for (const sender of [{ sender: {}, senderFrame: h.frame }, { sender: h.contents, senderFrame: { url: h.frame.url } }, { sender: h.contents, senderFrame: null }]) {
        expect(await h.invoke(channel, undefined, sender)).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
      }
    }
    h.frame.url = 'https://foreign.test/'
    expect(await h.invoke(PANELS_IPC.snapshot)).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.views).toHaveLength(0)
  })
  it('rejects custom shell/cwd/env and malformed bounds without native effects', async () => {
    const h = harness()
    expect(await h.invoke(PANELS_IPC.terminalStart, { shell: '/bin/evil', cwd: '/elsewhere', env: { SECRET: 'test-only' } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(await h.invoke(PANELS_IPC.browserLayout, { visible: true, bounds: { x: 0, y: 0, width: -1, height: 100 } })).toMatchObject({ ok: false })
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.views).toHaveLength(0)
  })
  it('wires the WebContentsView boundary with persistent isolated session, no preload and denied permissions/downloads', async () => {
    const h = harness()
    await h.invoke(PANELS_IPC.browserNavigate, 'https://example.test/')
    const view = mocks.views[0]
    expect(mocks.partition).toHaveBeenCalledWith('persist:rei-browser')
    expect(view.options.webPreferences).toMatchObject({ session: mocks.session, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, devTools: false, disableDialogs: true })
    expect(view.options.webPreferences).not.toHaveProperty('preload')
    const answer = vi.fn()
    mocks.session.setPermissionRequestHandler.mock.calls[0][0](view.webContents, 'media', answer)
    expect(answer).toHaveBeenCalledWith(false)
    expect(mocks.session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false)
    expect(mocks.session.setDevicePermissionHandler.mock.calls[0][0]()).toBe(false)
    const download = { preventDefault: vi.fn() }
    mocks.session.emit('will-download', download)
    expect(download.preventDefault).toHaveBeenCalledOnce()
  })
  it('denies unsafe top-level, frame, redirect, popup and native request schemes', async () => {
    const h = harness()
    expect(await h.invoke(PANELS_IPC.browserNavigate, 'file:///private/data')).toMatchObject({ ok: false })
    await h.invoke(PANELS_IPC.browserNavigate, 'https://example.test/')
    const contents = mocks.views[0].webContents
    for (const type of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
      const event = { url: 'file:///private/data', preventDefault: vi.fn() }
      contents.emit(type, event, event.url)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
    const initialLoads = contents.loadURL.mock.calls.length
    for (const url of ['file:///private/data', 'javascript:alert(1)', 'data:text/html,hello', 'about:blank', 'mailto:user@example.test']) expect(contents.popup({ url })).toEqual({ action: 'deny' })
    expect(contents.loadURL).toHaveBeenCalledTimes(initialLoads)
    expect(mocks.external).not.toHaveBeenCalled()
    const request = mocks.session.webRequest.onBeforeRequest.mock.calls[0][0]
    for (const url of ['file:///private/data', 'custom:launch', 'data:text/html,hello', 'blob:https://example.test/id']) {
      const answer = vi.fn(); request({ url, resourceType: 'mainFrame' }, answer); expect(answer).toHaveBeenCalledWith({ cancel: true })
    }
    const allowed = vi.fn(); request({ url: 'data:image/png;base64,AA==', resourceType: 'image' }, allowed)
    expect(allowed).toHaveBeenCalledWith({ cancel: false })
  })
  it('routes HTTP popups into the same view and exposes navigation state/actions only', async () => {
    const h = harness()
    h.panels.openBrowser('http://localhost:3000/')
    expect(h.contents.send).toHaveBeenCalledWith(PANELS_IPC.event, { type: 'browser-open', url: 'http://localhost:3000/' })
    const contents = mocks.views[0].webContents
    expect(contents.popup({ url: 'https://example.test/next' })).toEqual({ action: 'deny' })
    expect(mocks.views).toHaveLength(1)
    expect(contents.loadURL).toHaveBeenLastCalledWith('https://example.test/next')
    contents.navigationHistory.canGoBack.mockReturnValue(true); contents.title = 'Foreign page'; contents.loading = true
    contents.emit('page-title-updated')
    expect((await h.invoke(PANELS_IPC.snapshot)).value.browser).toMatchObject({ title: 'Foreign page', canGoBack: true, loading: true })
    await h.invoke(PANELS_IPC.browserAction, 'back'); expect(contents.navigationHistory.goBack).toHaveBeenCalledOnce()
    await h.invoke(PANELS_IPC.browserAction, 'reload'); expect(contents.reload).toHaveBeenCalledOnce()
    await h.invoke(PANELS_IPC.browserAction, 'stop'); expect(contents.stop).toHaveBeenCalledOnce()
    await h.invoke(PANELS_IPC.browserAction, 'open-external'); expect(mocks.external).toHaveBeenCalledWith('https://example.test/next')
    expect(await h.invoke(PANELS_IPC.browserAction, 'executeJavaScript')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  })
  it('maps zoomed bounds and hides the browser for DOM layout, main occlusion and navigation', async () => {
    const h = harness()
    await h.invoke(PANELS_IPC.browserNavigate, 'https://example.test/')
    const layout = { visible: true, bounds: { x: 300, y: 60, width: 600, height: 500 } }
    await h.invoke(PANELS_IPC.browserLayout, layout)
    const view = mocks.views[0]
    expect(view.bounds).toEqual({ x: 450, y: 90, width: 450, height: 610 })
    expect(view.visible).toBe(true)
    h.panels.setBrowserOccluded(true); expect(view.visible).toBe(false)
    await h.invoke(PANELS_IPC.browserLayout, layout); expect(view.visible).toBe(false)
    h.panels.setBrowserOccluded(false); expect(view.visible).toBe(true)
    await h.invoke(PANELS_IPC.browserLayout, { ...layout, visible: false }); expect(view.visible).toBe(false)
    await h.invoke(PANELS_IPC.browserLayout, layout)
    h.contents.emit('did-start-navigation', {}, 'file:///app/index.html', false, true)
    expect(view.visible).toBe(false)
  })
  it('allows keyboard focus recovery from the native view and sanitizes load errors', async () => {
    const h = harness(); await h.invoke(PANELS_IPC.browserNavigate, 'https://example.test/')
    const contents = mocks.views[0].webContents, event = { preventDefault: vi.fn() }
    contents.emit('before-input-event', event, { type: 'keyDown', key: 'F6' })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(h.contents.focus).toHaveBeenCalledOnce()
    expect(h.contents.send).toHaveBeenCalledWith(PANELS_IPC.event, { type: 'browser-focus-address' })
    contents.emit('did-fail-load', {}, -2, 'test-only-secret', 'https://example.test/private', true)
    expect((await h.invoke(PANELS_IPC.snapshot)).value.browser.error).toBe('This page could not be loaded. Check the address and try again.')
  })
  it('does not report an aborted navigation as a page failure', async () => {
    const h = harness(); await h.invoke(PANELS_IPC.browserNavigate, 'https://example.test/')
    mocks.views[0].webContents.loadURL.mockRejectedValueOnce(Object.assign(new Error('aborted'), { code: 'ERR_ABORTED' }))
    await h.invoke(PANELS_IPC.browserNavigate, 'https://example.test/next')
    expect((await h.invoke(PANELS_IPC.snapshot)).value.browser.error).toBeNull()
  })
  it('kills the terminal when renderer dies, destroys native contents on quit and unregisters exactly once', async () => {
    const h = harness(); await h.invoke(PANELS_IPC.browserNavigate, 'https://example.test/')
    await h.invoke(PANELS_IPC.terminalStart)
    h.contents.emit('render-process-gone')
    expect(mocks.spawn.mock.results[0].value.kill).toHaveBeenCalledOnce()
    await h.panels.close(); await h.panels.close()
    expect(mocks.views[0].webContents.close).toHaveBeenCalledOnce()
    expect(h.window.contentView.removeChildView).toHaveBeenCalledOnce()
    expect(mocks.handlers.size).toBe(0)
  })
})
