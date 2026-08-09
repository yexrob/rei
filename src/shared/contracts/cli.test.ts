import { describe, expect, it } from 'vitest'
import { cliEventSchema, clientCommandSchema } from './cli'

const id = '123e4567-e89b-42d3-a456-426614174000'

describe('protocol v1 contracts', () => {
  it('accepts cancellation reasons and additive fields', () => {
    const event = cliEventSchema.parse({
      protocolVersion: 1,
      seq: 4,
      sessionId: 'session',
      type: 'turn.cancelled',
      turnId: id,
      reason: 'requested',
      futureField: true
    })
    expect(event.type).toBe('turn.cancelled')
  })

  it('requires turnId for prompt responses', () => {
    expect(() => clientCommandSchema.parse({
      protocolVersion: 1,
      type: 'prompt.respond',
      commandId: id,
      promptId: id,
      response: { kind: 'cancel' }
    })).toThrow()
  })

  it('rejects unknown event types', () => {
    expect(() => cliEventSchema.parse({ protocolVersion: 1, seq: 2, sessionId: null, type: 'future.event' })).toThrow()
  })
})
