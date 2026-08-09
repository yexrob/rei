export default function App(): React.JSX.Element {
  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Primary navigation">
        <strong>bingo</strong>
        <span>Conversations</span>
      </nav>
      <main className="content">
        <section className="empty-state" aria-labelledby="empty-title">
          <p className="eyebrow">Desktop agent</p>
          <h1 id="empty-title">Start a conversation</h1>
          <p>Connect bingo to begin a new local agent session.</p>
          <button type="button" disabled>
            Connect bingo
          </button>
        </section>
      </main>
    </div>
  )
}
