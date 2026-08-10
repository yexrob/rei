import type { CliEvent, CliSessionMetadata, PromptResponse } from '../../shared/contracts/cli'

export type BingoSessionHandlers = {
  onEvent: (event: CliEvent) => void
  onExit: (error: Error | null) => void
}

export class BingoCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly level: 'field' | 'page' | 'flow',
    readonly recoverable: boolean
  ) {
    super(message)
    this.name = 'BingoCommandError'
  }
}

export interface BingoSession {
  open(sessionId?: string): Promise<CliSessionMetadata>
  sendTurn(turnId: string, prompt: string): Promise<void>
  cancelTurn(turnId: string): Promise<void>
  respondToPrompt(turnId: string, promptId: string, response: PromptResponse): Promise<void>
  rename(name: string): Promise<CliSessionMetadata>
  delete(): Promise<string>
  close(): Promise<void>
}
