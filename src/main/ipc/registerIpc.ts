import { app, ipcMain } from 'electron'
import { IPC, type AppInfo, type Result, type RuntimeInfo, type RuntimeProbeInput } from '../../shared/contracts/ipc'
import { RuntimeLocator } from '../runtime/runtimeLocator'

export function registerIpc(locator: RuntimeLocator): void {
  ipcMain.handle(IPC.appGetInfo, (): Result<AppInfo> => ({
    ok: true,
    value: {
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged
    }
  }))

  ipcMain.handle(IPC.runtimeProbe, (_event, input: RuntimeProbeInput): Promise<Result<RuntimeInfo>> => {
    if (!input || typeof input.workspacePath !== 'string') {
      return Promise.resolve({
        ok: false,
        error: {
          code: 'BAD_ARGUMENT',
          msg: 'The workspace request was invalid. Reload the app and retry.',
          level: 'flow',
          recoverable: true,
          action: 'retry'
        }
      })
    }
    return locator.probe(input.workspacePath)
  })
}
