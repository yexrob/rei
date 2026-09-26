import { randomUUID } from 'node:crypto'
import type { ConnectionState, DesktopEvent, DesktopMethod, DesktopRequest } from '../../shared/desktop'
import type { EventParams, EventRefParams, InitializeResult, OpenResult, RpcMethod, RpcMethods } from '../../shared/rpc'
import { DesktopFailure, RpcClient, type RpcNotification } from './rpc-client'

type Activity = { seq: number; turn: boolean; queued: boolean; interactions: Set<string>; uncertain: boolean }
export class DesktopRuntime {
  private client: RpcClient | null = null
  private switching = false
  private generation = 0
  private readonly pending = new Set<symbol>()
  private readonly retiring = new Set<RpcClient>()
  private publishedBusy = false
  private readonly activity = new Map<string, Activity>()
  private readonly pasteLogins = new Map<string, Set<string>>()
  private readonly uncertainRefs = new Map<string, number>()
  private readonly submitting = new Map<string, string>()
  private state: ConnectionState
  constructor(private readonly emit: (event: DesktopEvent) => void, private readonly beforeConnect: () => void = () => {}, hostId = 'standalone', private readonly approveServer: (server: InitializeResult) => void = () => {}) {
    this.state = { hostId, busy: false, status: 'disconnected', connectionId: null, workspace: null, binary: null }
  }
  get connection(): ConnectionState { return structuredClone({ ...this.state, busy: this.busy }) }
  get busy(): boolean { return this.switching || this.pending.size > 0 || this.submitting.size > 0 || [...this.activity.values()].some((value) => value.turn || value.queued || value.interactions.size > 0 || value.uncertain) }
  get live(): boolean { return this.switching || Boolean(this.client && this.client.alive !== false) || [...this.retiring].some(client => client.alive !== false) }
  get hasPending(): boolean { return this.switching || this.pending.size > 0 }

  async connect(binary: string, workspace: string): Promise<ConnectionState> {
    if (this.switching) throw new DesktopFailure('CONNECTING', 'A connection is already being established.')
    this.switching = true
    const generation = ++this.generation
    let started = false
    try {
      this.beforeConnect()
      await this.closeClient()
      this.throwIfFailed()
      if (generation !== this.generation) throw new DesktopFailure('STALE_CONNECTION', 'This connection attempt was cancelled.')
      const connectionId = randomUUID()
      started = true
      this.state = { hostId: this.state.hostId, busy: true, status: 'connecting', connectionId, binary, workspace }
      this.publish()
      this.throwIfFailed()
      const client: RpcClient = new RpcClient({ binary, cwd: workspace, env: { ...process.env, BINGO_BROWSER_MODE: 'client' } }, (notification) => this.notification(connectionId, notification), (error) => {
        if (connectionId !== this.state.connectionId || this.state.status === 'failed') return
        this.client = null
        this.retiring.add(client)
        this.state = { ...this.state, status: 'failed', error: { code: error.code, message: error.message } }
        this.publish()
        void this.retire(client).catch(() => {})
      }, (method, result) => {
        if (connectionId === this.state.connectionId && this.state.status !== 'failed' && this.state.status !== 'disconnected' && method === 'session/open') this.observeSnapshot(result as OpenResult)
      })
      this.client = client
      const server = await client.start()
      this.approveServer(server)
      this.throwIfFailed()
      if (generation !== this.generation || this.client !== client) throw new DesktopFailure('STALE_CONNECTION', 'This connection attempt was cancelled.')
      this.switching = false
      this.state = { ...this.state, status: 'ready', server }
      this.publish()
      this.throwIfFailed()
      return this.connection
    } catch (error) {
      if (started && generation === this.generation && this.state.status !== 'failed') this.abort(error instanceof DesktopFailure ? error : new DesktopFailure('CONNECT_FAILED', 'The runtime could not initialize.'))
      throw error
    } finally { this.switching = false; this.publishBusyChange() }
  }

  async request<M extends DesktopMethod>(input: DesktopRequest<M>): Promise<RpcMethods[M]['result']> {
    const client = this.require(input.connectionId)
    // A captured Stop only cancels the addressed actor's head/turn (or Core
    // rejects NOT_READY). Never turn missing permission/intent data into a new
    // submit or an answer, and never automatically retry an unknown Stop ACK.
    if ((input.method === 'session/submit' || input.method === 'session/answer') && 'session' in input.params && this.uncertainRefs.has(input.params.session)) throw new DesktopFailure('SESSION_UNCERTAIN', 'A critical runtime event is not fully loaded. Reopen this session for an authoritative snapshot before responding.')
    if (input.method === 'session/answer') {
      const params = input.params as RpcMethods['session/answer']['params']
      if (params.answer.kind !== 'cancel' && [...this.pasteLogins.values()].some((ids) => ids.has(params.interaction))) throw new DesktopFailure('UNSAFE_CREDENTIAL_FLOW', 'This runtime journals pasted login answers. Use bingo login <provider> paste in a terminal instead; no credential was sent.')
    }
    const submit = input.method === 'session/submit' ? input.params as RpcMethods['session/submit']['params'] : null
    if (submit) this.submitting.set(submit.intent, submit.session)
    const pending = Symbol(input.method)
    this.pending.add(pending)
    this.publishBusyChange()
    try {
      this.require(input.connectionId)
      const result = await client.request(input.method, input.params)
      if (this.client !== client || input.connectionId !== this.state.connectionId || this.state.status !== 'ready') throw new DesktopFailure('STALE_CONNECTION', 'The response belongs to an invalidated runtime epoch.')
      if (input.method === 'session/open') this.observeSnapshot(result as OpenResult)
      return result
    } catch (error) {
      // A core rejection is definite; a dead transport leaves an unknown outcome.
      if (submit && this.state.status === 'ready') this.submitting.delete(submit.intent)
      throw error
    } finally { this.pending.delete(pending); this.publishBusyChange() }
  }
  /** Used only by Native's bounded part/export controller, never the renderer's generic RPC allowlist. */
  async requestCore<M extends RpcMethod>(connectionId: string, method: M, params: RpcMethods[M]['params']): Promise<RpcMethods[M]['result']> {
    const client = this.require(connectionId), pending = Symbol(method)
    this.pending.add(pending); this.publishBusyChange()
    try {
      this.require(connectionId)
      const result = await client.request(method, params)
      if (this.client !== client || this.state.connectionId !== connectionId || this.state.status !== 'ready') throw new DesktopFailure('STALE_CONNECTION', 'The part belongs to an invalidated runtime epoch.')
      return result
    } finally { this.pending.delete(pending); this.publishBusyChange() }
  }
  async deleteSession(connectionId: string, session: string): Promise<void> {
    const client = this.require(connectionId), pending = Symbol('delete')
    if (this.uncertainRefs.has(session)) throw new DesktopFailure('SESSION_UNCERTAIN', 'Reopen this session to verify its pending interactions before deleting it.')
    this.pending.add(pending); this.publishBusyChange()
    try {
      this.require(connectionId)
      await client.request('session/delete', { session })
      if (this.client !== client || this.state.connectionId !== connectionId) throw new DesktopFailure('STALE_CONNECTION', 'The session deletion belongs to an old connection.')
      this.activity.delete(session)
    } finally { this.pending.delete(pending); this.publishBusyChange() }
  }
  abort(error: DesktopFailure): void {
    ++this.generation
    const client = this.client
    this.client = null
    if (client) this.retiring.add(client)
    this.state = { hostId: this.state.hostId, busy: this.busy, status: 'failed', connectionId: this.state.connectionId, workspace: this.state.workspace, binary: this.state.binary, error: { code: error.code, message: error.message } }
    this.publish()
    if (client) void this.retire(client).catch(() => {})
  }
  async close(): Promise<void> { ++this.generation; await this.closeClient() }
  private async retire(client: RpcClient): Promise<void> {
    this.retiring.add(client)
    await client.close()
    if (client.alive === true) throw new DesktopFailure('PROCESS_STILL_RUNNING', 'The old runtime has not exited yet. Wait before reconnecting.')
    this.retiring.delete(client)
    this.publish()
  }
  private async closeClient(): Promise<void> {
    const client = this.client
    this.client = null
    if (client) this.retiring.add(client)
    this.state = { hostId: this.state.hostId, busy: this.busy, status: 'disconnected', connectionId: null, workspace: this.state.workspace, binary: this.state.binary }
    this.activity.clear()
    this.pasteLogins.clear()
    this.uncertainRefs.clear()
    this.submitting.clear()
    this.publish()
    await Promise.all([...this.retiring].map(client => this.retire(client)))
  }
  private require(connectionId: string): RpcClient {
    if (connectionId !== this.state.connectionId) throw new DesktopFailure('STALE_CONNECTION', 'This request belongs to an old runtime connection. Reopen the session.')
    if (this.state.status !== 'ready' || !this.client) throw new DesktopFailure('DISCONNECTED', 'Connect to the runtime before continuing.')
    return this.client
  }
  private observeSnapshot(result: OpenResult): void {
    const current = this.activity.get(result.session)
    if (current && current.seq > result.snapshot.seq) return
    const critical = result.omittedFields?.some(field => field.path.some(segment => ['interactions', 'queue', 'turn', 'extensions', 'signals'].includes(segment))) ?? false
    const interactionsOmitted = result.omittedFields?.some(field => field.path.includes('interactions')) ?? false
    if (critical) this.uncertainRefs.set(result.session, Math.max(this.uncertainRefs.get(result.session) ?? 0, result.snapshot.seq))
    else if (this.uncertainRefs.get(result.session) !== undefined && result.snapshot.seq >= this.uncertainRefs.get(result.session)!) this.uncertainRefs.delete(result.session)
    if (!interactionsOmitted) this.pasteLogins.set(result.session, new Set((result.snapshot.interactions ?? []).filter((interaction) => interaction.kind.kind === 'login' && interaction.kind.flow.kind === 'paste').map((interaction) => interaction.id)))
    this.activity.set(result.session, { seq: result.snapshot.seq, turn: Boolean(result.snapshot.turn), queued: Boolean(result.snapshot.queue?.length), interactions: interactionsOmitted ? new Set(current?.interactions ?? []) : new Set((result.snapshot.interactions ?? []).map((interaction) => interaction.id)), uncertain: this.uncertainRefs.has(result.session) })
  }
  private notification(connectionId: string, notification: RpcNotification): void {
    if (connectionId !== this.state.connectionId || this.state.status === 'failed' || this.state.status === 'disconnected') return
    if (notification.method === 'event') this.observeFrame(notification.params)
    if (notification.method === 'eventRef') this.observeRef(notification.params)
    this.emit({ type: 'rpc', connectionId, ...notification })
    this.publishBusyChange()
  }
  private observeRef(ref: EventRefParams): void {
    const previous = this.activity.get(ref.session)
    if (previous && previous.seq >= ref.seq) return
    const activity = previous ?? { seq: 0, turn: false, queued: false, interactions: new Set<string>(), uncertain: false }
    activity.seq = ref.seq
    if (ref.stateUncertain) {
      this.uncertainRefs.set(ref.session, Math.max(this.uncertainRefs.get(ref.session) ?? 0, ref.seq))
      activity.uncertain = true
    }
    this.activity.set(ref.session, activity)
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
    if (event.type === 'turnCompleted') { activity.turn = false; activity.uncertain = this.uncertainRefs.has(frame.session) }
    if (event.type === 'interactionOpened') activity.interactions.add(event.interaction.id)
    if (event.type === 'interactionResolved' || event.type === 'interactionCancelled') activity.interactions.delete(event.id)
    if (event.type === 'queueChanged') activity.queued = event.entries.length > 0
    if (event.type === 'sessionClosed') { activity.turn = false; activity.queued = false; activity.interactions.clear(); activity.uncertain = false }
    this.activity.set(frame.session, activity)
  }
  // Publishing can synchronously abort through the delivery overflow callback.
  private throwIfFailed(): void {
    if (this.state.status === 'failed') throw new DesktopFailure('CONNECT_FAILED', 'The runtime failed while connecting.')
  }
  private publishBusyChange(): void { if (this.publishedBusy !== this.busy) this.publish() }
  private publish(): void { this.publishedBusy = this.busy; this.emit({ type: 'connection', connection: this.connection }) }
}
