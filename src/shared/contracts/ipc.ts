import { z } from 'zod'
import type { CliEvent, CliSessionMetadata, PromptResponse } from './cli'

export const IPC = {
  appGetInfo: 'app:get-info', runtimeProbe: 'runtime:probe', sessionOpen: 'session:open', sessionClose: 'session:close',
  sessionSend: 'session:send', sessionCancel: 'session:cancel', sessionRespondPrompt: 'session:respond-prompt',
  sessionRename: 'session:rename', sessionDelete: 'session:delete',
  settingsReadRuntime: 'settings:read-runtime', settingsListModels: 'settings:list-models', settingsSaveRuntime: 'settings:save-runtime',
  settingsRead: 'settings:read', settingsSave: 'settings:save',
  sessionEvent: 'session:event', sessionList: 'session:list', visualCapture: 'visual:capture'
} as const

export type GuiError = { code: string; msg: string; level: 'field' | 'page' | 'flow'; recoverable: boolean; action?: 'retry' }
export type Result<T> = { ok: true; value: T } | { ok: false; error: GuiError }
export type AppInfo = { appVersion: string; platform: NodeJS.Platform; arch: string; packaged: boolean }
export type RuntimeInfo = { binaryPath: string; bingoVersion: string; protocolVersion: 1; workspacePath: string }
export type RendererSessionMetadata = Omit<CliSessionMetadata, 'transcriptPath'>
export type RendererCliPayload = Exclude<CliEvent, { type: 'protocol.ready' | 'inspection.ready' | 'session.ready' }> | {
  type: 'transport.error'; error: GuiError; exitCode: number | null; signal: string | null
}
export type RendererSessionEvent = { connectionId: string; sequence: number; payload: RendererCliPayload }
export type SessionSummary = { id: string; name: string; preview: string; updatedAt: string; messageCount: number }
export type SessionHistoryItem = { type: 'message'; value: { id: string; role: 'user' | 'assistant'; markdown: string } }
export type SessionListOutput = { sessions: SessionSummary[]; warnings: string[] }
export type SessionOpened = { connectionId: string; metadata: RendererSessionMetadata; history: SessionHistoryItem[] }
export type ProviderView = { name: string; protocol: 'anthropic' | 'openai'; apiBaseUrl: string; supportsImages: boolean; credentialConfigured: boolean; builtin: boolean }
export type RuntimeSettings = { providers: ProviderView[]; provider: string; model: string; thinkingLevel: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
export type EditableSettings = { apiBaseUrl: string; provider: string; model: string; thinkingLevel: RuntimeSettings['thinkingLevel']; permissionMode: string; theme: 'auto' | 'dark' | 'light'; sendImages: boolean }
export type SettingsLayerView = { path: string; exists: boolean; keys: string[]; values: Partial<Record<keyof EditableSettings, unknown>> }
export type SettingsSnapshot = { path: string; revision: string; values: EditableSettings; layers: { user: SettingsLayerView; project: SettingsLayerView; local: SettingsLayerView }; sources: Partial<Record<keyof EditableSettings, string>>; shadowed: Array<keyof EditableSettings>; providers: ProviderView[] }
export type VisualCaptureInput = { runId: string; theme: 'dark' | 'light'; state: 'chat' | 'empty' | 'loading' | 'error'; viewport: '1440x900' | '800x600' }

const uuid = z.string().uuid()
export const sessionOpenInputSchema = z.object({ sessionId: z.string().nullable() })
export const sessionRenameInputSchema = z.object({ sessionId: z.string().min(1).max(255), name: z.string().trim().min(1).max(80) })
export const sessionDeleteInputSchema = z.object({ sessionId: z.string().min(1).max(255) })
export const runtimeSettingsInputSchema = z.object({ workspacePath: z.string().min(1) })
export const modelListInputSchema = runtimeSettingsInputSchema.extend({ provider: z.string().min(1) })
export const runtimeSettingsSaveInputSchema = runtimeSettingsInputSchema.extend({
  provider: z.string().min(1),
  model: z.string().min(1),
  thinkingLevel: z.enum(['off', 'low', 'medium', 'high', 'xhigh', 'max'])
})
export const settingsSaveInputSchema = runtimeSettingsInputSchema.extend({
  baseRevision: z.string().length(64),
  values: z.object({
    apiBaseUrl: z.string(), provider: z.string().min(1), model: z.string().min(1),
    thinkingLevel: z.enum(['off', 'low', 'medium', 'high', 'xhigh', 'max']),
    permissionMode: z.string().min(1), theme: z.enum(['auto', 'dark', 'light']), sendImages: z.boolean()
  })
})
export const connectionInputSchema = z.object({ connectionId: uuid })
export const sessionSendInputSchema = z.object({ connectionId: uuid, turnId: uuid, prompt: z.string().min(1).max(1_000_000) })
export const sessionTurnInputSchema = z.object({ connectionId: uuid, turnId: uuid })
export const sessionPromptInputSchema = sessionTurnInputSchema.extend({
  promptId: uuid,
  response: z.discriminatedUnion('kind', [z.object({ kind: z.literal('option'), optionId: z.string() }), z.object({ kind: z.literal('text'), text: z.string().max(100_000) }), z.object({ kind: z.literal('cancel') })])
})
export const visualCaptureInputSchema = z.object({ runId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), theme: z.enum(['dark', 'light']), state: z.enum(['chat', 'empty', 'loading', 'error']), viewport: z.enum(['1440x900', '800x600']) })

export type BingoGuiApi = {
  getAppInfo(): Promise<Result<AppInfo>>
  probeRuntime(): Promise<Result<RuntimeInfo>>
  listSessions(): Promise<Result<SessionListOutput>>
  openSession(input: { sessionId: string | null }): Promise<Result<SessionOpened>>
  renameSession(input: { sessionId: string; name: string }): Promise<Result<{ previousId: string; session: SessionSummary }>>
  deleteSession(input: { sessionId: string }): Promise<Result<{ deletedId: string }>>
  readRuntimeSettings(input: { workspacePath: string }): Promise<Result<RuntimeSettings>>
  listModels(input: { workspacePath: string; provider: string }): Promise<Result<{ provider: string; models: string[] }>>
  saveRuntimeSettings(input: { workspacePath: string; provider: string; model: string; thinkingLevel: RuntimeSettings['thinkingLevel'] }): Promise<Result<{ connectionId?: string; settings: RuntimeSettings }>>
  readSettings(input: { workspacePath: string }): Promise<Result<SettingsSnapshot>>
  saveSettings(input: { workspacePath: string; baseRevision: string; values: EditableSettings }): Promise<Result<{ connectionId?: string; snapshot: SettingsSnapshot }>>
  closeSession(input: { connectionId: string }): Promise<Result<{ closed: true }>>
  sendTurn(input: { connectionId: string; turnId: string; prompt: string }): Promise<Result<{ accepted: true }>>
  cancelTurn(input: { connectionId: string; turnId: string }): Promise<Result<{ requested: true }>>
  respondToPrompt(input: { connectionId: string; turnId: string; promptId: string; response: PromptResponse }): Promise<Result<{ accepted: true }>>
  captureVisual(input: VisualCaptureInput): Promise<Result<{ absolutePath: string }>>
  onSessionEvent(listener: (event: RendererSessionEvent) => void): () => void
}
