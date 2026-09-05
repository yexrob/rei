import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw, Square, X } from 'lucide-react'
import type { BrowserAction, BrowserState } from '../../../shared/panels'
import { useI18n } from '../i18n'
import { IconButton } from './primitives'
import './panels.css'

const empty: BrowserState = { url: '', title: '', canGoBack: false, canGoForward: false, loading: false, error: null }
export function BrowserPanel({ visible, occluded = false, onClose }: { visible: boolean; occluded?: boolean; onClose(): void }): React.JSX.Element {
  const { t } = useI18n()
  const [state, setState] = useState(empty)
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const api = window.bingoPanels
    if (!api) return
    let alive = true, updated = false
    const off = api.onEvent((event) => {
      if (event.type === 'browser') { updated = true; setState(event.state) }
      if (event.type === 'browser-focus-address') { input.current?.focus(); input.current?.select() }
    })
    void api.snapshot().then((result) => { if (alive && result.ok && !updated) setState(result.value.browser) })
    return () => { alive = false; off() }
  }, [])
  useEffect(() => { setAddress(state.url) }, [state.url])
  useLayoutEffect(() => {
    const api = window.bingoPanels, element = host.current
    if (!api || !element) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      const rect = element.getBoundingClientRect()
      // Native child views sit above the DOM. Any open DOM overlay must hide it,
      // including overlays opened below the root's explicit occlusion boundary.
      const overlay = Array.from(document.querySelectorAll('dialog[open], [aria-modal="true"], [role="menu"], [role="listbox"]')).some((item) => item.getClientRects().length > 0)
      void api.browserLayout({ visible: visible && !occluded && !overlay && document.visibilityState !== 'hidden', bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
    }
    const queue = (): void => { if (!frame) frame = requestAnimationFrame(measure) }
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(queue)
    resize?.observe(element)
    const mutations = new MutationObserver(queue)
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'aria-modal', 'data-state', 'aria-hidden'] })
    window.addEventListener('resize', queue)
    window.addEventListener('scroll', queue, true)
    document.addEventListener('visibilitychange', queue)
    window.visualViewport?.addEventListener('resize', queue)
    measure()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      resize?.disconnect(); mutations.disconnect()
      window.removeEventListener('resize', queue)
      window.removeEventListener('scroll', queue, true)
      document.removeEventListener('visibilitychange', queue)
      window.visualViewport?.removeEventListener('resize', queue)
      void api.browserLayout({ visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 } })
    }
  }, [visible, occluded, state.error, error])
  const action = async (value: BrowserAction): Promise<void> => {
    const result = await window.bingoPanels?.browserAction(value)
    if (result && !result.ok) setError(result.error.message)
  }
  const navigate = async (): Promise<void> => {
    if (!window.bingoPanels) return
    setError(null)
    const result = await window.bingoPanels.browserNavigate(address.trim())
    if (!result.ok) setError(result.error.message)
  }
  return <section className="native-panel browser-panel" aria-label={t('Browser')} hidden={!visible}>
    <header className="panel-heading"><span><Globe size={14} />{t('Browser')}</span><span className="panel-page-title" title={state.title}>{state.title}</span><IconButton label={t('Close browser')} onClick={onClose}><X size={15} /></IconButton></header>
    <form className="browser-controls" onSubmit={(event) => { event.preventDefault(); void navigate() }}>
      <IconButton label={t('Back')} disabled={!state.canGoBack} onClick={() => { void action('back') }}><ArrowLeft size={15} /></IconButton>
      <IconButton label={t('Forward')} disabled={!state.canGoForward} onClick={() => { void action('forward') }}><ArrowRight size={15} /></IconButton>
      <IconButton label={t(state.loading ? 'Stop loading' : 'Reload page')} disabled={!state.url} onClick={() => { void action(state.loading ? 'stop' : 'reload') }}>{state.loading ? <Square size={13} /> : <RotateCw size={15} />}</IconButton>
      <input ref={input} value={address} onChange={(event) => setAddress(event.target.value)} aria-label={t('Website address')} placeholder="https://" spellCheck={false} autoComplete="off" maxLength={4096} onKeyDown={(event) => { if (event.key === 'Escape') { setAddress(state.url); event.currentTarget.blur() } }} />
      <button type="submit" className="panel-go" disabled={!address.trim()}>{t('Go')}</button>
      <IconButton label={t('Open in default browser')} disabled={!state.url} onClick={() => { void action('open-external') }}><ExternalLink size={14} /></IconButton>
    </form>
    {(error || state.error) && <div className="panel-error" role="alert">{t(error || state.error!)}</div>}
    <div className="browser-native-host" ref={host} role="group" aria-label={t('Page content')}>
      {!state.url && <div className="panel-empty"><Globe size={24} aria-hidden="true" /><p>{t(window.bingoPanels ? 'Enter an HTTP or HTTPS address' : 'Browser unavailable')}</p></div>}
    </div>
    <footer className="browser-status"><span role="status">{state.loading ? t('Loading page…') : state.url ? new URL(state.url).host : ''}</span><button type="button" className="text-button" disabled={!state.url || occluded} onClick={() => { void action('focus') }} title="F6">{t('Focus page')}</button></footer>
  </section>
}
