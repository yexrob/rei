import type { Result } from './desktop'

export type BrowserState = { url: string; title: string; canGoBack: boolean; canGoForward: boolean; loading: boolean; error: string | null }
export type PanelBounds = { x: number; y: number; width: number; height: number }
export type BrowserLayout = { visible: boolean; bounds: PanelBounds }
export type BrowserAction = 'back' | 'forward' | 'reload' | 'stop' | 'open-external' | 'focus'
export type TerminalState = { id: string | null; status: 'idle' | 'running' | 'stopping' | 'exited'; cwd: string | null; exitCode: number | null; error: string | null }
export type PanelsSnapshot = { browser: BrowserState; terminal: TerminalState }
export type PanelsEvent =
  | { type: 'browser'; state: BrowserState }
  | { type: 'browser-open'; url: string }
  | { type: 'browser-focus-address' }
  | { type: 'terminal'; state: TerminalState }
  | { type: 'terminal-data'; id: string; sequence: number; data: string }
export interface BingoPanelsApi {
  snapshot(): Promise<Result<PanelsSnapshot>>
  browserNavigate(url: string): Promise<Result<void>>
  browserAction(action: BrowserAction): Promise<Result<void>>
  browserLayout(layout: BrowserLayout): Promise<Result<void>>
  terminalStart(): Promise<Result<TerminalState>>
  terminalWrite(input: { id: string; data: string }): Promise<Result<void>>
  terminalResize(input: { id: string; cols: number; rows: number }): Promise<Result<void>>
  terminalStop(id: string): Promise<Result<void>>
  terminalAck(input: { id: string; sequence: number }): Promise<Result<void>>
  onEvent(listener: (event: PanelsEvent) => void): () => void
}
export const PANELS_IPC = {
  snapshot: 'panels:snapshot', browserNavigate: 'panels:browser-navigate', browserAction: 'panels:browser-action',
  browserLayout: 'panels:browser-layout', terminalStart: 'panels:terminal-start', terminalWrite: 'panels:terminal-write',
  terminalResize: 'panels:terminal-resize', terminalStop: 'panels:terminal-stop', terminalAck: 'panels:terminal-ack', event: 'panels:event'
} as const

declare global { interface Window { bingoPanels: BingoPanelsApi } }
