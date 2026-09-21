import { describe, expect, it, vi } from 'vitest'
import type { BingoPanelsApi, PanelsEvent, TerminalState } from '../../../../shared/panels'
import { TerminalController, type TerminalView } from './terminal-controller'

const shell = (id: string, changes: Partial<TerminalState> = {}): TerminalState => ({ id, status: 'running', cwd: '/workspace', exitCode: null, error: null, ...changes })
const browser = { url: '', title: '', canGoBack: false, canGoForward: false, loading: false, error: null }
const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function harness(initial: TerminalState[] = []) {
  let listener: (event: PanelsEvent) => void = () => {}
  const views = new Map<string, TerminalView & { output: string[]; callbacks: (() => void)[] }>()
  const api = {
    snapshot: vi.fn(async () => ({ ok: true as const, value: { browser, terminals: initial } })),
    onEvent: vi.fn((next: typeof listener) => { listener = next; return vi.fn() }),
    terminalStart: vi.fn(async () => ({ ok: true as const, value: shell('new') })),
    terminalStop: vi.fn(async () => ({ ok: true as const, value: undefined })),
    terminalWrite: vi.fn(async () => ({ ok: true as const, value: undefined })),
    terminalResize: vi.fn(async () => ({ ok: true as const, value: undefined })),
    terminalAck: vi.fn(async () => ({ ok: true as const, value: undefined }))
  }
  const onEmpty = vi.fn(), changed = vi.fn()
  const controller = new TerminalController(api as unknown as BingoPanelsApi, (id) => {
    const view = { output: [] as string[], callbacks: [] as (() => void)[], write(data: string, done: () => void) { this.output.push(data); this.callbacks.push(done) }, activate: vi.fn(), focus: vi.fn(), dispose: vi.fn() }
    views.set(id, view)
    return view
  }, changed, onEmpty)
  const emit = (event: PanelsEvent): void => listener(event)
  return { api, views, controller, emit, onEmpty, changed }
}

describe('terminal tab controller contract', () => {
  it('records data before tabs mount and ACKs only after the matching buffer consumes it', async () => {
    const h = harness()
    h.controller.connect()
    h.emit({ type: 'terminal-data', id: 'a', sequence: 1, data: 'early a' })
    h.emit({ type: 'terminals', states: [shell('a'), shell('b')] })
    h.emit({ type: 'terminal-data', id: 'b', sequence: 1, data: 'only b' })
    await tick()
    expect(h.api.onEvent).toHaveBeenCalledTimes(1)
    expect(h.api.terminalAck).not.toHaveBeenCalled()
    expect(h.views.get('a')?.output).toEqual(['early a'])
    expect(h.views.get('b')?.output).toEqual(['only b'])
    h.views.get('b')?.callbacks[0]()
    expect(h.api.terminalAck).toHaveBeenCalledWith({ id: 'b', sequence: 1 })
    expect(h.controller.snapshot().tabs.map((tab) => tab.id)).toEqual(['a', 'b'])
    h.controller.dispose()
  })

  it('hides without stopping and keeps each buffer alive across tab switches', async () => {
    const h = harness([shell('a'), shell('b')])
    h.controller.connect(); await tick()
    h.controller.setVisible(true); h.controller.select('b'); h.controller.setVisible(false)
    h.emit({ type: 'terminal-data', id: 'a', sequence: 4, data: 'hidden output' })
    h.views.get('a')?.callbacks[0]()
    h.controller.setVisible(true); h.controller.select('a')
    expect(h.api.terminalStop).not.toHaveBeenCalled()
    expect(h.api.terminalStart).not.toHaveBeenCalled()
    expect(h.views.get('a')?.dispose).not.toHaveBeenCalled()
    expect(h.api.terminalAck).toHaveBeenCalledWith({ id: 'a', sequence: 4 })
    expect(h.controller.snapshot().activeId).toBe('a')
    h.controller.dispose()
  })

  it('selects a neighbor after exit, hides once on the last exit, and launches only on explicit reopening', async () => {
    const h = harness([shell('a'), shell('b'), shell('c')])
    h.controller.connect(); await tick(); h.controller.setVisible(true); h.controller.select('b')
    h.emit({ type: 'terminals', states: [shell('a'), shell('c')] })
    expect(h.controller.snapshot().activeId).toBe('c')
    h.emit({ type: 'terminals', states: [] }); h.emit({ type: 'terminals', states: [] })
    expect(h.onEmpty).toHaveBeenCalledTimes(1)
    expect(h.api.terminalStart).not.toHaveBeenCalled()
    h.controller.setVisible(false); h.controller.setVisible(true); await tick()
    expect(h.api.terminalStart).toHaveBeenCalledTimes(1)
    h.controller.dispose()
  })

  it('does not resurrect a shell from a late launch response after its exit event', async () => {
    const h = harness()
    let resolve!: (value: { ok: true; value: TerminalState }) => void
    h.api.terminalStart.mockImplementation(() => new Promise((done) => { resolve = done }))
    h.controller.connect(); await tick(); h.controller.setVisible(true)
    h.emit({ type: 'terminals', states: [shell('new')] })
    h.emit({ type: 'terminals', states: [] })
    resolve({ ok: true, value: shell('new') }); await tick()
    expect(h.controller.snapshot().tabs).toEqual([])
    expect(h.api.terminalStart).toHaveBeenCalledTimes(1)
    expect(h.onEmpty).toHaveBeenCalledTimes(1)
    h.controller.dispose()
  })

  it('closes only the requested tab and preserves recoverable native failures', async () => {
    const h = harness([shell('a'), shell('b')])
    h.controller.connect(); await tick()
    await h.controller.close('a')
    expect(h.api.terminalStop).toHaveBeenCalledExactlyOnceWith('a')
    expect(h.controller.snapshot().tabs).toHaveLength(2)
    h.emit({ type: 'terminals', states: [shell('a', { error: 'Try Stop again.' }), shell('b')] })
    expect(h.controller.snapshot().tabs[0].error).toBe('Try Stop again.')
    expect(h.onEmpty).not.toHaveBeenCalled()
    h.controller.dispose()
  })

  it('keeps failed launch visible and retryable without an automatic retry loop', async () => {
    const h = harness()
    h.api.terminalStart.mockRejectedValue(new Error('Launch failed'))
    h.controller.connect(); await tick(); h.controller.setVisible(true); await tick()
    expect(h.controller.snapshot().error).toBe('Launch failed')
    expect(h.controller.snapshot().starting).toBe(false)
    expect(h.api.terminalStart).toHaveBeenCalledTimes(1)
    expect(h.onEmpty).not.toHaveBeenCalled()
    await h.controller.start()
    expect(h.api.terminalStart).toHaveBeenCalledTimes(2)
    h.controller.dispose()
  })

  it('preserves a pre-state buffer across a stale empty snapshot', async () => {
    const h = harness()
    h.controller.connect()
    h.emit({ type: 'terminal-data', id: 'early', sequence: 1, data: 'before snapshot' })
    const view = h.views.get('early')
    await tick()
    h.emit({ type: 'terminals', states: [shell('early')] })
    expect(h.views.get('early')).toBe(view)
    expect(view?.dispose).not.toHaveBeenCalled()
    view?.callbacks[0]()
    expect(h.api.terminalAck).toHaveBeenCalledWith({ id: 'early', sequence: 1 })
    h.controller.dispose()
  })

  it('does not automatically relaunch a shell that exits before initial hydration completes', async () => {
    const h = harness()
    h.controller.connect(); h.controller.setVisible(true)
    h.emit({ type: 'terminals', states: [shell('a')] })
    h.emit({ type: 'terminals', states: [] })
    await tick()
    expect(h.api.terminalStart).not.toHaveBeenCalled()
    expect(h.onEmpty).toHaveBeenCalledTimes(1)
    h.controller.dispose()
  })

  it('keeps native exited-error tabs recoverable until the user closes them', async () => {
    const h = harness([shell('a')])
    h.controller.connect(); await tick()
    h.emit({ type: 'terminals', states: [shell('a', { status: 'exited', error: 'Output safety limit', exitCode: 1 })] })
    expect(h.onEmpty).not.toHaveBeenCalled()
    expect(h.controller.snapshot().tabs[0].error).toBe('Output safety limit')
    await h.controller.close('a')
    expect(h.api.terminalStop).toHaveBeenCalledWith('a')
    h.emit({ type: 'terminals', states: [] })
    expect(h.onEmpty).toHaveBeenCalledTimes(1)
    h.controller.dispose()
  })

  it('bounds unconsumed renderer output and keeps its failure visible after stopping', async () => {
    const h = harness([shell('a')])
    h.controller.connect(); await tick()
    h.emit({ type: 'terminal-data', id: 'a', sequence: 1, data: 'x'.repeat(1024 * 1024 + 1) })
    h.emit({ type: 'terminals', states: [] }); await tick()
    expect(h.api.terminalAck).not.toHaveBeenCalled()
    expect(h.api.terminalStop).toHaveBeenCalledWith('a')
    expect(h.controller.snapshot().error).toContain('safety limit')
    expect(h.onEmpty).not.toHaveBeenCalled()
    h.controller.dispose()
  })

  it('selects the failed close target instead of hiding its recoverable error on another tab', async () => {
    const h = harness([shell('a'), shell('b')])
    h.controller.connect(); await tick()
    h.api.terminalStop.mockRejectedValue(new Error('Try Stop again.'))
    await h.controller.close('b')
    expect(h.controller.snapshot().activeId).toBe('b')
    expect(h.controller.snapshot().error).toBe('Try Stop again.')
    expect(h.onEmpty).not.toHaveBeenCalled()
    h.controller.dispose()
  })

  it('disposes buffers and closes a launch that finishes after unmount', async () => {
    const h = harness()
    let resolve!: (value: { ok: true; value: TerminalState }) => void
    h.api.terminalStart.mockImplementation(() => new Promise((done) => { resolve = done }))
    h.controller.connect(); await tick(); h.controller.setVisible(true); h.controller.dispose()
    resolve({ ok: true, value: shell('new') }); await tick()
    expect(h.api.terminalStop).toHaveBeenCalledWith('new')
  })
})
