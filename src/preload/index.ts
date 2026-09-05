import { contextBridge, ipcRenderer } from 'electron'
import { installPanelsBridge } from './panels'
import { DESKTOP_IPC, type BingoDesktopApi, type DesktopEvent } from '../shared/desktop'

const listeners = new Set<(event: DesktopEvent) => void>()
ipcRenderer.on(DESKTOP_IPC.event, (_event, delivery: { id: number; event: DesktopEvent }) => {
  try { for (const listener of listeners) { try { listener(delivery.event) } catch { /* One subscriber must not block the others or the acknowledgement. */ } } }
  finally { ipcRenderer.send('desktop:event-ack', delivery.id) }
})

// The main process validates both sender and input. Never expose ipcRenderer,
// filesystem paths-as-operations, shell access, or Electron event objects.
const api: BingoDesktopApi = {
  bootstrap: () => ipcRenderer.invoke(DESKTOP_IPC.bootstrap),
  connect: (input) => ipcRenderer.invoke(DESKTOP_IPC.connect, input),
  request: (input) => ipcRenderer.invoke(DESKTOP_IPC.request, input),
  chooseWorkspace: () => ipcRenderer.invoke(DESKTOP_IPC.chooseWorkspace),
  chooseBinary: () => ipcRenderer.invoke(DESKTOP_IPC.chooseBinary),
  chooseImages: () => ipcRenderer.invoke(DESKTOP_IPC.chooseImages),
  savePreferences: (input) => ipcRenderer.invoke(DESKTOP_IPC.savePreferences, input),
  openExternal: (url) => ipcRenderer.invoke(DESKTOP_IPC.openExternal, url),
  exportText: (input) => ipcRenderer.invoke(DESKTOP_IPC.exportText, input),
  deleteSession: (input) => ipcRenderer.invoke(DESKTOP_IPC.deleteSession, input),
  configureProvider: (input) => ipcRenderer.invoke(DESKTOP_IPC.configureProvider, input),
  onEvent: (listener) => {
    if (listeners.size >= 32) throw new Error('Too many desktop event subscriptions.')
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
}
contextBridge.exposeInMainWorld('bingoDesktop', Object.freeze(api))
installPanelsBridge()
