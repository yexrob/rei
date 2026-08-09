import type { CliEvent, CliSessionMetadata, PromptResponse } from '../../shared/contracts/cli'

export type BingoSessionHandlers = {
  onEvent: (event: CliEvent) => void
  onExit: (error: Error | null) => void
}

export interface BingoSession {
  open(sessionId?: string): Promise<CliSessionMetadata>
  sendTurn(turnId: string, prompt: string): Promise<void>
  cancelTurn(turnId: string): Promise<void>
  respondToPrompt(turnId: string, promptId: string, response: PromptResponse): Promise<void>
  close(): Promise<void>
}
