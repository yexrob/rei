import type { BingoGuiApi } from '../../shared/contracts/ipc'

declare global {
  interface Window {
    bingoGui: BingoGuiApi
  }
}

export {}
