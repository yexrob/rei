import type { EventParams, GatewayEvent, Image, InitializeResult, RpcMethods } from './rpc'

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
export type ConnectionState = {
  status: 'disconnected' | 'connecting' | 'ready' | 'failed'
  connectionId: string | null
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
  connection: ConnectionState
}
export const DESKTOP_METHODS = [
  'session/list', 'session/open', 'session/history', 'session/events',
  'session/submit', 'session/interrupt', 'session/answer', 'catalog/read', 'gateway/subscribe'
] as const
export type DesktopMethod = typeof DESKTOP_METHODS[number]
export type DesktopRequest<M extends DesktopMethod = DesktopMethod> = {
  connectionId: string
  method: M
  params: RpcMethods[M]['params']
}
export type DesktopEvent =
  | { type: 'connection'; connection: ConnectionState }
  | { type: 'rpc'; connectionId: string; method: 'event'; params: EventParams }
  | { type: 'rpc'; connectionId: string; method: 'gateway/event'; params: GatewayEvent }
  | { type: 'menu'; action: 'new-session' | 'choose-workspace' | 'preferences' }
export interface BingoDesktopApi {
  bootstrap(): Promise<Result<DesktopBootstrap>>
  connect(input: { workspace?: string; binary?: string }): Promise<Result<ConnectionState>>
  request<M extends DesktopMethod>(input: DesktopRequest<M>): Promise<Result<RpcMethods[M]['result']>>
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
  bootstrap: 'desktop:bootstrap', connect: 'desktop:connect', request: 'desktop:request',
  event: 'desktop:event', chooseWorkspace: 'desktop:choose-workspace',
  chooseBinary: 'desktop:choose-binary', chooseImages: 'desktop:choose-images',
  savePreferences: 'desktop:save-preferences', openExternal: 'desktop:open-external',
  exportText: 'desktop:export-text', deleteSession: 'desktop:delete-session', configureProvider: 'desktop:configure-provider'
} as const

declare global {
  interface Window { bingoDesktop: BingoDesktopApi }
}
