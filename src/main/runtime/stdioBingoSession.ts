import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cliEventSchema, clientCommandSchema, type CliEvent, type CliSessionMetadata, type ClientCommand, type PromptResponse } from '../../shared/contracts/cli'
import type { BingoSession, BingoSessionHandlers } from './bingoSession'

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
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consume(chunk))
    child.on('error', (error) => this.fail(error))
    child.on('exit', (code, signal) => {
      this.child = null
      if (this.closed) return
      const error = code === 0 ? null : new Error(`bingo exited before session close (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
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

  cancelTurn(turnId: string): Promise<void> {
    return this.write({ protocolVersion: 1, type: 'turn.cancel', commandId: randomUUID(), turnId })
  }

  respondToPrompt(turnId: string, promptId: string, response: PromptResponse): Promise<void> {
    return this.write({ protocolVersion: 1, type: 'prompt.respond', commandId: randomUUID(), turnId, promptId, response })
  }

  async close(): Promise<void> {
    if (!this.child) return
    this.closed = true
    await this.write({ protocolVersion: 1, type: 'session.close', commandId: randomUUID() })
    this.child.stdin.end()
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

    if (event.type === 'session.ready') {
      this.resolveReady?.(event.metadata)
      this.resolveReady = null
      this.rejectReady = null
    }
    this.handlers.onEvent(event)
  }

  private write(command: ClientCommand): Promise<void> {
    const parsed = clientCommandSchema.parse(command)
    const child = this.child
    if (!child?.stdin.writable) return Promise.reject(new Error('bingo session is not writable'))
    return new Promise((resolve, reject) => {
      child.stdin.write(`${JSON.stringify(parsed)}\n`, (error) => error ? reject(error) : resolve())
    })
  }

  private fail(error: Error): void {
    this.rejectReady?.(error)
    this.rejectReady = null
    this.resolveReady = null
    const child = this.child
    this.child = null
    if (child && !child.killed) child.kill()
    this.handlers.onExit(error)
  }
}
