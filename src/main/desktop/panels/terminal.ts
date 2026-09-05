import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { spawn, type IPty, type IDisposable } from 'node-pty'
import type { PanelsEvent, TerminalState } from '../../../shared/panels'
import { workspaceDirectory } from '../binary'
import { DesktopFailure } from '../rpc-client'
import { terminalEnvironment } from './validation'

const CHUNK = 16 * 1024
const HIGH_WATER = 64 * 1024
const MAX_QUEUE = 1024 * 1024
const STOP_GRACE_MS = 200
const STOP_DEADLINE_MS = 2000
export class PanelTerminal {
  private pty: IPty | null = null
  private subscriptions: IDisposable[] = []
  private starting: Promise<TerminalState> | null = null
  private generation = 0
  private stopping: Promise<void> | null = null
  private resolveStop: (() => void) | null = null
  private rejectStop: ((error: Error) => void) | null = null
  private stopTimers: ReturnType<typeof setTimeout>[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private queued = ''
  private outstanding = new Map<number, number>()
  private inflight = 0
  private sequence = 0
  private paused = false
  private pendingExit: { exitCode: number } | null = null
  private state: TerminalState = { id: null, status: 'idle', cwd: null, exitCode: null, error: null }
  constructor(private readonly options: { workspace(): string | null; emit(event: PanelsEvent): void }) {}

  snapshot(): TerminalState { return { ...this.state } }
  start(): Promise<TerminalState> {
    if (this.pty) return Promise.resolve(this.snapshot())
    if (this.starting) return this.starting
    this.starting = this.launch().finally(() => { this.starting = null })
    return this.starting
  }
  private async launch(): Promise<TerminalState> {
    const generation = this.generation
    const workspace = this.options.workspace()
    if (!workspace) throw new DesktopFailure('NO_WORKSPACE', 'Open a workspace before starting the terminal.')
    const cwd = await workspaceDirectory(workspace)
    if (generation !== this.generation || this.options.workspace() !== workspace || cwd !== workspace) throw new DesktopFailure('WORKSPACE_CHANGED', 'The workspace changed. Start the terminal again.')
    this.clearDelivery()
    const platform = process.platform
    const shell = platform === 'win32'
      ? (process.env.ComSpec || process.env.COMSPEC || join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'))
      : (userInfo().shell || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh'))
    const env = terminalEnvironment(process.env, platform)
    if (platform !== 'win32') env.SHELL = shell
    let pty: IPty
    try { pty = spawn(shell, [], { name: 'xterm-256color', cols: 80, rows: 24, cwd, env }) }
    catch { throw new DesktopFailure('TERMINAL_START_FAILED', 'The local shell could not start. Check the workspace and terminal installation.') }
    this.pty = pty
    this.state = { id: randomUUID(), status: 'running', cwd, exitCode: null, error: null }
    this.subscriptions = [pty.onData((data) => {
      if (this.pty !== pty || this.stopping) return
      if (this.queued.length + data.length > MAX_QUEUE) { void this.stop(this.state.id!, 'Terminal output exceeded its safety limit. Start a new terminal.').catch(() => {}); return }
      this.queued += data
      this.updateFlow()
      this.schedule()
    }), pty.onExit(({ exitCode }) => {
      if (this.pty !== pty) return
      if (this.stopping) { this.finishExit(exitCode); return }
      this.pendingExit = { exitCode }
      this.schedule()
    })]
    this.emitState()
    return this.snapshot()
  }
  write(id: string, data: string): void { this.active(id).write(data) }
  resize(id: string, cols: number, rows: number): void { this.active(id).resize(cols, rows) }
  ack(id: string, sequence: number): void {
    if (id !== this.state.id) return
    const size = this.outstanding.get(sequence)
    if (size === undefined) return
    this.outstanding.delete(sequence)
    this.inflight -= size
    this.updateFlow()
    this.schedule()
  }
  async stop(id: string, error: string | null = null): Promise<void> {
    if (id !== this.state.id) throw new DesktopFailure('STALE_TERMINAL', 'This terminal is no longer active.')
    await this.terminate(error)
  }
  close(): Promise<void> {
    this.generation++
    return this.terminate(this.state.error)
  }
  private active(id: string): IPty {
    if (id !== this.state.id || !this.pty || this.pendingExit || this.stopping) throw new DesktopFailure('STALE_TERMINAL', 'This terminal is no longer active.')
    return this.pty
  }
  private emitState(): void { this.options.emit({ type: 'terminal', state: this.snapshot() }) }
  private schedule(): void { if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush() }, 16) }
  private flush(): void {
    if (!this.state.id) return
    while (this.queued && this.inflight < HIGH_WATER) {
      let length = Math.min(CHUNK, this.queued.length, HIGH_WATER - this.inflight)
      // Keep surrogate pairs together at chunk boundaries.
      const last = this.queued.charCodeAt(length - 1)
      if (last >= 0xd800 && last <= 0xdbff && length < this.queued.length) length--
      if (!length) break
      const data = this.queued.slice(0, length)
      this.queued = this.queued.slice(length)
      const sequence = ++this.sequence
      this.outstanding.set(sequence, data.length)
      this.inflight += data.length
      this.options.emit({ type: 'terminal-data', id: this.state.id, sequence, data })
    }
    this.updateFlow()
    if (this.pendingExit && !this.queued && !this.inflight) this.finishExit(this.pendingExit.exitCode)
  }
  private updateFlow(): void {
    if (!this.pty || this.pendingExit || this.stopping) return
    const size = this.queued.length + this.inflight
    if (!this.paused && size >= HIGH_WATER) { this.pty.pause(); this.paused = true }
    else if (this.paused && size < HIGH_WATER / 2) { this.pty.resume(); this.paused = false }
  }
  private clearDelivery(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.queued = ''
    this.outstanding.clear()
    this.inflight = 0
    this.sequence = 0
    this.paused = false
    this.pendingExit = null
  }
  private finishExit(exitCode: number): void {
    const resolve = this.resolveStop
    this.clearStop()
    for (const subscription of this.subscriptions) subscription.dispose()
    this.subscriptions = []
    this.pty = null
    this.clearDelivery()
    this.state = { ...this.state, status: 'exited', exitCode }
    this.emitState()
    resolve?.()
  }
  private clearStop(): void {
    for (const timer of this.stopTimers) clearTimeout(timer)
    this.stopTimers = []
    this.stopping = null
    this.resolveStop = null
    this.rejectStop = null
  }
  private terminate(error: string | null): Promise<void> {
    if (this.stopping) return this.stopping
    const pty = this.pty
    if (!pty) return Promise.resolve()
    if (this.pendingExit) { this.finishExit(this.pendingExit.exitCode); return Promise.resolve() }
    const paused = this.paused
    this.clearDelivery()
    this.state = { ...this.state, status: 'stopping', error }
    const task = new Promise<void>((resolve, reject) => { this.resolveStop = resolve; this.rejectStop = reject })
    this.stopping = task
    this.emitState()
    this.stopTimers.push(setTimeout(() => {
      if (this.pty !== pty || !this.stopping) return
      try { if (process.platform === 'win32') pty.kill(); else pty.kill('SIGKILL') } catch { /* The exit callback is the evidence, not a successful kill invocation. */ }
    }, STOP_GRACE_MS))
    this.stopTimers.push(setTimeout(() => {
      if (this.pty !== pty || !this.stopping) return
      const reject = this.rejectStop
      this.clearStop()
      // Keep the handle and exit listener: a failed stop must remain retryable.
      this.state = { ...this.state, status: 'running', error: 'The terminal did not stop. Try Stop again.' }
      this.emitState()
      reject?.(new DesktopFailure('TERMINAL_STOP_FAILED', 'The terminal did not stop. Try Stop again.'))
    }, STOP_DEADLINE_MS))
    try { if (paused) pty.resume(); pty.kill() } catch { /* Escalate after the grace period. */ }
    return task
  }
}
