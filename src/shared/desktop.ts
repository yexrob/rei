import type { EventParams, EventRefParams, GatewayEvent, GatewaySessionHeadParams, Image, InitializeResult, RpcMethods } from './rpc'

export const DESKTOP_IMAGE_LIMITS = { count: 2, bytesPerImage: 5 * 1024 * 1024 } as const
export type DesktopError = { code: string; message: string }
export type Result<T> = { ok: true; value: T } | { ok: false; error: DesktopError }
export type DesktopPreferences = {
  theme: 'system' | 'light' | 'dark'
  workspace: string | null
  binaryPath: string | null
  recentWorkspaces: string[]
}
export type ConfigureProviderInput = { name: string; protocol: 'openai' | 'anthropic'; baseUrl: string; apiKey: string }
export type PreferencesPatch = Partial<Pick<DesktopPreferences, 'theme' | 'workspace' | 'binaryPath'>>
export type HostEpoch = { hostId: string; connectionId: string | null }
// A null session is the host's unsent draft, not a request to create a session.
// Native admission rejects a non-null session without a current, opened epoch.
export type ConversationSelection = HostEpoch & { sessionId: string | null }
export type AgentPageTarget = { hostId: string; connectionId: string; sessionId: string; itemId: string }
export type AgentPageState = AgentPageTarget & { title: string; status: 'available' | 'opened' | 'invalidated' }
export type ConnectionState = {
  // Main-pool publication order, shared by invoke snapshots and event delivery.
  // Optional only for legacy desktop fixtures; a versioned host never downgrades.
  revision?: number
  // Stable across app restarts for the same approved canonical workspace/binary.
  hostId: string
  status: 'disconnected' | 'connecting' | 'ready' | 'failed'
  // One child-process epoch; never reused after reconnect. Failure retains it.
  connectionId: string | null
  // Native aggregate: turns, queued work, interactions, pending requests/open and uncertainty.
  busy: boolean
  workspace: string | null
  binary: string | null
  server?: InitializeResult
  error?: DesktopError
}
export type DesktopBootstrap = {
  version: string
  platform: string
  scratchWorkspace: string
  preferences: DesktopPreferences
  binary: { path: string | null; source: string }
  connections: ConnectionState[]
  // Native foreground context. Background connection changes never select a host.
  selection: ConversationSelection | null
  // Only still-valid pages. An 'opened' snapshot is not a new show-panel command.
  agentPages: AgentPageState[]
}
export const DESKTOP_METHODS = [
  'session/list', 'session/listHeads', 'session/open', 'session/history', 'session/children', 'session/events',
  'session/submit', 'session/interrupt', 'session/answer', 'catalog/read', 'gateway/subscribe'
] as const
export type DesktopMethod = typeof DESKTOP_METHODS[number]
export type DesktopRequest<M extends DesktopMethod = DesktopMethod> = {
  connectionId: string
  method: M
  params: RpcMethods[M]['params']
}
// Opt-in replies travel through the SAME 256/4096/32 MiB acknowledged window
// as runtime events; invoking these methods never returns their body directly.
export type BoundedMethod = 'session/listHeads' | 'session/open' | 'session/history' | 'session/children'
export type BoundedRequest<M extends BoundedMethod = BoundedMethod> = { transferId: string; hostId: string; request: DesktopRequest<M> }
export type PartRequest =
  | { transferId: string; hostId: string; connectionId: string; session: string; kind: 'item'; item: string; generation: number; token: string; offset: number; maxBytes: number }
  | { transferId: string; hostId: string; connectionId: string; session: string; kind: 'field' | 'event'; token: string; offset: number; maxBytes: number }
export type TransferCancel = { transferId: string; connectionId: string; session: string | null }
// Raw serialized JSON is written only after a native Save dialog explicitly
// approves a destination; no large text or filesystem path crosses the bridge.
export type ExportReferenceRequest =
  | { transferId: string; hostId: string; connectionId: string; session: string; kind: 'item'; item: string; generation: number; token: string; totalBytes: number; checksum: string; suggestedName: string }
  | { transferId: string; hostId: string; connectionId: string; session: string; kind: 'field' | 'event'; token: string; totalBytes: number; checksum: string; suggestedName: string }
export type ExportProgress = { type: 'export-progress'; transferId: string; hostId: string; connectionId: string; session: string; doneBytes: number; totalBytes: number; status: 'running' | 'completed' | 'cancelled' | 'failed' }
export type TransferSource = { transferId: string; hostId: string; connectionId: string; session: string | null }
export type BoundedDelivery = {
  [M in BoundedMethod]: TransferSource & { kind: 'response'; method: M; result: RpcMethods[M]['result'] }
}[BoundedMethod] | (TransferSource & { kind: 'part'; partKind: PartRequest['kind']; item?: string; generation?: number; token: string; offset: number; nextOffset: number | null; totalBytes: number; data: string })
export type BoundedReceipt = TransferSource & (
  | { kind: 'response'; method: BoundedMethod; acceptedBytes: number }
  | { kind: 'part'; partKind: PartRequest['kind']; offset: number; nextOffset: number | null; totalBytes: number }
)
export type DesktopEvent =
  | { type: 'connection'; connection: ConnectionState }
  | { type: 'rpc'; connectionId: string; method: 'event'; params: EventParams }
  | { type: 'rpc'; connectionId: string; method: 'gateway/event'; params: GatewayEvent }
  // Opt-in transport-only references and bounded gateway discovery carry a
  // native-qualified connectionId; neither is a fabricated canonical Frame.
  | { type: 'rpc'; connectionId: string; method: 'eventRef'; params: EventRefParams }
  | { type: 'rpc'; connectionId: string; method: 'gateway/sessionHead'; params: GatewaySessionHeadParams }
  | ExportProgress
  // One bounded renderer-wide failure, not a list of host snapshots/capabilities.
  | { type: 'runtime-invalidated'; error: DesktopError }
  // Only an opened event matching the foreground target may expand the browser.
  | { type: 'agent-page'; page: AgentPageState }
  | { type: 'menu'; action: 'new-session' | 'choose-workspace' | 'preferences' }
export interface BingoDesktopApi {
  bootstrap(): Promise<Result<DesktopBootstrap>>
  // Ensure/reuse one approved host. Does not select it or stop other hosts.
  connect(input: { workspace?: string; binary?: string }): Promise<Result<ConnectionState>>
  // Replace only the named current epoch; never automatically resend an intent.
  reconnect(input: HostEpoch): Promise<Result<ConnectionState>>
  // Reclaim an idle host, not its journals/drafts. Busy/uncertain work is refused.
  closeHost(input: HostEpoch): Promise<Result<void>>
  // Synchronously validate the expected epoch and set native panel context.
  // Closing/reconnecting this selected host clears selection, never selects another.
  selectConversation(input: ConversationSelection | null): Promise<Result<void>>
  // Native revalidates the running item and resolves its URL; renderer supplies no URL.
  openAgentPage(input: AgentPageTarget): Promise<Result<void>>
  request<M extends DesktopMethod>(input: DesktopRequest<M>): Promise<Result<RpcMethods[M]['result']>>
  requestBounded<M extends BoundedMethod>(input: BoundedRequest<M>): Promise<Result<BoundedReceipt>>
  cancelBounded(input: TransferCancel): Promise<Result<void>>
  readPart(input: PartRequest): Promise<Result<BoundedReceipt>>
  cancelPart(input: TransferCancel): Promise<Result<void>>
  exportReference(input: ExportReferenceRequest): Promise<Result<boolean>>
  cancelExport(input: TransferCancel): Promise<Result<void>>
  // Exactly one async consumer; preload ACKs only after this promise fulfills.
  onBounded(listener: (delivery: BoundedDelivery) => Promise<void>): () => void
  onEvent(listener: (event: DesktopEvent) => void): () => void
  chooseWorkspace(): Promise<Result<string | null>>
  chooseBinary(): Promise<Result<string | null>>
  chooseImages(): Promise<Result<Image[]>>
  savePreferences(input: PreferencesPatch): Promise<Result<DesktopPreferences>>
  openExternal(url: string): Promise<Result<void>>
  exportText(input: { text: string; suggestedName: string }): Promise<Result<boolean>>
  deleteSession(input: { connectionId: string; session: string }): Promise<Result<boolean>>
  configureProvider(input: ConfigureProviderInput): Promise<Result<void>>
}
export const DESKTOP_IPC = {
  bootstrap: 'desktop:bootstrap', connect: 'desktop:connect', reconnect: 'desktop:reconnect',
  closeHost: 'desktop:close-host', selectConversation: 'desktop:select-conversation', openAgentPage: 'desktop:open-agent-page', request: 'desktop:request',
  requestBounded: 'desktop:request-bounded', cancelBounded: 'desktop:cancel-bounded',
  readPart: 'desktop:read-part', cancelPart: 'desktop:cancel-part',
  exportReference: 'desktop:export-reference', cancelExport: 'desktop:cancel-export',
  boundedPacket: 'desktop:bounded-packet', boundedAck: 'desktop:bounded-ack',
  event: 'desktop:event', chooseWorkspace: 'desktop:choose-workspace',
  chooseBinary: 'desktop:choose-binary', chooseImages: 'desktop:choose-images',
  savePreferences: 'desktop:save-preferences', openExternal: 'desktop:open-external',
  exportText: 'desktop:export-text', deleteSession: 'desktop:delete-session', configureProvider: 'desktop:configure-provider'
} as const

declare global {
  interface Window { bingoDesktop: BingoDesktopApi }
}
