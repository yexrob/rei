export const IPC = {
  appGetInfo: 'app:get-info',
  runtimeProbe: 'runtime:probe'
} as const

export type GuiError = {
  code: string
  msg: string
  level: 'field' | 'page' | 'flow'
  recoverable: boolean
  action?: 'retry'
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: GuiError }

export type AppInfo = {
  appVersion: string
  platform: NodeJS.Platform
  arch: string
  packaged: boolean
}

export type RuntimeProbeInput = {
  workspacePath: string
}

export type RuntimeInfo = {
  binaryPath: string
  bingoVersion: string
  protocolVersion: 1
  workspacePath: string
}

export type BingoGuiApi = {
  getAppInfo: () => Promise<Result<AppInfo>>
  probeRuntime: () => Promise<Result<RuntimeInfo>>
}
