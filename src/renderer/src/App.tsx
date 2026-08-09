import { useReducer, useState } from 'react'
import Markdown from 'react-markdown'
import { chatReducer, initialChatState } from './state/chatReducer'

export default function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(chatReducer, initialChatState)
  const [draft, setDraft] = useState('')
  const prompt = state.prompts[0]

  const submit = (): void => {
    if (!draft.trim() || state.turnId) return
    const turnId = crypto.randomUUID()
    dispatch({ type: 'submit', turnId, prompt: draft })
    setDraft('')
  }

  return (
    <div className="app-shell" data-qa-state="chat">
      <nav className="sidebar" aria-label="Primary navigation">
        <strong>bingo</strong>
        <button type="button" className="nav-action">New conversation</button>
        <span>Conversations</span>
      </nav>
      <main className="chat">
        <header><p className="eyebrow">Local conversation</p><h1>New conversation</h1></header>
        <section className="timeline" aria-live="polite">
          {state.messages.length === 0 && <p className="chat-hint">Send a prompt to start working with bingo.</p>}
          {state.messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <span>{message.role === 'user' ? 'You' : 'bingo'}</span>
              <Markdown skipHtml>{message.markdown}</Markdown>
              {message.status === 'interrupted' && <small>Interrupted</small>}
            </article>
          ))}
          {state.tools.map((tool) => (
            <article className="tool-row" key={tool.id}>
              <strong>{tool.name}</strong><span>{tool.summary}</span><small>{tool.status}</small>
            </article>
          ))}
          {state.error && <div className="inline-error" role="alert"><strong>{state.error.code}</strong><span>{state.error.msg}</span></div>}
        </section>
        <footer className="composer">
          <textarea
            aria-label="Message"
            value={draft}
            disabled={Boolean(state.turnId)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
            placeholder="Ask bingo…"
          />
          {state.turnId ? <button type="button">Cancel</button> : <button type="button" onClick={submit}>Send</button>}
        </footer>
      </main>
      {prompt && (
        <div className="modal-backdrop" role="presentation">
          <section className="prompt-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
            <p className="eyebrow">{prompt.kind}</p><h2 id="prompt-title">{prompt.title}</h2><p>{prompt.question}</p>
            <div className="prompt-actions">{prompt.options.map((option) => <button type="button" key={option.id}>{option.label}</button>)}<button type="button">Cancel</button></div>
          </section>
        </div>
      )}
    </div>
  )
}
