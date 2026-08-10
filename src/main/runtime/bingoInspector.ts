import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cliEventSchema, clientCommandSchema, type CliEvent, type CliInspectionMetadata, type ClientCommand } from '../../shared/contracts/cli'
import { BingoCommandError } from './bingoSession'

const TIMEOUT_MS = 10_000

export class BingoInspector {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private expectedSeq = 1
  private metadata: CliInspectionMetadata | null = null
  private waiters = new Map<string, { expectedType: CliEvent['type']; resolve: (event: CliEvent) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  private ready: Promise<CliInspectionMetadata> | null = null
  private resolveReady: ((metadata: CliInspectionMetadata) => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null

  constructor(private readonly binaryPath: string, private readonly cwd: string, private readonly env: NodeJS.ProcessEnv = process.env) {}

  open(): Promise<CliInspectionMetadata> {
    if (this.child) throw new Error('Inspector is already open')
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject })
    const child = spawn(this.binaryPath, ['--json-events', '--inspect'], { cwd: this.cwd, env: this.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consume(chunk))
    child.on('error', (error) => this.fail(error))
    child.on('exit', (code, signal) => {
      this.child = null
      if (!this.metadata) this.fail(new Error(`bingo inspection exited before ready (code=${code ?? 'null'}, signal=${signal ?? 'null'})`))
      else this.rejectWaiters(new Error(`bingo inspection exited before command completion (code=${code ?? 'null'}, signal=${signal ?? 'null'})`))
    })
    const timer = setTimeout(() => this.fail(new Error('bingo did not emit inspection.ready within 10 seconds')), TIMEOUT_MS)
    void this.ready.then(() => clearTimeout(timer), () => clearTimeout(timer))
    return this.ready
  }

  async listProviders(): Promise<Extract<CliEvent, { type: 'providers.result' }>['providers']> {
    const event = await this.request({ protocolVersion: 1, type: 'providers.list', commandId: randomUUID() }, 'providers.result')
    if (event.type !== 'providers.result') throw new Error('Unexpected providers.list response')
    return event.providers
  }

  async listModels(provider: string): Promise<string[]> {
    const event = await this.request({ protocolVersion: 1, type: 'models.list', commandId: randomUUID(), provider }, 'models.result')
    if (event.type !== 'models.result') throw new Error('Unexpected models.list response')
    return event.models
  }

  async close(): Promise<void> {
    const child = this.child
    if (!child) return
    try { await this.request({ protocolVersion: 1, type: 'session.close', commandId: randomUUID() }, 'session.closed') } catch { child.kill() }
    child.stdin.end()
  }

  private request(command: ClientCommand, expectedType: CliEvent['type']): Promise<CliEvent> {
    const parsed = clientCommandSchema.parse(command)
    const child = this.child
    if (!child?.stdin.writable) return Promise.reject(new Error('bingo inspector is not writable'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(command.commandId); reject(new Error(`${command.type} did not complete within 10 seconds`)) }, TIMEOUT_MS)
      this.waiters.set(command.commandId, { expectedType, resolve, reject, timer })
      child.stdin.write(`${JSON.stringify(parsed)}\n`, (error) => {
        if (!error) return
        clearTimeout(timer)
        this.waiters.delete(command.commandId)
        reject(error)
      })
    })
  }

  private consume(chunk: string): void {
    this.buffer += chunk
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
    try { raw = JSON.parse(line) } catch { this.fail(new Error('bingo inspector emitted malformed NDJSON')); return }
    const parsed = cliEventSchema.safeParse(raw)
    if (!parsed.success) { this.fail(new Error(`bingo inspector emitted an invalid event: ${parsed.error.message}`)); return }
    const event = parsed.data
    if (event.seq !== this.expectedSeq) { this.fail(new Error(`bingo inspector sequence mismatch: expected ${this.expectedSeq}, received ${event.seq}`)); return }
    this.expectedSeq += 1
    if (event.type === 'inspection.ready') {
      this.metadata = event.metadata
      this.resolveReady?.(event.metadata)
      this.resolveReady = null
      this.rejectReady = null
      return
    }
    const commandId = 'commandId' in event ? event.commandId : undefined
    if (!commandId) return
    const waiter = this.waiters.get(commandId)
    if (!waiter) return
    clearTimeout(waiter.timer)
    this.waiters.delete(commandId)
    if (event.type === 'error') waiter.reject(new BingoCommandError(event.code, event.msg, event.level, event.recoverable))
    else if (event.type !== waiter.expectedType) waiter.reject(new Error(`Expected ${waiter.expectedType}, received ${event.type}`))
    else waiter.resolve(event)
  }

  private fail(error: Error): void {
    this.rejectReady?.(error)
    this.rejectReady = null
    this.resolveReady = null
    this.rejectWaiters(error)
    const child = this.child
    this.child = null
    if (child && !child.killed) child.kill()
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters.values()) { clearTimeout(waiter.timer); waiter.reject(error) }
    this.waiters.clear()
  }
}
