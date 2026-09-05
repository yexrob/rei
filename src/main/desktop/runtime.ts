import { randomUUID } from 'node:crypto'
import type { ConnectionState, DesktopEvent, DesktopMethod, DesktopRequest } from '../../shared/desktop'
import type { EventParams, OpenResult, RpcMethods } from '../../shared/rpc'
import { DesktopFailure, RpcClient, type RpcNotification } from './rpc-client'

type Activity = { seq: number; turn: boolean; queued: boolean; interactions: Set<string>; uncertain: boolean }
export class DesktopRuntime {
  private client: RpcClient | null = null
  private switching = false
  private readonly activity = new Map<string, Activity>()
  private readonly pasteLogins = new Map<string, Set<string>>()
  private readonly submitting = new Map<string, string>()
  private state: ConnectionState = { status: 'disconnected', connectionId: null, workspace: null, binary: null }
  constructor(private readonly emit: (event: DesktopEvent) => void) {}
  get connection(): ConnectionState { return structuredClone(this.state) }
  get busy(): boolean { return this.submitting.size > 0 || [...this.activity.values()].some((value) => value.turn || value.queued || value.interactions.size > 0 || value.uncertain) }

  async connect(binary: string, workspace: string): Promise<ConnectionState> {
    if (this.switching) throw new DesktopFailure('CONNECTING', 'A connection is already being established.')
    this.switching = true
    try {
      await this.close()
      const connectionId = randomUUID()
      this.state = { status: 'connecting', connectionId, binary, workspace }
      this.publish()
      const client = new RpcClient({ binary, cwd: workspace, env: { ...process.env, BINGO_BROWSER_MODE: 'client' } }, (notification) => this.notification(connectionId, notification), (error) => {
        if (connectionId !== this.state.connectionId) return
        this.state = { ...this.state, status: 'failed', error: { code: error.code, message: error.message } }
        this.publish()
      }, (method, result) => {
        if (connectionId === this.state.connectionId && method === 'session/open') this.observeSnapshot(result as OpenResult)
      })
      this.client = client
      const server = await client.start()
      if (this.state.status === 'failed') throw new DesktopFailure('CONNECT_FAILED', 'The runtime failed while connecting.')
      this.state = { ...this.state, status: 'ready', server }
      this.publish()
      return this.connection
    } finally { this.switching = false }
  }

  async request<M extends DesktopMethod>(input: DesktopRequest<M>): Promise<RpcMethods[M]['result']> {
    const client = this.require(input.connectionId)
    if (input.method === 'session/answer') {
      const params = input.params as RpcMethods['session/answer']['params']
      if (params.answer.kind !== 'cancel' && [...this.pasteLogins.values()].some((ids) => ids.has(params.interaction))) throw new DesktopFailure('UNSAFE_CREDENTIAL_FLOW', 'This runtime journals pasted login answers. Use bingo login <provider> paste in a terminal instead; no credential was sent.')
    }
    const submit = input.method === 'session/submit' ? input.params as RpcMethods['session/submit']['params'] : null
    if (submit) this.submitting.set(submit.intent, submit.session)
    try {
      const result = await client.request(input.method, input.params)
      if (input.method === 'session/open') this.observeSnapshot(result as OpenResult)
      return result
    } catch (error) {
      // A core rejection is definite; a dead transport leaves an unknown outcome.
      if (submit && this.state.status === 'ready') this.submitting.delete(submit.intent)
      throw error
    }
  }
  async deleteSession(connectionId: string, session: string): Promise<void> {
    await this.require(connectionId).request('session/delete', { session })
    this.activity.delete(session)
  }
  abort(error: DesktopFailure): void {
    const client = this.client
    this.client = null
    this.state = { ...this.state, status: 'failed', error: { code: error.code, message: error.message } }
    this.publish()
    void client?.close()
  }
  async close(): Promise<void> {
    const client = this.client
    this.client = null
    this.state = { status: 'disconnected', connectionId: null, workspace: null, binary: null }
    this.activity.clear()
    this.pasteLogins.clear()
    this.submitting.clear()
    this.publish()
    await client?.close()
  }
  private require(connectionId: string): RpcClient {
    if (connectionId !== this.state.connectionId) throw new DesktopFailure('STALE_CONNECTION', 'This request belongs to an old runtime connection. Reopen the session.')
    if (this.state.status !== 'ready' || !this.client) throw new DesktopFailure('DISCONNECTED', 'Connect to the runtime before continuing.')
    return this.client
  }
  private observeSnapshot(result: OpenResult): void {
    const current = this.activity.get(result.session)
    if (current && current.seq > result.snapshot.seq) return
    this.pasteLogins.set(result.session, new Set((result.snapshot.interactions ?? []).filter((interaction) => interaction.kind.kind === 'login' && interaction.kind.flow.kind === 'paste').map((interaction) => interaction.id)))
    this.activity.set(result.session, { seq: result.snapshot.seq, turn: Boolean(result.snapshot.turn), queued: Boolean(result.snapshot.queue?.length), interactions: new Set((result.snapshot.interactions ?? []).map((interaction) => interaction.id)), uncertain: false })
  }
  private notification(connectionId: string, notification: RpcNotification): void {
    if (connectionId !== this.state.connectionId) return
    if (notification.method === 'event') this.observeFrame(notification.params)
    this.emit({ type: 'rpc', connectionId, ...notification })
  }
  private observeFrame(frame: EventParams): void {
    const previous = this.activity.get(frame.session)
    if (previous && previous.seq >= frame.seq && frame.event.type !== 'lagged') return
    const event = frame.event
    if (event.type === 'interactionOpened' && event.interaction.kind.kind === 'login' && event.interaction.kind.flow.kind === 'paste') {
      const ids = this.pasteLogins.get(frame.session) ?? new Set<string>()
      ids.add(event.interaction.id)
      this.pasteLogins.set(frame.session, ids)
    }
    if (event.type === 'interactionResolved' || event.type === 'interactionCancelled') this.pasteLogins.get(frame.session)?.delete(event.id)
    if (event.type === 'sessionClosed') this.pasteLogins.delete(frame.session)
    const activity = previous ?? { seq: 0, turn: false, queued: false, interactions: new Set<string>(), uncertain: false }
    if (event.type === 'lagged') { activity.uncertain = true; this.activity.set(frame.session, activity); return }
    activity.seq = frame.seq
    if (event.type === 'intentAck') {
      this.submitting.delete(event.intent)
      if (event.outcome.kind === 'turnStarted') activity.turn = true
      if (event.outcome.kind === 'queued') activity.queued = true
    }
    if (event.type === 'turnStarted') activity.turn = true
    if (event.type === 'turnCompleted') { activity.turn = false; activity.uncertain = false }
    if (event.type === 'interactionOpened') activity.interactions.add(event.interaction.id)
    if (event.type === 'interactionResolved' || event.type === 'interactionCancelled') activity.interactions.delete(event.id)
    if (event.type === 'queueChanged') activity.queued = event.entries.length > 0
    if (event.type === 'sessionClosed') { activity.turn = false; activity.queued = false; activity.interactions.clear(); activity.uncertain = false }
    this.activity.set(frame.session, activity)
  }
  private publish(): void { this.emit({ type: 'connection', connection: this.connection }) }
}
