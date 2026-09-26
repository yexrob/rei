import { createHash } from 'node:crypto'
import type { ConnectionState, ConversationSelection, DesktopEvent, DesktopMethod, DesktopRequest, ExportReferenceRequest, HostEpoch, PartRequest } from '../../shared/desktop'
import type { EventRefParams, HistoryResult, OmittedField, OpenResult, ReferenceAvailability, RpcMethods, SerializedPart, SummaryHead } from '../../shared/rpc'
import { DesktopFailure } from './rpc-client'
import { DesktopRuntime } from './runtime'

export const MAX_RUNTIME_HOSTS = 8
export const DEFAULT_BOUNDED_BYTES = 4 * 1024 * 1024
const MIN_BOUNDED_BYTES = 1024
export function hostIdentity(binary: string, workspace: string): string { return createHash('sha256').update(JSON.stringify([workspace, binary])).digest('hex') }
type Host = { id: string; binary: string; workspace: string; runtime: DesktopRuntime; starting: Promise<ConnectionState> | null; operations: number; closing: boolean }
type Owner = { hostId: string; connectionId: string }
type OwnedReference = Owner & { session: string; kind: PartRequest['kind']; token: string; totalBytes: number; checksum: string; item?: string; generation?: number }

/** Approved canonical pairs own processes; selecting a view never mutates their lifetime. */
export class RuntimePool {
  private readonly hosts = new Map<string, Host>()
  private readonly owners = new Map<string, Owner>()
  private readonly opening = new Set<string>()
  private readonly references = new Map<string, OwnedReference>()
  private selected: ConversationSelection | null = null
  private invalidated = false
  private closing: Promise<void> | null = null
  constructor(private readonly emit: (event: DesktopEvent) => void, private readonly beforeConnect: () => void = () => {}) {}
  async waitForClose(): Promise<void> { await this.closing }
  get connections(): ConnectionState[] { return [...this.hosts.values()].map(host => this.state(host)) }
  get selection(): ConversationSelection | null { return this.selected ? { ...this.selected } : null }
  get selectedConnection(): ConnectionState | null { const host = this.selected && this.hosts.get(this.selected.hostId); return host ? this.state(host) : null }
  get busy(): boolean { return [...this.hosts.values()].some(host => this.state(host).busy) }
  getConnection(connectionId: string): ConnectionState { return this.state(this.byConnection(connectionId)) }
  isLive(input: HostEpoch): boolean { return this.epoch(input).runtime.live }
  getHost(input: HostEpoch): ConnectionState { return this.state(this.epoch(input)) }
  holdDelivery(input: HostEpoch): () => void {
    const host = this.epoch(input)
    if (host.runtime.connection.status !== 'ready' || !input.connectionId) throw new DesktopFailure('STALE_CONNECTION', 'The target host is not ready to deliver a bounded result.')
    host.operations += 1; this.emitState(host)
    let released = false
    return () => { if (released) return; released = true; host.operations -= 1; this.emitState(host) }
  }
  referenceFor(input: PartRequest | ExportReferenceRequest): OwnedReference {
    const host = this.byConnection(input.connectionId)
    if (host.id !== input.hostId) throw new DesktopFailure('STALE_CONNECTION', 'The reference belongs to another project host.')
    this.requireOwner(host, input.connectionId, input.session)
    const ref = this.references.get(JSON.stringify([input.connectionId, input.token]))
    if (!ref || ref.hostId !== input.hostId || ref.session !== input.session || ref.kind !== input.kind || input.kind === 'item' && (ref.item !== input.item || ref.generation !== input.generation)) throw new DesktopFailure('REFERENCE_UNAVAILABLE', 'This exact reference is unavailable in the current session epoch. Reopen the session and request a fresh reference.')
    if ('totalBytes' in input && (ref.totalBytes !== input.totalBytes || ref.checksum !== input.checksum)) throw new DesktopFailure('REFERENCE_MISMATCH', 'The saved reference length or checksum changed; no content was accepted.')
    return { ...ref }
  }
  async readCorePart(input: PartRequest): Promise<SerializedPart> {
    this.referenceFor(input)
    const host = this.byConnection(input.connectionId)
    if (!Number.isSafeInteger(input.offset) || input.offset < 0 || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > 256 * 1024) throw new DesktopFailure('INVALID_BUDGET', 'Request a valid UTF-8 part of at most 256 KiB.')
    return input.kind === 'item'
      ? host.runtime.requestCore(input.connectionId, 'session/itemPart', { session: input.session, item: input.item, generation: input.generation, token: input.token, offset: input.offset, maxBytes: input.maxBytes })
      : host.runtime.requestCore(input.connectionId, input.kind === 'field' ? 'session/fieldPart' : 'session/eventPart', { session: input.session, token: input.token, offset: input.offset, maxBytes: input.maxBytes })
  }

  async connect(binary: string, workspace: string): Promise<ConnectionState> {
    this.admitConnection()
    const id = hostIdentity(binary, workspace)
    let host = this.hosts.get(id)
    if (host?.closing) throw new DesktopFailure('RUNTIME_CLOSING', 'This project runtime is still closing. Wait for its process to exit.')
    if (host?.starting) return host.starting
    if (host && (host.runtime.connection.status === 'ready' || host.runtime.connection.status === 'failed')) return this.state(host)
    this.reserve(binary, workspace, id)
    if (!host) {
      const runtime = new DesktopRuntime(event => this.receive(id, event), () => {}, id, server => {
        const methods = ['session/listHeads', 'session/children', 'session/itemPart', 'session/fieldPart', 'session/eventPart']
        const notifications = ['eventRef', 'gateway/sessionHead']
        if (methods.some(method => !server.capabilities.methods.includes(method)) || notifications.some(method => !server.capabilities.notifications.includes(method))) throw new DesktopFailure('RUNTIME_UPDATE_REQUIRED', 'This bingo runtime cannot load large sessions safely. Update the bundled bingo binary, then reconnect; saved history has not been changed.')
      })
      host = { id, binary, workspace, runtime, starting: null, operations: 0, closing: false }
      this.hosts.set(id, host)
    }
    return this.start(host)
  }
  async reconnect(input: HostEpoch, allowBusy = false): Promise<ConnectionState> {
    this.admitConnection()
    const host = this.epoch(input)
    if (host.starting || host.operations || (this.state(host).busy && host.runtime.live && !allowBusy)) throw new DesktopFailure('RUNTIME_BUSY', 'Finish this project’s work before reconnecting.')
    this.reserve(host.binary, host.workspace, host.id)
    if (this.selected?.hostId === host.id) this.selected = null
    return this.start(host)
  }
  async closeHost(input: HostEpoch): Promise<void> {
    const host = this.epoch(input)
    if (host.starting || host.operations || (host.runtime.live && host.runtime.busy)) throw new DesktopFailure('RUNTIME_BUSY', 'This project has running, pending or uncertain work. Stop or finish it before closing the connection.')
    if (this.selected?.hostId === host.id) this.selected = null
    host.closing = true
    try {
      await host.runtime.close()
      this.releaseOwners(host)
      if (this.hosts.get(host.id) === host) this.hosts.delete(host.id)
    } finally { host.closing = false; this.emitState(host) }
  }
  selectConversation(input: ConversationSelection | null): void {
    if (input === null) { this.selected = null; return }
    const host = this.epoch(input)
    if (input.sessionId !== null) {
      if (!input.connectionId || host.runtime.connection.status !== 'ready') throw new DesktopFailure('STALE_CONNECTION', 'Select a current connected session.')
      this.requireOwner(host, input.connectionId, input.sessionId)
    }
    this.selected = { ...input }
  }
  async request<M extends DesktopMethod>(input: DesktopRequest<M>): Promise<RpcMethods[M]['result']> {
    const host = this.byConnection(input.connectionId)
    if (input.method === 'session/open') return this.open(host, input as DesktopRequest<'session/open'>) as Promise<RpcMethods[M]['result']>
    if (input.method === 'session/list') throw new DesktopFailure('BOUNDED_REQUIRED', 'Use paged session heads instead of an unbounded session list.')
    if (input.method === 'session/listHeads') return this.listHeads(host, input as DesktopRequest<'session/listHeads'>) as Promise<RpcMethods[M]['result']>
    if (input.method === 'session/children') {
      const { parent, maxBytes } = input.params as RpcMethods['session/children']['params']
      this.requireOwner(host, input.connectionId, parent)
      this.checkBudget(maxBytes)
    }
    if (input.method === 'session/history') {
      this.checkBudget((input.params as RpcMethods['session/history']['params']).page?.maxBytes)
      this.requireOwner(host, input.connectionId, (input.params as RpcMethods['session/history']['params']).session)
      const result = await host.runtime.request(input as DesktopRequest<'session/history'>) as HistoryResult
      const ref = result.oversized
      if (ref) this.rememberReference(host, input.connectionId, (input.params as RpcMethods['session/history']['params']).session, 'item', ref.availability, ref.totalBytes, ref.checksum, ref.id, result.generation)
      return result as RpcMethods[M]['result']
    }
    if (input.method === 'gateway/subscribe') {
      const requested = (input.params as RpcMethods['gateway/subscribe']['params']).maxBytes
      if (requested !== undefined && requested !== null) this.checkBudget(requested)
      return host.runtime.request({ connectionId: input.connectionId, method: 'gateway/subscribe', params: { maxBytes: DEFAULT_BOUNDED_BYTES } }) as Promise<RpcMethods[M]['result']>
    }
    if ('session' in input.params && typeof input.params.session === 'string') this.requireOwner(host, input.connectionId, input.params.session)
    return host.runtime.request(input)
  }
  async deleteSession(connectionId: string, session: string): Promise<void> {
    const host = this.byConnection(connectionId)
    this.refuseForeignOwner(host, session)
    if (!this.owns(host, connectionId, session)) await this.open(host, { connectionId, method: 'session/open', params: { selector: { kind: 'byId', id: session } } })
    this.requireOwner(this.byConnection(connectionId), connectionId, session)
    await host.runtime.deleteSession(connectionId, session)
    this.owners.delete(session)
    if (this.selected?.connectionId === connectionId && this.selected.sessionId === session) this.selected = { ...this.selected, sessionId: null }
  }
  abort(error: DesktopFailure): void {
    if (this.invalidated) return
    this.invalidated = true
    this.selected = null
    this.references.clear()
    for (const host of this.hosts.values()) host.runtime.abort(error)
    this.emit({ type: 'runtime-invalidated', error: { code: error.code.slice(0, 128), message: error.message.slice(0, 2048) } })
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.selected = null
    this.closing = Promise.allSettled([...this.hosts.values()].map(async host => { await host.runtime.close(); this.releaseOwners(host) })).then(results => {
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    }).finally(() => { this.closing = null })
    return this.closing
  }
  private admitConnection(): void {
    if (this.closing) throw new DesktopFailure('RUNTIME_CLOSING', 'The runtime connections are still closing.')
    this.beforeConnect()
    this.invalidated = false
  }
  private reserve(binary: string, workspace: string, id: string): void {
    const live = [...this.hosts.values()].filter(host => host.runtime.live || host.starting || host.closing)
    if (live.some(host => host.workspace === workspace && host.id !== id)) throw new DesktopFailure('WORKSPACE_IN_USE', 'Close the existing project runtime before changing its binary.')
    if (!live.some(host => host.id === id) && live.length >= MAX_RUNTIME_HOSTS) throw new DesktopFailure('HOST_LIMIT', `Up to ${MAX_RUNTIME_HOSTS} project runtimes may run at once. Close an idle project connection first.`)
  }
  private start(host: Host): Promise<ConnectionState> {
    const task = host.runtime.connect(host.binary, host.workspace).then(() => this.state(host)).finally(() => { if (host.starting === task) host.starting = null })
    host.starting = task
    return task
  }
  private state(host: Host): ConnectionState {
    const connection = host.runtime.connection
    return { ...connection, hostId: host.id, binary: host.binary, workspace: host.workspace, busy: host.closing || host.operations > 0 || host.runtime.hasPending || (host.runtime.live && connection.busy) }
  }
  private epoch(input: HostEpoch): Host {
    const host = this.hosts.get(input.hostId)
    if (host?.closing) throw new DesktopFailure('RUNTIME_CLOSING', 'This project runtime is still closing.')
    if (!host || host.runtime.connection.connectionId !== input.connectionId) throw new DesktopFailure('STALE_CONNECTION', 'This project connection has changed. Refresh its snapshot.')
    return host
  }
  private byConnection(connectionId: string): Host {
    const host = [...this.hosts.values()].find(host => host.runtime.connection.connectionId === connectionId)
    if (!host || this.invalidated) throw new DesktopFailure('STALE_CONNECTION', 'This request belongs to an old runtime epoch.')
    if (host.runtime.connection.status !== 'ready') throw new DesktopFailure('DISCONNECTED', 'Reconnect this project before continuing.')
    return host
  }
  private owns(host: Host, connectionId: string, session: string): boolean { const owner = this.owners.get(session); return owner?.hostId === host.id && owner.connectionId === connectionId }
  private refuseForeignOwner(host: Host, session: string): void {
    const owner = this.owners.get(session)
    if (!owner || owner.hostId === host.id) return
    const other = this.hosts.get(owner.hostId)
    if (!other || !other.runtime.live) { this.owners.delete(session); return }
    throw new DesktopFailure('SESSION_NOT_OWNED', 'This saved session is open in another project runtime. Return to its owning project.')
  }
  private requireOwner(host: Host, connectionId: string, session: string): void {
    if (!this.owns(host, connectionId, session)) throw new DesktopFailure('SESSION_NOT_OWNED', 'Open this session in its owning project and current connection first.')
  }
  private releaseOwners(host: Host): void {
    if (host.runtime.live) return
    for (const [key, ref] of this.references) if (ref.hostId === host.id) this.references.delete(key)
    for (const [session, owner] of this.owners) if (owner.hostId === host.id) this.owners.delete(session)
  }
  private checkBudget(value: number | null | undefined): void {
    if (!Number.isSafeInteger(value) || value! < MIN_BOUNDED_BYTES || value! > DEFAULT_BOUNDED_BYTES) throw new DesktopFailure('INVALID_BUDGET', 'Request a bounded page between 1 KiB and 4 MiB.')
  }
  private async listHeads(host: Host, input: DesktopRequest<'session/listHeads'>): Promise<RpcMethods['session/listHeads']['result']> {
    const { filter, after, maxBytes } = input.params
    this.checkBudget(maxBytes)
    if (filter && Object.keys(filter).some(key => key !== 'cwd' && key !== 'parent')) throw new DesktopFailure('INVALID_INPUT', 'Only project cwd and parent filters are allowed for session heads.')
    if (filter?.cwd !== undefined && filter.cwd !== host.workspace) throw new DesktopFailure('WORKSPACE_MISMATCH', 'List session heads in the addressed project only.')
    if (filter?.parent) this.requireOwner(host, input.connectionId, filter.parent)
    const result = await host.runtime.request({ connectionId: input.connectionId, method: 'session/listHeads', params: { ...input.params, filter: { ...filter, cwd: host.workspace } } })
    if (result.heads.some(head => head.cwd !== host.workspace || filter?.parent && head.parent?.session !== filter.parent)) throw new DesktopFailure('WORKSPACE_MISMATCH', 'The runtime returned a session head outside the approved project or parent.')
    if (result.next && (!result.heads.length || result.next !== result.heads.at(-1)?.id || after && result.next <= after)) throw new DesktopFailure('INVALID_PROTOCOL', 'The runtime returned a non-progressing session head cursor.')
    return result
  }
  private async findHead(host: Host, connectionId: string, selector: { kind: 'byId'; id: string } | { kind: 'byKey'; key: string }): Promise<SummaryHead> {
    let after: string | null = null, previousId: string | null = null, matching: SummaryHead | null = null
    for (;;) {
      const page = await this.listHeads(host, { connectionId, method: 'session/listHeads', params: { filter: { cwd: host.workspace }, after, maxBytes: DEFAULT_BOUNDED_BYTES } })
      for (const head of page.heads) {
        if (previousId !== null && head.id <= previousId) throw new DesktopFailure('INVALID_PROTOCOL', 'The runtime returned unordered or repeated session heads.')
        previousId = head.id
        if (selector.kind === 'byKey' && head.omitted?.some(field => field.field === 'key')) throw new DesktopFailure('SESSION_HEAD_INCOMPLETE', 'This session key is omitted from the bounded list. Open the saved session by its verified id instead.')
        if (selector.kind === 'byId' && head.id === selector.id) return head
        if (selector.kind === 'byKey' && head.key === selector.key && (!matching || head.updatedAt > matching.updatedAt)) matching = head
      }
      if (!page.next) break
      after = page.next
    }
    if (matching) return matching
    throw new DesktopFailure('SESSION_NOT_OWNED', 'This saved session does not belong to the addressed project.')
  }
  private async open(host: Host, input: DesktopRequest<'session/open'>): Promise<OpenResult> {
    const selector = input.params.selector
    if (selector.kind === 'create' && selector.spec.cwd !== undefined && selector.spec.cwd !== host.workspace || selector.kind === 'latest' && selector.cwd !== host.workspace) throw new DesktopFailure('WORKSPACE_MISMATCH', 'New sessions must use the addressed project.')
    let session: string | undefined = selector.kind === 'byId' ? selector.id : undefined
    if (session) this.refuseForeignOwner(host, session)
    host.operations += 1; this.emitState(host)
    try {
      if (selector.kind === 'byId' || selector.kind === 'byKey') {
        // The legacy full session/list can itself contain a 17 MiB title/key.
        // Search stable ID/cwd pages before asking Core to open the saved id.
        if (selector.kind === 'byKey' || !this.owns(host, input.connectionId, selector.id)) session = (await this.findHead(host, input.connectionId, selector)).id
        this.refuseForeignOwner(host, session!)
      }
      if (session && this.opening.has(session)) throw new DesktopFailure('SESSION_OPENING', 'This saved session is already being opened. Wait for that request to finish.')
      if (session) this.opening.add(session)
      try {
        if (input.params.options?.maxSnapshotBytes !== undefined && input.params.options.maxSnapshotBytes !== null) this.checkBudget(input.params.options.maxSnapshotBytes)
        if (!input.params.options?.children && input.params.options?.treeBackfill) throw new DesktopFailure('INVALID_INPUT', 'Tree backfill requires an opened root with children.')
        const options: NonNullable<RpcMethods['session/open']['params']['options']> = { ...input.params.options, maxSnapshotBytes: DEFAULT_BOUNDED_BYTES, ...(input.params.options?.children ? { treeBackfill: 'liveOnly' as const } : {}) }
        const result = await host.runtime.request({ ...input, params: { ...input.params, options, selector: selector.kind === 'create' ? { ...selector, spec: { ...selector.spec, cwd: host.workspace } } : selector.kind === 'byKey' ? { kind: 'byId', id: session! } : selector } })
        this.byConnection(input.connectionId)
        if (!result.history || options.children && (result.tree?.backfill !== 'liveOnly' || result.tree.descendantsComplete !== false)) {
          host.runtime.abort(new DesktopFailure('INVALID_PROTOCOL', 'The runtime did not provide a bounded authoritative snapshot and explicit tree gap.'))
          throw new DesktopFailure('INVALID_PROTOCOL', 'The runtime did not provide a bounded snapshot. Update bingo and reconnect.')
        }
        if (result.session !== result.snapshot.summary.id || session && result.session !== session) {
          host.runtime.abort(new DesktopFailure('INVALID_PROTOCOL', 'The runtime opened a different session than requested.'))
          throw new DesktopFailure('INVALID_PROTOCOL', 'The runtime returned an unrelated session identity.')
        }
        if (result.snapshot.summary.cwd !== host.workspace) {
          host.runtime.abort(new DesktopFailure('WORKSPACE_MISMATCH', 'The runtime opened a session outside its approved project.'))
          throw new DesktopFailure('WORKSPACE_MISMATCH', 'The session belongs to another project.')
        }
        this.refuseForeignOwner(host, result.session)
        this.owners.set(result.session, { hostId: host.id, connectionId: input.connectionId })
        this.clearSessionReferences(host.id, result.session)
        for (const omitted of result.omittedFields ?? []) this.rememberReference(host, input.connectionId, result.session, 'field', omitted.availability, omitted.totalBytes, omitted.checksum)
        return result
      } finally { if (session) this.opening.delete(session) }
    } finally { host.operations -= 1; this.emitState(host) }
  }
  private clearSessionReferences(hostId: string, session: string): void {
    for (const [key, ref] of this.references) if (ref.hostId === hostId && ref.session === session) this.references.delete(key)
  }
  private rememberReference(host: Host, connectionId: string, session: string, kind: PartRequest['kind'], availability: ReferenceAvailability, totalBytes: number, checksum: string, item?: string, generation?: number): void {
    if (!Number.isSafeInteger(totalBytes) || totalBytes < 1 || !/^[0-9a-f]{16}$/.test(checksum)) throw new DesktopFailure('INVALID_PROTOCOL', 'The runtime returned invalid recorded-content integrity metadata.')
    if (availability.kind === 'unavailable') return // No token exists; never invent one.
    if (!availability.token || availability.token.length > 256) throw new DesktopFailure('INVALID_PROTOCOL', 'The runtime returned an invalid reference token.')
    const key = JSON.stringify([connectionId, availability.token])
    const ref: OwnedReference = { hostId: host.id, connectionId, session, kind, token: availability.token, totalBytes, checksum, ...(item === undefined ? {} : { item }), ...(generation === undefined ? {} : { generation }) }
    const previous = this.references.get(key)
    if (previous && JSON.stringify(previous) !== JSON.stringify(ref)) throw new DesktopFailure('INVALID_PROTOCOL', 'The runtime reused a token for different recorded content.')
    if (!previous && this.references.size >= 32 * MAX_RUNTIME_HOSTS) throw new DesktopFailure('PROTOCOL_LIMIT', 'The runtime exceeded its bounded reference budget.')
    this.references.set(key, ref)
  }
  private emitState(host: Host): void { if (!this.invalidated) this.emit({ type: 'connection', connection: this.state(host) }) }
  private receive(id: string, event: DesktopEvent): void {
    const host = this.hosts.get(id)
    if (!host || this.invalidated) return
    if (event.type === 'connection') {
      if (event.connection.status !== 'ready') for (const [key, ref] of this.references) if (ref.hostId === host.id) this.references.delete(key)
      this.releaseOwners(host); this.emitState(host); return
    }
    if (event.type === 'rpc' && event.method === 'eventRef') {
      const ref = event.params
      try { this.rememberReference(host, event.connectionId, ref.session, 'event', ref.availability, ref.totalBytes, ref.checksum, ref.item ?? undefined, ref.generation) }
      catch (error) { host.runtime.abort(error instanceof DesktopFailure ? error : new DesktopFailure('INVALID_PROTOCOL', 'An invalid event reference was emitted.')); return }
    }
    // A native child notification can create sessions, but ownership is granted
    // only after a successful explicit open in this connection epoch.
    this.emit(event)
  }
}
