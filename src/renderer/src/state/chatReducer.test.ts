import { describe, expect, it } from 'vitest'
import { chatReducer, initialChatState } from './chatReducer'

const turnId = '123e4567-e89b-42d3-a456-426614174000'
const base = { protocolVersion: 1 as const, sessionId: 's', turnId }

describe('chatReducer', () => {
  it('streams text and correlates duplicate tool names by ID', () => {
    let state = chatReducer(initialChatState, { type: 'submit', turnId, prompt: 'hello' })
    state = chatReducer(state, { type: 'event', event: { ...base, seq: 1, type: 'turn.started', commandId: turnId } })
    state = chatReducer(state, { type: 'event', event: { ...base, seq: 2, type: 'text.delta', delta: 'Hi' } })
    state = chatReducer(state, { type: 'event', event: { ...base, seq: 3, type: 'text.delta', delta: ' there' } })
    state = chatReducer(state, { type: 'event', event: { ...base, seq: 4, type: 'tool.ready', toolCallId: 'a', name: 'Bash', summary: 'one' } })
    state = chatReducer(state, { type: 'event', event: { ...base, seq: 5, type: 'tool.ready', toolCallId: 'b', name: 'Bash', summary: 'two' } })
    state = chatReducer(state, { type: 'event', event: { ...base, seq: 6, type: 'tool.done', toolCallId: 'b', name: 'Bash', summary: 'two', status: 'done', output: 'ok', durationMs: 1 } })
    expect(state.messages.at(-1)?.markdown).toBe('Hi there')
    expect(state.tools.map((tool) => tool.status)).toEqual(['running', 'done'])
  })

  it('queues prompts FIFO and clears them on cancellation', () => {
    let state = chatReducer(initialChatState, { type: 'submit', turnId, prompt: 'hello' })
    for (const [index, promptId] of ['123e4567-e89b-42d3-a456-426614174001', '123e4567-e89b-42d3-a456-426614174002'].entries()) {
      state = chatReducer(state, { type: 'event', event: { ...base, seq: index + 1, type: 'prompt.request', promptId, kind: 'question', title: 'Question', question: promptId, options: [], allowFreeText: true } })
    }
    expect(state.prompts[0].promptId.endsWith('001')).toBe(true)
    state = chatReducer(state, { type: 'event', event: { ...base, seq: 3, type: 'turn.cancelled', reason: 'requested' } })
    expect(state.prompts).toEqual([])
    expect(state.turnId).toBeNull()
  })
})
