import { randomUUID } from 'node:crypto'
import type { CliEvent, CliSessionMetadata, PromptResponse } from '../../shared/contracts/cli'
import type { BingoSession, BingoSessionHandlers } from './bingoSession'

export type ManagedSessionEvent = { connectionId: string; sequence: number; payload: CliEvent }
export type SessionFactory = (handlers: BingoSessionHandlers) => BingoSession

type Active = { connectionId: string; sessionId: string; session: BingoSession; sequence: number; turnId: string | null; prompts: Set<string> }

export class SessionManager {
  private active: Active | null = null

  constructor(private readonly factory: SessionFactory, private readonly emit: (event: ManagedSessionEvent) => void) {}

  async open(sessionId?: string): Promise<{ connectionId: string; metadata: CliSessionMetadata }> {
    await this.close()
    const connectionId = randomUUID()
    const session = this.factory({
      onEvent: (event) => this.handleEvent(connectionId, event),
      onExit: () => {
        if (this.active?.connectionId === connectionId) this.active = null
      }
    })
    const metadata = await session.open(sessionId)
    if (!metadata.sessionId) throw new Error('Conversation session.ready did not contain a session ID')
    this.active = { connectionId, sessionId: metadata.sessionId, session, sequence: 0, turnId: null, prompts: new Set() }
    return { connectionId, metadata }
  }

  async send(connectionId: string, turnId: string, prompt: string): Promise<void> {
    const active = this.requireActive(connectionId)
    if (active.turnId) throw new Error('A turn is already active')
    active.turnId = turnId
    try {
      await active.session.sendTurn(turnId, prompt)
    } catch (error) {
      active.turnId = null
      throw error
    }
  }

  cancel(connectionId: string, turnId: string): Promise<void> {
    const active = this.requireTurn(connectionId, turnId)
    return active.session.cancelTurn(turnId)
  }

  respond(connectionId: string, turnId: string, promptId: string, response: PromptResponse): Promise<void> {
    const active = this.requireTurn(connectionId, turnId)
    if (!active.prompts.delete(promptId)) throw new Error('Prompt is stale or already resolved')
    return active.session.respondToPrompt(turnId, promptId, response)
  }

  async close(): Promise<void> {
    const active = this.active
    this.active = null
    if (active) await active.session.close()
  }

  private handleEvent(connectionId: string, payload: CliEvent): void {
    const active = this.active
    if (!active || active.connectionId !== connectionId) return
    if ('turnId' in payload && payload.turnId && active.turnId && payload.turnId !== active.turnId) return
    if (payload.type === 'prompt.request') active.prompts.add(payload.promptId)
    if (payload.type === 'prompt.resolved') active.prompts.delete(payload.promptId)
    if (payload.type === 'turn.completed' || payload.type === 'turn.cancelled' || (payload.type === 'error' && payload.scope === 'turn')) {
      active.turnId = null
      active.prompts.clear()
    }
    active.sequence += 1
    this.emit({ connectionId, sequence: active.sequence, payload })
  }

  private requireActive(connectionId: string): Active {
    if (!this.active || this.active.connectionId !== connectionId) throw new Error('Connection is stale')
    return this.active
  }

  private requireTurn(connectionId: string, turnId: string): Active {
    const active = this.requireActive(connectionId)
    if (active.turnId !== turnId) throw new Error('Turn is stale')
    return active
  }
}
