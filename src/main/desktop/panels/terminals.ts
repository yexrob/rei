import type { PanelsEvent, TerminalState } from '../../../shared/panels'
import { DesktopFailure } from '../rpc-client'
import { PanelTerminal, type TerminalEvent } from './terminal'

const MAX_TERMINALS = 8
export class PanelTerminals {
  private readonly terminals = new Set<PanelTerminal>()
  private closing: Promise<void> | null = null
  constructor(private readonly options: { workspace(): string | null; emit(event: PanelsEvent): void }) {}

  snapshot(): TerminalState[] { return [...this.terminals].map((terminal) => terminal.snapshot()).filter((state) => state.id !== null) }
  get busy(): boolean { return [...this.terminals].some((terminal) => terminal.snapshot().status !== 'exited') }
  async start(): Promise<TerminalState> {
    if (this.closing) throw new DesktopFailure('PANELS_CLOSING', 'The desktop terminals are closing.')
    if (this.terminals.size >= MAX_TERMINALS) throw new DesktopFailure('TERMINAL_LIMIT', 'Up to eight terminal tabs can be open at once. Close one before starting another.')
    const terminal = new PanelTerminal({ workspace: this.options.workspace, emit: (event) => this.receive(terminal, event) })
    // Reserve before cwd validation yields so simultaneous requests cannot exceed the limit.
    this.terminals.add(terminal)
    try { return await terminal.start() }
    catch (error) { this.terminals.delete(terminal); throw error }
  }
  write(id: string, data: string): void { this.find(id).write(id, data) }
  resize(id: string, cols: number, rows: number): void { this.find(id).resize(id, cols, rows) }
  ack(id: string, sequence: number): void {
    // A buffered ACK can arrive after an exit has removed its terminal.
    this.lookup(id)?.ack(id, sequence)
  }
  async stop(id: string): Promise<void> {
    const terminal = this.find(id)
    await terminal.stop(id)
    this.remove(terminal)
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    const tasks = [...this.terminals].map(async (terminal) => { await terminal.close(); this.remove(terminal) })
    this.closing = Promise.allSettled(tasks).then((results) => {
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    }).finally(() => { this.closing = null })
    return this.closing
  }
  private lookup(id: string): PanelTerminal | undefined { return [...this.terminals].find((terminal) => terminal.snapshot().id === id) }
  private find(id: string): PanelTerminal {
    const terminal = this.lookup(id)
    if (!terminal) throw new DesktopFailure('STALE_TERMINAL', 'This terminal is no longer active.')
    return terminal
  }
  private receive(terminal: PanelTerminal, event: TerminalEvent): void {
    if (!this.terminals.has(terminal)) return
    if (event.type === 'terminal-data') { this.options.emit(event); return }
    if (event.state.status === 'exited' && !event.state.error) this.terminals.delete(terminal)
    this.emitStates()
  }
  private remove(terminal: PanelTerminal): void { if (this.terminals.delete(terminal)) this.emitStates() }
  private emitStates(): void { this.options.emit({ type: 'terminals', states: this.snapshot() }) }
}
