import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { z } from 'zod'
import { RPC_PROTOCOL, type Event, type EventParams, type EventRefParams, type GatewayEvent, type GatewaySessionHeadParams, type InitializeResult, type RpcMethod, type RpcMethods } from '../../shared/rpc'
import { rpcNotificationSchemas, rpcParamsSchemas, rpcResultSchemas } from './rpc-validation'

export class DesktopFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'DesktopFailure' }
}
export type RpcNotification =
  | { method: 'event'; params: EventParams }
  | { method: 'eventRef'; params: EventRefParams }
  | { method: 'gateway/event'; params: GatewayEvent }
  | { method: 'gateway/sessionHead'; params: GatewaySessionHeadParams }
export const RPC_LIMITS = { line: 16 * 1024 * 1024, pending: 32, writes: 32 * 1024 * 1024, timeout: 30_000, openTimeout: 120_000, tombstones: 256, stderr: 16 * 1024 } as const
// A timed-out idempotent read fails alone; any other timeout leaves an unknown outcome and invalidates the connection.
export const RPC_READ_METHODS: ReadonlySet<RpcMethod> = new Set<RpcMethod>(['session/list', 'session/listHeads', 'session/children', 'session/history', 'session/itemPart', 'session/fieldPart', 'session/eventPart', 'session/events', 'catalog/read'])
const KNOWN_EVENTS: Record<Event['type'], true> = { sessionUpdated: true, sessionClosed: true, turnStarted: true, turnRetrying: true, turnUsage: true, turnCompleted: true, itemStarted: true, itemDelta: true, itemUpdated: true, itemCompleted: true, queueChanged: true, interactionOpened: true, interactionResolved: true, interactionCancelled: true, intentAck: true, compacted: true, rewound: true, configChanged: true, catalogChanged: true, notice: true, extension: true, signal: true, lagged: true }
const reportedUnknownEvents = new Set<string>()
/** A newer bingo may add event variants; they are dropped (the renderer's seq-gap check resyncs) instead of killing the connection. */
export function unknownEventType(params: unknown): string | null {
  const event = params && typeof params === 'object' ? (params as { event?: unknown }).event : null
  const type = event && typeof event === 'object' ? (event as { type?: unknown }).type : null
  return typeof type === 'string' && !Object.hasOwn(KNOWN_EVENTS, type) ? type.slice(0, 128) : null
}
const SECRET_PATTERNS: RegExp[] = [/\bsk-[A-Za-z0-9_-]{6,}/g, /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, /\b([A-Za-z_-]*(?:api[_-]?key|token|secret|password|passwd|authorization)[A-Za-z_-]*)(["']?\s*[=:]\s*["']?)[^\s"',;&]+/gi]
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((value, pattern) => value.replace(pattern, (match, ...groups: unknown[]) => pattern === SECRET_PATTERNS[0] ? 'sk-[redacted]' : pattern === SECRET_PATTERNS[1] ? `${groups[0]} [redacted]` : `${groups[0]}${groups[1]}[redacted]`), text)
}
const envelope = z.looseObject({ jsonrpc: z.literal('2.0') })
const rpcError = z.looseObject({ code: z.number().int(), message: z.string(), data: z.looseObject({ code: z.string().optional() }).optional() })
type Pending = { method: RpcMethod; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
type Options = { binary: string; cwd: string; args?: string[]; env?: NodeJS.ProcessEnv; timeout?: number; openTimeout?: number }

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
  private readonly tombstones = new Set<string>()
  private stderr: Buffer[] = []
  private stderrBytes = 0
  private stderrTruncated = false

  /** Only an observed child close releases a live-host slot. */
  get alive(): boolean { return this.child !== null && !this.exitObserved }

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
        if (!this.closing) this.fail(new DesktopFailure('PROCESS_EXITED', withDiagnostics(`bingo stopped (${signal ?? `exit ${code ?? 'unknown'}`}). Reconnect to continue.`, this.stderrTail())))
        else this.rejectPending(new DesktopFailure('DISCONNECTED', 'The runtime connection closed.'))
      })
    })
    child.on('error', () => this.fail(new DesktopFailure('START_FAILED', 'Could not launch bingo. Choose an executable native bingo-improve binary.')))
    child.stdin.on('error', () => this.fail(new DesktopFailure('WRITE_FAILED', 'The bingo input stream closed. Reconnect before sending again.')))
    child.stdout.on('error', () => this.fail(new DesktopFailure('READ_FAILED', 'The bingo output stream failed. Reconnect to continue.')))
    child.stdout.on('data', (chunk: Buffer) => this.read(chunk))
    // Retain only a bounded diagnostic tail; it is redacted before it is ever reported.
    child.stderr.on('data', (chunk: Buffer) => this.captureStderr(chunk))
    child.stdout.on('end', () => {
      if (this.closing || this.dead) return
      // A crash closes stdout first; give the exit (and its stderr tail) a moment to arrive.
      const timer = setTimeout(() => this.fail(new DesktopFailure('STREAM_ENDED', withDiagnostics('The bingo output stream ended. Reconnect to continue.', this.stderrTail()))), 500)
      timer.unref()
      child.once('close', () => clearTimeout(timer))
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
        if (RPC_READ_METHODS.has(method) && this.pending.has(id)) {
          // A read has no side effect: fail it alone and silently drop its late reply.
          this.finish(id)
          this.tombstones.add(id)
          if (this.tombstones.size > RPC_LIMITS.tombstones) this.tombstones.delete(this.tombstones.values().next().value!)
          reject(new DesktopFailure('TIMEOUT', `${method} timed out. Try again.`))
          return
        }
        // A timed-out write may have executed. Invalidate the connection instead of retrying it.
        this.fail(new DesktopFailure('REQUEST_TIMEOUT', `${method} timed out. Its outcome is unknown; reconnect and inspect the session before trying again.`))
      }, this.timeoutFor(method))
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
    let deliver: () => void
    try { deliver = this.parse(line) }
    catch {
      this.fail(new DesktopFailure('INVALID_PROTOCOL', 'bingo returned an invalid or incompatible RPC message. Update the runtime and reconnect.'))
      return
    }
    // A desktop consumer failure is not a protocol failure; it must not stop bingo.
    try { deliver() } catch (error) { console.error('Rei could not apply a bingo RPC message.', error) }
  }

  /** Validates one message and returns its side-effect-free delivery; throws only for protocol violations. */
  private parse(line: string): () => void {
    const message = envelope.parse(JSON.parse(line))
    if ('id' in message) {
      if (typeof message.id === 'string' && this.tombstones.delete(message.id)) return () => {}
      if (typeof message.id !== 'string' || !this.pending.has(message.id)) throw new Error('Uncorrelated response')
      const id = message.id, pending = this.pending.get(id)!
      if (('result' in message) === ('error' in message)) throw new Error('Ambiguous response')
      if ('error' in message) {
        const error = rpcError.parse(message.error)
        this.finish(id)
        return () => pending.reject(new DesktopFailure(error.data?.code ?? `RPC_${error.code}`, error.message.slice(0, 2048)))
      }
      const value = rpcResultSchemas[pending.method].parse(message.result)
      this.finish(id)
      return () => {
        try { this.replied?.(pending.method, value) } finally { pending.resolve(value) }
      }
    }
    if (message.method === 'event') {
      const parsed = rpcNotificationSchemas.event.safeParse(message.params)
      if (parsed.success) return () => this.notify({ method: 'event', params: parsed.data as EventParams })
      const unknown = unknownEventType(message.params)
      if (unknown === null) throw parsed.error
      return () => {
        if (reportedUnknownEvents.has(unknown) || reportedUnknownEvents.size >= 64) return
        reportedUnknownEvents.add(unknown)
        console.warn(`Rei ignored an unsupported bingo event type: ${unknown}`)
      }
    }
    if (message.method === 'eventRef') {
      if (!this.server?.capabilities.notifications.includes('eventRef')) throw new Error('Unnegotiated event reference')
      const params = rpcNotificationSchemas.eventRef.parse(message.params) as EventRefParams
      return () => this.notify({ method: 'eventRef', params })
    }
    if (message.method === 'gateway/event') {
      const params = rpcNotificationSchemas['gateway/event'].parse(message.params) as GatewayEvent
      return () => this.notify({ method: 'gateway/event', params })
    }
    if (message.method === 'gateway/sessionHead') {
      if (!this.server?.capabilities.notifications.includes('gateway/sessionHead')) throw new Error('Unnegotiated gateway head')
      const params = rpcNotificationSchemas['gateway/sessionHead'].parse(message.params) as GatewaySessionHeadParams
      return () => this.notify({ method: 'gateway/sessionHead', params })
    }
    throw new Error('Unknown notification')
  }

  private timeoutFor(method: RpcMethod): number {
    return method === 'session/open' ? this.options.openTimeout ?? Math.max(this.options.timeout ?? 0, RPC_LIMITS.openTimeout) : this.options.timeout ?? RPC_LIMITS.timeout
  }

  private captureStderr(chunk: Buffer): void {
    this.stderr.push(chunk)
    this.stderrBytes += chunk.length
    while (this.stderrBytes > RPC_LIMITS.stderr && this.stderr.length) {
      const excess = this.stderrBytes - RPC_LIMITS.stderr, first = this.stderr[0]
      this.stderrTruncated = true
      if (first.length <= excess) { this.stderr.shift(); this.stderrBytes -= first.length }
      else { this.stderr[0] = first.subarray(excess); this.stderrBytes -= excess }
    }
  }

  /** The redacted diagnostic tail, without a possibly cut first line. */
  stderrTail(): string {
    let text = Buffer.concat(this.stderr, this.stderrBytes).toString('utf8')
    if (this.stderrTruncated) text = text.slice(text.indexOf('\n') + 1)
    return redactSecrets(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim()
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

/** Keeps a failure message within the 2048-character desktop error budget. */
export function withDiagnostics(message: string, tail: string): string {
  if (!tail) return message
  const prefix = `${message}\nbingo stderr (last lines):\n`, room = 2048 - prefix.length
  return room > 16 ? prefix + (tail.length > room ? '…' + tail.slice(tail.length - room + 1) : tail) : message
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref() }) }
