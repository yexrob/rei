import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC, connectionInputSchema, sessionOpenInputSchema, sessionPromptInputSchema, sessionSendInputSchema,
  sessionTurnInputSchema, visualCaptureInputSchema, type BingoGuiApi, type RendererSessionEvent
} from '../shared/contracts/ipc'

const api: BingoGuiApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
  probeRuntime: () => ipcRenderer.invoke(IPC.runtimeProbe),
  openSession: (input) => ipcRenderer.invoke(IPC.sessionOpen, sessionOpenInputSchema.parse(input)),
  closeSession: (input) => ipcRenderer.invoke(IPC.sessionClose, connectionInputSchema.parse(input)),
  sendTurn: (input) => ipcRenderer.invoke(IPC.sessionSend, sessionSendInputSchema.parse(input)),
  cancelTurn: (input) => ipcRenderer.invoke(IPC.sessionCancel, sessionTurnInputSchema.parse(input)),
  respondToPrompt: (input) => ipcRenderer.invoke(IPC.sessionRespondPrompt, sessionPromptInputSchema.parse(input)),
  captureVisual: (input) => ipcRenderer.invoke(IPC.visualCapture, visualCaptureInputSchema.parse(input)),
  onSessionEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: RendererSessionEvent): void => listener(value)
    ipcRenderer.on(IPC.sessionEvent, handler)
    return () => ipcRenderer.removeListener(IPC.sessionEvent, handler)
  }
}

contextBridge.exposeInMainWorld('bingoGui', api)
