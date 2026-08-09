import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, GuiError, RuntimeInfo } from '../../shared/contracts/ipc'

type RuntimeState =
  | { status: 'loading' }
  | { status: 'ready'; runtime: RuntimeInfo }
  | { status: 'error'; error: GuiError }

export default function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [runtime, setRuntime] = useState<RuntimeState>({ status: 'loading' })

  const probe = useCallback(async () => {
    setRuntime({ status: 'loading' })
    const result = await window.bingoGui.probeRuntime()
    setRuntime(result.ok ? { status: 'ready', runtime: result.value } : { status: 'error', error: result.error })
  }, [])

  useEffect(() => {
    void window.bingoGui.getAppInfo().then((result) => {
      if (result.ok) setAppInfo(result.value)
    })
    void probe()
  }, [probe])

  return (
    <div className="app-shell" data-qa-state={runtime.status === 'error' ? 'error' : 'empty'}>
      <nav className="sidebar" aria-label="Primary navigation">
        <strong>bingo</strong>
        <span>Conversations</span>
        <div className="status-area" aria-label="Runtime status">
          <span>App {appInfo?.appVersion ?? '…'}</span>
          <span>bingo {runtime.status === 'ready' ? runtime.runtime.bingoVersion : 'unavailable'}</span>
        </div>
      </nav>
      <main className="content">
        {runtime.status === 'error' ? (
          <section className="flow-error" role="alert" aria-labelledby="error-title" tabIndex={-1}>
            <p className="eyebrow">Connection required</p>
            <h1 id="error-title">Unable to connect bingo</h1>
            <p className="error-code">{runtime.error.code}</p>
            <p>{runtime.error.msg}</p>
            <button type="button" onClick={() => void probe()}>
              Retry
            </button>
          </section>
        ) : (
          <section className="empty-state" aria-labelledby="empty-title">
            <p className="eyebrow">Desktop agent</p>
            <h1 id="empty-title">Start a conversation</h1>
            <p>{runtime.status === 'loading' ? 'Checking the local bingo runtime…' : 'bingo is connected and ready.'}</p>
            <button type="button" disabled>
              Connect bingo
            </button>
          </section>
        )}
      </main>
    </div>
  )
}
