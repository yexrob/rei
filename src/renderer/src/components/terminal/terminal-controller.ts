import type { BingoPanelsApi, PanelsEvent, TerminalState } from '../../../../shared/panels'
import { TerminalInput } from './terminal-input'

export interface TerminalView {
  write(data: string, consumed: () => void): void
  activate(active: boolean): void
  focus(): void
  dispose(): void
}
export type TerminalViewHandlers = { input(data: string): void; resize(cols: number, rows: number): void }
export type TerminalTab = TerminalState & { number: number }
export type TerminalSnapshot = { tabs: TerminalTab[]; activeId: string | null; starting: boolean; ready: boolean; error: string | null }
type Entry = { view: TerminalView; input: TerminalInput; number: number; pending: number; overflowed: boolean }
type ViewFactory = (id: string, handlers: TerminalViewHandlers) => TerminalView
export const emptyTerminalSnapshot: TerminalSnapshot = { tabs: [], activeId: null, starting: false, ready: false, error: null }

export class TerminalController {
  private state: TerminalSnapshot = emptyTerminalSnapshot
  private entries = new Map<string, Entry>()
  private nextNumber = 1
  private visible = false
  private disposed = false
  private updated = false
  private pendingEmpty = false
  private launchOnReady = false
  private unsubscribe: (() => void) | null = null
  constructor(private readonly api: BingoPanelsApi, private readonly createView: ViewFactory, private readonly changed: (state: TerminalSnapshot) => void, private readonly onEmpty: () => void) {}

  snapshot(): TerminalSnapshot { return this.state }
  connect(): void {
    this.unsubscribe = this.api.onEvent((event) => this.receive(event))
    void this.load()
  }
  private async load(): Promise<void> {
    try {
      const result = await this.api.snapshot()
      if (this.disposed) return
      if (!result.ok) throw new Error(result.error.message)
      if (!this.updated) this.reconcile(result.value.terminals)
      this.publish({ ready: true })
      if (this.launchOnReady && !this.state.tabs.length) void this.start()
    } catch (error) { this.fail(error); this.publish({ ready: true }) }
  }
  private publish(update: Partial<TerminalSnapshot> = {}): void {
    if (this.disposed) return
    this.state = { ...this.state, ...update }
    this.changed(this.state)
  }
  private fail(error: unknown): void {
    this.publish({ error: error instanceof Error ? error.message : String(error) })
  }
  private receive(event: PanelsEvent): void {
    if (this.disposed) return
    if (event.type === 'terminals') { this.updated = true; this.reconcile(event.states) }
    if (event.type === 'terminal-data') this.output(event)
  }
  private ensure(id: string): Entry | undefined {
    const existing = this.entries.get(id)
    if (existing) return existing
    if (this.entries.size >= 8) { this.fail('Too many terminal buffers. Close a terminal and try again.'); return }
    const input = new TerminalInput(async (data) => {
      if (!this.running(id)) return
      const result = await this.api.terminalWrite({ id, data })
      if (!result.ok && result.error.code !== 'STALE_TERMINAL') throw new Error(result.error.message)
    }, (error) => this.fail(error))
    const view = this.createView(id, { input: (data) => { if (this.running(id)) input.push(data) }, resize: (cols, rows) => { void this.resize(id, cols, rows) } })
    const entry = { view, input, number: this.nextNumber++, pending: 0, overflowed: false }
    this.entries.set(id, entry)
    return entry
  }
  private running(id: string): boolean { return !this.disposed && this.state.tabs.some((tab) => tab.id === id && tab.status === 'running') }
  private async resize(id: string, cols: number, rows: number): Promise<void> {
    if (!this.running(id)) return
    try {
      const result = await this.api.terminalResize({ id, cols, rows })
      if (!result.ok && result.error.code !== 'STALE_TERMINAL' && this.running(id)) this.fail(result.error.message)
    } catch (error) { if (this.running(id)) this.fail(error) }
  }
  private output(event: Extract<PanelsEvent, { type: 'terminal-data' }>): void {
    const entry = this.ensure(event.id)
    if (!entry || entry.overflowed) return
    if (entry.pending + event.data.length > 1024 * 1024) {
      entry.overflowed = true
      this.fail('Terminal output exceeded its safety limit. Start a new terminal.')
      void this.close(event.id)
      return
    }
    entry.pending += event.data.length
    // The buffer exists synchronously, even when React has not painted the tab yet.
    entry.view.write(event.data, () => {
      if (this.disposed || this.entries.get(event.id) !== entry) return
      entry.pending -= event.data.length
      void this.api.terminalAck({ id: event.id, sequence: event.sequence }).catch((error: unknown) => this.fail(error))
    })
  }
  private reconcile(states: TerminalState[]): void {
    const previous = this.state.tabs
    const failedDelivery = previous.some((tab) => tab.id && this.entries.get(tab.id)?.overflowed)
    const ids = new Set(states.flatMap((state) => state.id ? [state.id] : []))
    for (const [id, entry] of this.entries) {
      if (!ids.has(id) && previous.some((tab) => tab.id === id)) { entry.input.dispose(); entry.view.dispose(); this.entries.delete(id) }
    }
    const tabs = states.flatMap((state) => {
      const entry = state.id ? this.ensure(state.id) : undefined
      return entry ? [{ ...state, number: entry.number }] : []
    })
    const oldIndex = previous.findIndex((tab) => tab.id === this.state.activeId)
    const activeId = tabs.some((tab) => tab.id === this.state.activeId) ? this.state.activeId : tabs[Math.max(0, Math.min(oldIndex, tabs.length - 1))]?.id ?? null
    const selectionChanged = activeId !== this.state.activeId
    this.publish({ tabs, activeId })
    this.activate()
    if (selectionChanged && this.visible && activeId) this.entries.get(activeId)?.view.focus()
    if (tabs.length) { this.pendingEmpty = false; this.launchOnReady = false }
    else if (previous.length) { this.pendingEmpty = !failedDelivery; this.closeEmpty() }
  }
  private closeEmpty(): void {
    if (!this.pendingEmpty || this.state.starting || this.disposed) return
    this.pendingEmpty = false
    this.onEmpty()
  }
  private activate(): void {
    for (const [id, entry] of this.entries) entry.view.activate(this.visible && id === this.state.activeId)
  }
  setVisible(visible: boolean): void {
    const opened = visible && !this.visible
    this.visible = visible
    if (opened) this.launchOnReady = true
    else if (!visible) this.launchOnReady = false
    this.activate()
    if (opened && this.state.activeId) this.entries.get(this.state.activeId)?.view.focus()
    if (opened && this.state.ready && !this.state.tabs.length) void this.start()
  }
  select(id: string): void {
    if (!this.state.tabs.some((tab) => tab.id === id)) return
    this.publish({ activeId: id })
    this.activate()
    if (this.visible) this.entries.get(id)?.view.focus()
  }
  async start(): Promise<void> {
    if (this.disposed || this.state.starting) return
    this.launchOnReady = false
    this.publish({ starting: true, error: null })
    try {
      const result = await this.api.terminalStart()
      if (this.disposed) {
        if (result.ok && result.value.id) await this.api.terminalStop(result.value.id)
        return
      }
      if (!result.ok) throw new Error(result.error.message)
      // Only native lists create tabs: a shell may already have exited before this response.
      if (result.value.id) this.select(result.value.id)
    } catch (error) { this.pendingEmpty = false; this.fail(error) }
    finally { this.publish({ starting: false }); this.closeEmpty() }
  }
  async close(id: string): Promise<void> {
    if (this.disposed) return
    if (!this.entries.get(id)?.overflowed) this.publish({ error: null })
    try {
      const result = await this.api.terminalStop(id)
      if (!result.ok) throw new Error(result.error.message)
    } catch (error) { this.select(id); this.fail(error) }
  }
  dispose(): void {
    this.disposed = true
    this.unsubscribe?.()
    for (const entry of this.entries.values()) { entry.input.dispose(); entry.view.dispose() }
    this.entries.clear()
  }
}
