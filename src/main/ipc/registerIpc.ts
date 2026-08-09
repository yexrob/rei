import { app, ipcMain } from 'electron'
import { IPC, type AppInfo, type Result, type RuntimeInfo } from '../../shared/contracts/ipc'
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

  ipcMain.handle(IPC.runtimeProbe, (): Promise<Result<RuntimeInfo>> => {
    return locator.probe(process.env.BINGO_GUI_CWD ?? process.cwd())
  })
}
