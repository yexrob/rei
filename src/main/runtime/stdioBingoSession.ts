import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cliEventSchema, clientCommandSchema, type CliEvent, type CliSessionMetadata, type ClientCommand, type PromptResponse } from '../../shared/contracts/cli'
import type { BingoSession, BingoSessionHandlers } from './bingoSession'
import { BingoCommandError } from './bingoSession'

const MAX_LINE_BYTES = 8 * 1024 * 1024
const STARTUP_TIMEOUT_MS = 10_000

export class StdioBingoSession implements BingoSession {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private expectedSeq = 1
  private ready: Promise<CliSessionMetadata> | null = null
  private resolveReady: ((metadata: CliSessionMetadata) => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null
  private closed = false
  private cancelTimer: NodeJS.Timeout | null = null
  private forceTimer: NodeJS.Timeout | null = null
  private exitPromise: Promise<void> | null = null
  private resolveExit: (() => void) | null = null
  private commandWaiters = new Map<string, { resolve: (event: CliEvent) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()

  constructor(
    private readonly binaryPath: string,
    private readonly cwd: string,
    private readonly handlers: BingoSessionHandlers,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  open(sessionId?: string): Promise<CliSessionMetadata> {
    if (this.child) throw new Error('Session is already open')
    const args = ['--json-events']
    if (sessionId) args.push('--session', sessionId)

    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })

    const child = spawn(this.binaryPath, args, {
      cwd: this.cwd,
      env: this.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    this.exitPromise = new Promise((resolve) => { this.resolveExit = resolve })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consume(chunk))
    child.on('error', (error) => this.fail(error))
    child.on('exit', (code, signal) => {
      this.child = null
      this.clearTerminationTimers()
      this.resolveExit?.()
      this.resolveExit = null
      if (this.closed) return
      const error = code === 0 ? null : new Error(`bingo exited before session close (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
      if (error) {
        for (const waiter of this.commandWaiters.values()) {
          clearTimeout(waiter.timer)
          waiter.reject(error)
        }
        this.commandWaiters.clear()
      }
      this.rejectReady?.(error ?? new Error('bingo exited before session.ready'))
      this.handlers.onExit(error)
    })

    const timer = setTimeout(() => this.fail(new Error('bingo did not emit session.ready within 10 seconds')), STARTUP_TIMEOUT_MS)
    void this.ready.then(() => clearTimeout(timer), () => clearTimeout(timer))
    return this.ready
  }

  sendTurn(turnId: string, prompt: string): Promise<void> {
    return this.write({ protocolVersion: 1, type: 'turn.start', commandId: randomUUID(), turnId, prompt })
  }

  async cancelTurn(turnId: string): Promise<void> {
    await this.write({ protocolVersion: 1, type: 'turn.cancel', commandId: randomUUID(), turnId })
    this.cancelTimer = setTimeout(() => {
      const child = this.child
      if (!child) return
      child.kill('SIGTERM')
      this.forceTimer = setTimeout(() => { if (this.child) this.child.kill('SIGKILL') }, 2_000)
    }, 750)
  }

  respondToPrompt(turnId: string, promptId: string, response: PromptResponse): Promise<void> {
    return this.write({ protocolVersion: 1, type: 'prompt.respond', commandId: randomUUID(), turnId, promptId, response })
  }

  async rename(name: string): Promise<CliSessionMetadata> {
    const event = await this.request({ protocolVersion: 1, type: 'session.rename', commandId: randomUUID(), name }, 'session.renamed')
    if (event.type !== 'session.renamed') throw new Error('Unexpected session.rename response')
    return event.metadata
  }

  async delete(): Promise<string> {
    const event = await this.request({ protocolVersion: 1, type: 'session.delete', commandId: randomUUID() }, 'session.deleted')
    if (event.type !== 'session.deleted') throw new Error('Unexpected session.delete response')
    await Promise.race([this.exitPromise ?? Promise.resolve(), new Promise<void>((resolve) => setTimeout(resolve, 500))])
    return event.deletedSessionId
  }

  async close(): Promise<void> {
    if (!this.child) return
    this.closed = true
    const exited = this.exitPromise ?? Promise.resolve()
    try {
      // The write callback may never fire once another close() ended stdin;
      // never let close() hang on it (SessionManager serializes opens, but
      // session:close can still race an in-flight open).
      await Promise.race([
        this.write({ protocolVersion: 1, type: 'session.close', commandId: randomUUID() }),
        new Promise<void>((resolve) => setTimeout(resolve, 500))
      ])
    } catch { /* terminate below */ }
    this.child?.stdin.end()
    const graceful = await Promise.race([exited.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000))])
    if (graceful || !this.child) return
    this.child.kill('SIGTERM')
    const terminated = await Promise.race([exited.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000))])
    if (!terminated && this.child) this.child.kill('SIGKILL')
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES && !this.buffer.includes('\n')) {
      this.fail(new Error('bingo emitted an oversized NDJSON record'))
      return
    }

    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.consumeLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private consumeLine(line: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      this.fail(new Error('bingo emitted malformed NDJSON'))
      return
    }

    const parsed = cliEventSchema.safeParse(raw)
    if (!parsed.success) {
      this.fail(new Error(`bingo emitted an invalid protocol event: ${parsed.error.message}`))
      return
    }

    const event = parsed.data
    if (event.seq !== this.expectedSeq) {
      this.fail(new Error(`bingo event sequence mismatch: expected ${this.expectedSeq}, received ${event.seq}`))
      return
    }
    this.expectedSeq += 1

    if (event.type === 'turn.completed' || event.type === 'turn.cancelled' || (event.type === 'error' && event.scope === 'turn')) {
      this.clearTerminationTimers()
    }
    if (event.type === 'session.ready') {
      this.resolveReady?.(event.metadata)
      this.resolveReady = null
      this.rejectReady = null
    }
    const commandId = 'commandId' in event ? event.commandId : undefined
    let consumed = false
    if (commandId) {
      const waiter = this.commandWaiters.get(commandId)
      if (waiter) {
        consumed = true
        clearTimeout(waiter.timer)
        this.commandWaiters.delete(commandId)
        if (event.type === 'error') waiter.reject(new BingoCommandError(event.code, event.msg, event.level, event.recoverable))
        else waiter.resolve(event)
      }
    }
    if (!consumed) this.handlers.onEvent(event)
  }

  private request(command: ClientCommand, expectedType: CliEvent['type']): Promise<CliEvent> {
    const commandId = command.commandId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.commandWaiters.delete(commandId)
        reject(new Error(`${command.type} did not complete within 10 seconds`))
      }, STARTUP_TIMEOUT_MS)
      this.commandWaiters.set(commandId, {
        resolve: (event) => event.type === expectedType ? resolve(event) : reject(new Error(`Expected ${expectedType}, received ${event.type}`)),
        reject,
        timer
      })
      void this.write(command).catch((error: unknown) => {
        clearTimeout(timer)
        this.commandWaiters.delete(commandId)
        reject(error instanceof Error ? error : new Error('Failed to write bingo command'))
      })
    })
  }

  private write(command: ClientCommand): Promise<void> {
    const parsed = clientCommandSchema.parse(command)
    const child = this.child
    if (!child?.stdin.writable) return Promise.reject(new Error('bingo session is not writable'))
    return new Promise((resolve, reject) => {
      child.stdin.write(`${JSON.stringify(parsed)}\n`, (error) => error ? reject(error) : resolve())
    })
  }

  private clearTerminationTimers(): void {
    if (this.cancelTimer) clearTimeout(this.cancelTimer)
    if (this.forceTimer) clearTimeout(this.forceTimer)
    this.cancelTimer = null
    this.forceTimer = null
  }

  private fail(error: Error): void {
    this.rejectReady?.(error)
    this.rejectReady = null
    this.resolveReady = null
    for (const waiter of this.commandWaiters.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.commandWaiters.clear()
    const child = this.child
    this.child = null
    this.clearTerminationTimers()
    this.resolveExit?.()
    this.resolveExit = null
    if (child && !child.killed) child.kill()
    this.handlers.onExit(error)
  }
}
