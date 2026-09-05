import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { z } from 'zod'
import { RPC_PROTOCOL, type EventParams, type GatewayEvent, type InitializeResult, type RpcMethod, type RpcMethods } from '../../shared/rpc'
import { rpcNotificationSchemas, rpcParamsSchemas, rpcResultSchemas } from './rpc-validation'

export class DesktopFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'DesktopFailure' }
}
export type RpcNotification = { method: 'event'; params: EventParams } | { method: 'gateway/event'; params: GatewayEvent }
export const RPC_LIMITS = { line: 16 * 1024 * 1024, pending: 32, writes: 32 * 1024 * 1024, timeout: 30_000 } as const
const envelope = z.looseObject({ jsonrpc: z.literal('2.0') })
const rpcError = z.looseObject({ code: z.number().int(), message: z.string(), data: z.looseObject({ code: z.string().optional() }).optional() })
type Pending = { method: RpcMethod; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
type Options = { binary: string; cwd: string; args?: string[]; env?: NodeJS.ProcessEnv; timeout?: number }

/** One native process, one ordered NDJSON stream. Never retries a write. */
export class RpcClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly pending = new Map<string, Pending>()
  private fragments: Buffer[] = []
  private fragmentBytes = 0
  private nextId = 0
  private dead = false
  private closing = false
  private closePromise: Promise<void> | null = null
  private exited: Promise<void> = Promise.resolve()
  private exitObserved = false
  private server: InitializeResult | null = null

  constructor(private readonly options: Options, private readonly notify: (value: RpcNotification) => void, private readonly failed: (error: DesktopFailure) => void, private readonly replied?: (method: RpcMethod, result: unknown) => void) {}

  async start(): Promise<InitializeResult> {
    if (this.child || this.dead) throw new DesktopFailure('INVALID_STATE', 'This connection has already been started.')
    const child = spawn(this.options.binary, this.options.args ?? ['serve', '--stdio'], {
      cwd: this.options.cwd, env: this.options.env ?? process.env, shell: false,
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    this.exited = new Promise((resolve) => {
      child.once('close', (code, signal) => {
        this.exitObserved = true
        resolve()
        if (!this.closing) this.fail(new DesktopFailure('PROCESS_EXITED', `bingo stopped (${signal ?? `exit ${code ?? 'unknown'}`}). Reconnect to continue.`))
        else this.rejectPending(new DesktopFailure('DISCONNECTED', 'The runtime connection closed.'))
      })
    })
    child.on('error', () => this.fail(new DesktopFailure('START_FAILED', 'Could not launch bingo. Choose an executable native bingo-improve binary.')))
    child.stdin.on('error', () => this.fail(new DesktopFailure('WRITE_FAILED', 'The bingo input stream closed. Reconnect before sending again.')))
    child.stdout.on('error', () => this.fail(new DesktopFailure('READ_FAILED', 'The bingo output stream failed. Reconnect to continue.')))
    child.stdout.on('data', (chunk: Buffer) => this.read(chunk))
    // Drain diagnostics without forwarding credentials or retaining unbounded stderr.
    child.stderr.on('data', () => {})
    child.stdout.on('end', () => {
      if (!this.closing) this.fail(new DesktopFailure('STREAM_ENDED', 'The bingo output stream ended. Reconnect to continue.'))
    })
    const result = await this.request('initialize', { protocol: RPC_PROTOCOL, client: { name: 'Rei', surface: 'desktop' } })
    if (result.protocol !== RPC_PROTOCOL || result.name !== 'bingo') {
      const error = new DesktopFailure('PROTOCOL_MISMATCH', `This app requires bingo RPC protocol ${RPC_PROTOCOL}. Choose a compatible bingo-improve binary.`)
      this.fail(error)
      throw error
    }
    this.server = result
    return result
  }

  request<M extends RpcMethod>(method: M, params: RpcMethods[M]['params']): Promise<RpcMethods[M]['result']> {
    if (!this.child || this.dead || (this.closing && method !== 'shutdown')) return Promise.reject(new DesktopFailure('DISCONNECTED', 'Connect to bingo before making a request.'))
    if (this.server && !this.server.capabilities.methods.includes(method)) return Promise.reject(new DesktopFailure('UNSUPPORTED_METHOD', `This bingo version does not support ${method}.`))
    if (this.pending.size >= RPC_LIMITS.pending) return Promise.reject(new DesktopFailure('BACKPRESSURE', 'Too many requests are in flight. Wait for the current requests to finish.'))
    const parsed = rpcParamsSchemas[method].safeParse(params)
    if (!parsed.success) return Promise.reject(new DesktopFailure('INVALID_PARAMS', `Invalid parameters for ${method}.`))
    const id = String(++this.nextId)
    const line = JSON.stringify({ jsonrpc: '2.0', id, method, params: parsed.data }) + '\n'
    if (Buffer.byteLength(line) > RPC_LIMITS.line) return Promise.reject(new DesktopFailure('PAYLOAD_TOO_LARGE', 'The request exceeds the 16 MB runtime limit. Remove attachments or shorten the message.'))
    if (this.child.stdin.writableLength + Buffer.byteLength(line) > RPC_LIMITS.writes) return Promise.reject(new DesktopFailure('BACKPRESSURE', 'The runtime is not reading requests. Wait or reconnect.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A timed-out write may have executed. Invalidate the connection instead of retrying it.
        this.fail(new DesktopFailure('REQUEST_TIMEOUT', `${method} timed out. Its outcome is unknown; reconnect and inspect the session before trying again.`))
      }, this.options.timeout ?? RPC_LIMITS.timeout)
      this.pending.set(id, { method, resolve: (value) => resolve(value as RpcMethods[M]['result']), reject, timer })
      this.child!.stdin.write(line, (error) => {
        if (error) this.fail(new DesktopFailure('WRITE_FAILED', 'The request could not be delivered. Reconnect and inspect the session before trying again.'))
      })
    })
  }

  private read(chunk: Buffer): void {
    if (this.dead) return
    let start = 0
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start)
      const end = newline === -1 ? chunk.length : newline
      const part = chunk.subarray(start, end)
      if (this.fragmentBytes + part.length > RPC_LIMITS.line) {
        this.fail(new DesktopFailure('PROTOCOL_LIMIT', 'bingo emitted a line larger than 16 MB. Reconnect after updating the runtime.'))
        return
      }
      this.fragments.push(part)
      this.fragmentBytes += part.length
      if (newline === -1) return
      const line = Buffer.concat(this.fragments, this.fragmentBytes).toString('utf8').replace(/\r$/, '')
      this.fragments = []
      this.fragmentBytes = 0
      if (!line.length) { this.fail(new DesktopFailure('INVALID_PROTOCOL', 'bingo emitted an empty protocol line.')); return }
      this.dispatch(line)
      if (this.dead) return
      start = newline + 1
    }
  }

  private dispatch(line: string): void {
    try {
      const message = envelope.parse(JSON.parse(line))
      if ('id' in message) {
        if (typeof message.id !== 'string' || !this.pending.has(message.id)) throw new Error('Uncorrelated response')
        const pending = this.pending.get(message.id)!
        if (('result' in message) === ('error' in message)) throw new Error('Ambiguous response')
        if ('error' in message) {
          const error = rpcError.parse(message.error)
          this.finish(message.id)
          pending.reject(new DesktopFailure(error.data?.code ?? `RPC_${error.code}`, error.message.slice(0, 2048)))
        } else {
          const value = rpcResultSchemas[pending.method].parse(message.result)
          this.replied?.(pending.method, value)
          this.finish(message.id)
          pending.resolve(value)
        }
      } else if (message.method === 'event') {
        this.notify({ method: 'event', params: rpcNotificationSchemas.event.parse(message.params) as EventParams })
      } else if (message.method === 'gateway/event') {
        this.notify({ method: 'gateway/event', params: rpcNotificationSchemas['gateway/event'].parse(message.params) as GatewayEvent })
      } else throw new Error('Unknown notification')
    } catch {
      this.fail(new DesktopFailure('INVALID_PROTOCOL', 'bingo returned an invalid or incompatible RPC message. Update the runtime and reconnect.'))
    }
  }

  private finish(id: string): void {
    clearTimeout(this.pending.get(id)!.timer)
    this.pending.delete(id)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
  }

  private fail(error: DesktopFailure): void {
    if (this.dead) return
    this.dead = true
    this.fragments = []
    this.fragmentBytes = 0
    this.rejectPending(error)
    if (!this.closing) this.failed(error)
    void this.close()
  }

  close(): Promise<void> {
    if (!this.closePromise) this.closePromise = this.stop()
    return this.closePromise
  }

  private async stop(): Promise<void> {
    this.closing = true
    if (!this.child) return
    if (!this.dead && !this.exitObserved) {
      await Promise.race([this.request('shutdown', {}).catch(() => {}), delay(800)])
      this.child.stdin.end()
      await Promise.race([this.exited, delay(800)])
    }
    if (!this.exitObserved) {
      this.killTree(false)
      await Promise.race([this.exited, delay(500)])
    }
    if (!this.exitObserved) { this.killTree(true); await Promise.race([this.exited, delay(500)]) }
    this.dead = true
    this.rejectPending(new DesktopFailure('DISCONNECTED', 'The runtime connection closed.'))
  }

  private killTree(force: boolean): void {
    const pid = this.child?.pid
    if (!pid) return
    if (process.platform === 'win32') {
      const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
      const killer = spawn(executable, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false })
      killer.on('error', () => this.child?.kill())
    } else {
      try { process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM') }
      catch { try { this.child?.kill(force ? 'SIGKILL' : 'SIGTERM') } catch { /* Already stopped. */ } }
    }
  }
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref() }) }
