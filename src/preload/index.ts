import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type BingoGuiApi } from '../shared/contracts/ipc'

const api: BingoGuiApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
  probeRuntime: () => ipcRenderer.invoke(IPC.runtimeProbe)
}

contextBridge.exposeInMainWorld('bingoGui', api)
