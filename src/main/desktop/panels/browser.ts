import { session, shell, WebContentsView, type BrowserWindow } from 'electron'
import type { BrowserAction, BrowserLayout, BrowserState, PanelsEvent } from '../../../shared/panels'
import { externalUrl, sameDocument } from '../security'
import { allowedNavigation, nativeBounds } from './validation'

const PARTITION = 'persist:rei-browser'
const securedSessions = new WeakSet<Electron.Session>()
export class PanelBrowser {
  private view: WebContentsView | null = null
  private owner: BrowserWindow | null = null
  private occluded = false
  private layout: BrowserLayout = { visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 } }
  private state: BrowserState = { url: '', title: '', canGoBack: false, canGoForward: false, loading: false, error: null }
  private navigation = 0
  constructor(private readonly options: { window(): BrowserWindow | null; documentUrl: string; emit(event: PanelsEvent): void }) {}
  snapshot(): BrowserState { return { ...this.state } }
  open(url: string): void {
    const safe = externalUrl(url)
    this.options.emit({ type: 'browser-open', url: safe })
    this.navigate(safe)
  }
  navigate(url: string): void {
    const safe = externalUrl(url)
    const view = this.ensureView()
    if (!view) return
    const navigation = ++this.navigation
    this.state = { ...this.state, url: safe, loading: true, error: null }
    this.applyLayout()
    this.emitState()
    void view.webContents.loadURL(safe).catch((error: unknown) => {
      if (this.view !== view || view.webContents.isDestroyed() || navigation !== this.navigation) return
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_ABORTED') return
      this.state = { ...this.state, loading: false, error: 'This page could not be loaded. Check the address and try again.' }
      this.emitState()
    })
  }
  async action(action: BrowserAction): Promise<void> {
    const contents = this.view?.webContents
    if (!contents || contents.isDestroyed()) return
    switch (action) {
      case 'back': if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); break
      case 'forward': if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward(); break
      case 'reload': this.state.error = null; contents.reload(); break
      case 'stop': contents.stop(); break
      case 'open-external': await shell.openExternal(externalUrl(contents.getURL())); break
      case 'focus': if (this.visible()) contents.focus(); break
    }
  }
  setLayout(layout: BrowserLayout): void {
    this.layout = layout
    if (layout.visible) this.ensureView()
    this.applyLayout()
  }
  setOccluded(value: boolean): void { this.occluded = value; this.applyLayout() }
  hide(): void { this.layout = { ...this.layout, visible: false }; this.applyLayout() }
  close(): void {
    const view = this.view
    this.view = null
    if (view) {
      if (this.owner && !this.owner.isDestroyed()) this.owner.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false })
    }
    this.owner?.off('resize', this.applyLayout)
    this.owner?.off('closed', this.onWindowClosed)
    this.owner = null
    this.state = { url: '', title: '', canGoBack: false, canGoForward: false, loading: false, error: null }
  }
  private onWindowClosed = (): void => { this.close() }
  private visible(): boolean {
    const owner = this.options.window()
    return Boolean(this.layout.visible && !this.occluded && owner && !owner.isDestroyed() && sameDocument(owner.webContents.mainFrame.url, this.options.documentUrl))
  }
  private applyLayout = (): void => {
    const view = this.view, owner = this.owner
    if (!view || !owner || owner.isDestroyed() || view.webContents.isDestroyed()) return
    const bounds = nativeBounds(this.layout.bounds, owner.webContents.getZoomFactor(), owner.getContentBounds())
    const visible = this.visible() && Boolean(this.state.url) && bounds.width > 0 && bounds.height > 0
    if (!visible && view.getVisible()) owner.webContents.focus()
    view.setVisible(visible)
    if (visible) view.setBounds(bounds)
  }
  private ensureView(): WebContentsView | null {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view
    const owner = this.options.window()
    if (!owner || owner.isDestroyed()) return null
    const isolated = session.fromPartition(PARTITION)
    if (!securedSessions.has(isolated)) {
      securedSessions.add(isolated)
      isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      isolated.setPermissionCheckHandler(() => false)
      isolated.setDevicePermissionHandler(() => false)
      isolated.on('will-download', (event) => { event.preventDefault() })
      // Even scripted subresource fetches cannot reach local files or custom OS handlers.
      isolated.webRequest.onBeforeRequest((details, callback) => {
        let safe = false
        try { safe = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame'
          ? allowedNavigation(details.url)
          : ['http:', 'https:', 'ws:', 'wss:', 'blob:', 'data:'].includes(new URL(details.url).protocol)
        } catch { /* Reject malformed requests. */ }
        callback({ cancel: !safe })
      })
    }
    const view = new WebContentsView({ webPreferences: {
      session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webviewTag: false,
      webSecurity: true, allowRunningInsecureContent: false, devTools: false, disableDialogs: true
      // Deliberately no preload: foreign content never receives either desktop bridge.
    } })
    this.view = view
    this.owner = owner
    view.setVisible(false)
    owner.contentView.addChildView(view)
    owner.on('resize', this.applyLayout)
    owner.on('closed', this.onWindowClosed)
    const contents = view.webContents
    const blocked = (): void => { this.state.error = 'Only HTTP and HTTPS pages can be opened here.'; this.emitState() }
    contents.on('will-navigate', (event, url) => { if (!allowedNavigation(url)) { event.preventDefault(); blocked() } })
    contents.on('will-redirect', (event, url) => { if (!allowedNavigation(url)) { event.preventDefault(); blocked() } })
    contents.on('will-frame-navigate', (event) => { if (!allowedNavigation(event.url)) { event.preventDefault(); blocked() } })
    contents.setWindowOpenHandler(({ url }) => {
      if (allowedNavigation(url)) this.navigate(url)
      else blocked()
      return { action: 'deny' }
    })
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F6') {
        event.preventDefault()
        owner.webContents.focus()
        this.options.emit({ type: 'browser-focus-address' })
      }
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('will-prevent-unload', (event) => event.preventDefault())
    contents.on('page-title-updated', () => this.readState())
    contents.on('did-start-loading', () => { this.state.error = null; this.readState() })
    contents.on('did-stop-loading', () => this.readState())
    contents.on('did-navigate', () => this.readState())
    contents.on('did-navigate-in-page', () => this.readState())
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (!mainFrame || code === -3) return
      this.state.error = 'This page could not be loaded. Check the address and try again.'
      this.readState()
    })
    contents.on('render-process-gone', () => {
      this.state = { ...this.state, loading: false, error: 'The browser page stopped. Reload to try again.' }
      this.emitState()
    })
    this.applyLayout()
    return view
  }
  private readState(): void {
    const contents = this.view?.webContents
    if (!contents || contents.isDestroyed()) return
    const url = contents.getURL()
    this.state = { ...this.state,
      url: allowedNavigation(url) ? url : this.state.url,
      title: contents.getTitle().slice(0, 512),
      canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward(), loading: contents.isLoading()
    }
    this.emitState()
  }
  private emitState(): void { this.options.emit({ type: 'browser', state: this.snapshot() }) }
}
