import type { CliEvent } from '../../../shared/contracts/cli'
import type { SessionHistoryItem } from '../../../shared/contracts/ipc'

export type ChatMessage = { id: string; role: 'user' | 'assistant'; markdown: string; status?: 'streaming' | 'done' | 'interrupted' }
export type ToolActivity = { id: string; name: string; summary: string; status: 'running' | 'done' | 'error' | 'interrupted'; output?: string }
export type PromptRequest = Extract<CliEvent, { type: 'prompt.request' }>
export type InlineError = { code: string; msg: string }

export type ChatState = {
  turnId: string | null
  messages: ChatMessage[]
  tools: ToolActivity[]
  prompts: PromptRequest[]
  error: InlineError | null
}

export const initialChatState: ChatState = { turnId: null, messages: [], tools: [], prompts: [], error: null }

export type ChatAction =
  | { type: 'reset' }
  | { type: 'restore'; history: SessionHistoryItem[] }
  | { type: 'submit'; turnId: string; prompt: string }
  | { type: 'event'; event: CliEvent }
  | { type: 'transport-error'; code: string; msg: string }

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === 'reset') return initialChatState
  if (action.type === 'restore') {
    return {
      ...initialChatState,
      messages: action.history.map((item) => ({ ...item.value, status: 'done' }))
    }
  }
  if (action.type === 'submit') {
    if (state.turnId) return state
    return {
      ...state,
      turnId: action.turnId,
      error: null,
      messages: [...state.messages, { id: `user-${action.turnId}`, role: 'user', markdown: action.prompt }]
    }
  }
  if (action.type === 'transport-error') return interrupt(state, { code: action.code, msg: action.msg })

  const event = action.event
  if ('turnId' in event && event.turnId && state.turnId && event.turnId !== state.turnId) return state
  switch (event.type) {
    case 'turn.started':
      return { ...state, messages: [...state.messages, { id: `assistant-${event.turnId}`, role: 'assistant', markdown: '', status: 'streaming' }] }
    case 'text.delta':
      return { ...state, messages: state.messages.map((message) => message.id === `assistant-${event.turnId}` ? { ...message, markdown: message.markdown + event.delta } : message) }
    case 'tool.ready':
      return { ...state, tools: [...state.tools, { id: event.toolCallId, name: event.name, summary: event.summary, status: 'running' }] }
    case 'tool.done':
      return { ...state, tools: state.tools.map((tool) => tool.id === event.toolCallId ? { ...tool, name: event.name, summary: event.summary, status: event.status, output: event.output } : tool) }
    case 'prompt.request':
      return { ...state, prompts: [...state.prompts, event] }
    case 'prompt.resolved':
      return { ...state, prompts: state.prompts.filter((prompt) => prompt.promptId !== event.promptId) }
    case 'turn.completed':
      return settle(state, 'done')
    case 'turn.cancelled':
      return settle(state, 'interrupted')
    case 'error':
      return event.scope === 'turn' ? interrupt(state, { code: event.code, msg: event.msg }) : { ...state, error: { code: event.code, msg: event.msg } }
    default:
      return state
  }
}

function settle(state: ChatState, status: 'done' | 'interrupted'): ChatState {
  return {
    ...state,
    turnId: null,
    prompts: [],
    messages: state.messages.map((message) => message.status === 'streaming' ? { ...message, status } : message),
    tools: state.tools.map((tool) => tool.status === 'running' ? { ...tool, status: status === 'done' ? 'error' : 'interrupted' } : tool)
  }
}

function interrupt(state: ChatState, error: InlineError): ChatState {
  return { ...settle(state, 'interrupted'), error }
}
