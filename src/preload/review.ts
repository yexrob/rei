import { contextBridge, ipcRenderer } from 'electron'
import { REVIEW_IPC, type BingoReviewApi } from '../shared/review'

export function installReviewBridge(): void {
  const api: BingoReviewApi = { snapshot: (input) => ipcRenderer.invoke(REVIEW_IPC.snapshot, input) }
  contextBridge.exposeInMainWorld('bingoReview', Object.freeze(api))
}
