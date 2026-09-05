import { contextBridge, ipcRenderer } from 'electron'
import { PANELS_IPC, type BingoPanelsApi, type PanelsEvent } from '../shared/panels'

let installed = false
export function installPanelsBridge(): void {
  if (installed) return
  installed = true
  const listeners = new Set<(event: PanelsEvent) => void>()
  ipcRenderer.on(PANELS_IPC.event, (_event, event: PanelsEvent) => {
    for (const listener of listeners) { try { listener(event) } catch { /* Isolate subscribers; never expose the Electron event. */ } }
  })
  const api: BingoPanelsApi = {
    snapshot: () => ipcRenderer.invoke(PANELS_IPC.snapshot),
    browserNavigate: (url) => ipcRenderer.invoke(PANELS_IPC.browserNavigate, url),
    browserAction: (action) => ipcRenderer.invoke(PANELS_IPC.browserAction, action),
    browserLayout: (layout) => ipcRenderer.invoke(PANELS_IPC.browserLayout, layout),
    terminalStart: () => ipcRenderer.invoke(PANELS_IPC.terminalStart),
    terminalWrite: (input) => ipcRenderer.invoke(PANELS_IPC.terminalWrite, input),
    terminalResize: (input) => ipcRenderer.invoke(PANELS_IPC.terminalResize, input),
    terminalStop: (id) => ipcRenderer.invoke(PANELS_IPC.terminalStop, id),
    terminalAck: (input) => ipcRenderer.invoke(PANELS_IPC.terminalAck, input),
    onEvent: (listener) => {
      if (listeners.size >= 16) throw new Error('Too many panel event subscriptions.')
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  }
  contextBridge.exposeInMainWorld('bingoPanels', Object.freeze(api))
}
