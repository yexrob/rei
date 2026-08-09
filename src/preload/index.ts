import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type BingoGuiApi } from '../shared/contracts/ipc'

const api: BingoGuiApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
  probeRuntime: () => ipcRenderer.invoke(IPC.runtimeProbe, { workspacePath: process.cwd() })
}

contextBridge.exposeInMainWorld('bingoGui', api)
