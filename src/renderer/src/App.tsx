import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import type { PromptResponse, CliEvent } from '../../shared/contracts/cli'
import type { GuiError, RendererSessionEvent, RuntimeInfo } from '../../shared/contracts/ipc'
import { chatReducer, initialChatState } from './state/chatReducer'

type Connection = { id: string; sequence: number }

export default function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(chatReducer, initialChatState)
  const [draft, setDraft] = useState('')
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [flowError, setFlowError] = useState<GuiError | null>(null)
  const [connected, setConnected] = useState(false)
  const connection = useRef<Connection | null>(null)
  const activeTurnId = useRef<string | null>(null)
  const connectInFlight = useRef(false)
  const prompt = state.prompts[0]

  useEffect(() => {
    activeTurnId.current = state.turnId
  }, [state.turnId])

  const connect = useCallback(async () => {
    if (connectInFlight.current) return
    connectInFlight.current = true
    setFlowError(null)
    const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms))])
    try {
      const probe = await withTimeout(window.bingoGui.probeRuntime(), 12_000)
      if (!probe.ok) { setFlowError(probe.error); return }
      setRuntime(probe.value)
      const opened = await withTimeout(window.bingoGui.openSession({ sessionId: null }), 12_000)
      if (!opened.ok) { setFlowError(opened.error); return }
      connection.current = { id: opened.value.connectionId, sequence: 0 }
      setConnected(true)
    } catch {
      setFlowError({ code: 'CONNECTION_TIMEOUT', msg: 'Could not connect to bingo within 12 seconds. Retry.', level: 'flow', recoverable: true, action: 'retry' })
    } finally {
      connectInFlight.current = false
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.bingoGui.onSessionEvent((event: RendererSessionEvent) => {
      const current = connection.current
      if (!current || event.connectionId !== current.id || event.sequence !== current.sequence + 1) return
      if ('turnId' in event.payload && event.payload.turnId && activeTurnId.current && event.payload.turnId !== activeTurnId.current) return
      current.sequence = event.sequence
      if (event.payload.type === 'transport.error') dispatch({ type: 'transport-error', code: event.payload.error.code, msg: event.payload.error.msg })
      else dispatch({ type: 'event', event: event.payload as CliEvent })
    })
    void connect()
    return unsubscribe
  }, [connect])

  const newConversation = async (): Promise<void> => {
    const current = connection.current
    connection.current = null
    activeTurnId.current = null
    dispatch({ type: 'reset' })
    if (current) await window.bingoGui.closeSession({ connectionId: current.id })
    const opened = await window.bingoGui.openSession({ sessionId: null })
    if (!opened.ok) { setFlowError(opened.error); return }
    connection.current = { id: opened.value.connectionId, sequence: 0 }
  }

  const submit = async (): Promise<void> => {
    const active = connection.current
    if (!draft.trim() || state.turnId || !active) return
    const turnId = crypto.randomUUID()
    const promptText = draft
    activeTurnId.current = turnId
    dispatch({ type: 'submit', turnId, prompt: promptText })
    setDraft('')
    const result = await window.bingoGui.sendTurn({ connectionId: active.id, turnId, prompt: promptText })
    if (!result.ok) dispatch({ type: 'transport-error', code: result.error.code, msg: result.error.msg })
  }

  const cancel = async (): Promise<void> => {
    const active = connection.current
    if (!active || !state.turnId) return
    const result = await window.bingoGui.cancelTurn({ connectionId: active.id, turnId: state.turnId })
    if (!result.ok) dispatch({ type: 'transport-error', code: result.error.code, msg: result.error.msg })
  }

  const respond = async (response: PromptResponse): Promise<void> => {
    const active = connection.current
    if (!active || !prompt) return
    const result = await window.bingoGui.respondToPrompt({ connectionId: active.id, turnId: prompt.turnId, promptId: prompt.promptId, response })
    if (!result.ok) dispatch({ type: 'transport-error', code: result.error.code, msg: result.error.msg })
  }

  if (flowError) return <FlowError error={flowError} retry={connect} />

  return (
    <div className="app-shell" data-qa-state="chat">
      <nav className="sidebar" aria-label="Primary navigation"><strong>bingo</strong><button type="button" className="nav-action" onClick={() => void newConversation()}>New conversation</button><span>Conversations</span><span>{runtime ? `bingo ${runtime.bingoVersion} · protocol ${runtime.protocolVersion}` : 'Connecting…'}</span></nav>
      <main className="chat">
        <header><p className="eyebrow">Local conversation</p><h1>New conversation</h1></header>
        <section className="timeline" aria-live="polite">
          {state.messages.length === 0 && <p className="chat-hint">Send a prompt to start working with bingo.</p>}
          {state.messages.map((message) => <article className={`message ${message.role}`} key={message.id}><span>{message.role === 'user' ? 'You' : 'bingo'}</span><Markdown skipHtml>{message.markdown}</Markdown>{message.status === 'interrupted' && <small>Interrupted</small>}</article>)}
          {state.tools.map((tool) => <article className="tool-row" key={tool.id}><strong>{tool.name}</strong><span>{tool.summary}</span><small>{tool.status}</small></article>)}
          {state.error && <div className="inline-error" role="alert"><strong>{state.error.code}</strong><span>{state.error.msg}</span></div>}
        </section>
        <footer className="composer"><textarea aria-label="Message" value={draft} disabled={Boolean(state.turnId) || !connected} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} placeholder="Ask bingo…" />{state.turnId ? <button type="button" onClick={() => void cancel()}>Cancel</button> : <button type="button" onClick={() => void submit()}>Send</button>}</footer>
      </main>
      {prompt && <div className="modal-backdrop" role="presentation"><section className="prompt-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title"><p className="eyebrow">{prompt.kind}</p><h2 id="prompt-title">{prompt.title}</h2><p>{prompt.question}</p><div className="prompt-actions">{prompt.options.map((option) => <button type="button" key={option.id} onClick={() => void respond({ kind: 'option', optionId: option.id })}>{option.label}</button>)}<button type="button" onClick={() => void respond({ kind: 'cancel' })}>Cancel</button></div></section></div>}
    </div>
  )
}

function FlowError({ error, retry }: { error: GuiError; retry: () => Promise<void> }): React.JSX.Element {
  return <main className="content" data-qa-state="error"><section className="flow-error" role="alert"><p className="eyebrow">Connection required</p><h1>Unable to connect bingo</h1><p className="error-code">{error.code}</p><p>{error.msg}</p><button type="button" onClick={() => void retry()}>Retry</button></section></main>
}
