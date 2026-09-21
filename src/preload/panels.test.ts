import { beforeEach, expect, it, vi } from 'vitest'
import type { BingoPanelsApi, PanelsEvent, PanelsSnapshot } from '../shared/panels'
const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { invoke: mocks.invoke, on: mocks.on } }))

beforeEach(() => { vi.resetModules(); mocks.expose.mockClear(); mocks.invoke.mockReset(); mocks.on.mockClear() })
async function bridge(): Promise<BingoPanelsApi> {
  const { installPanelsBridge } = await import('./panels')
  installPanelsBridge(); installPanelsBridge()
  expect(mocks.expose).toHaveBeenCalledOnce()
  return mocks.expose.mock.calls[0][1] as BingoPanelsApi
}
it('exposes the frozen panels allowlist and a list-only snapshot contract', async () => {
  const api = await bridge()
  expect(mocks.expose.mock.calls[0][0]).toBe('bingoPanels')
  expect(Object.isFrozen(api)).toBe(true)
  expect(Object.keys(api)).toEqual(['snapshot', 'browserNavigate', 'browserAction', 'browserLayout', 'terminalStart', 'terminalWrite', 'terminalResize', 'terminalStop', 'terminalAck', 'onEvent'])
  const snapshot: PanelsSnapshot = { browser: { url: '', title: '', canGoBack: false, canGoForward: false, loading: false, error: null }, terminals: [] }
  mocks.invoke.mockResolvedValue({ ok: true, value: snapshot })
  expect(await api.snapshot()).toEqual({ ok: true, value: snapshot })
  await api.terminalStart()
  expect(mocks.invoke).toHaveBeenLastCalledWith('panels:terminal-start')
  await api.terminalWrite({ id: 'one', data: 'exit\r' })
  expect(mocks.invoke).toHaveBeenLastCalledWith('panels:terminal-write', { id: 'one', data: 'exit\r' })
  await api.terminalResize({ id: 'two', cols: 100, rows: 30 })
  expect(mocks.invoke).toHaveBeenLastCalledWith('panels:terminal-resize', { id: 'two', cols: 100, rows: 30 })
  await api.terminalAck({ id: 'two', sequence: 1 }); await api.terminalStop('one')
  expect(mocks.invoke).toHaveBeenCalledWith('panels:terminal-ack', { id: 'two', sequence: 1 })
  expect(mocks.invoke).toHaveBeenLastCalledWith('panels:terminal-stop', 'one')
})
it('routes aggregate state and per-id data through one isolated subscription', async () => {
  const api = await bridge(), listener = vi.fn()
  const unsubscribe = api.onEvent(listener)
  api.onEvent(() => { throw new Error('subscriber failed') })
  const after = vi.fn(); api.onEvent(after)
  const events: PanelsEvent[] = [{ type: 'terminals', states: [] }, { type: 'terminal-data', id: 'two', sequence: 1, data: 'hello' }]
  expect(mocks.on).toHaveBeenCalledOnce()
  for (const event of events) mocks.on.mock.calls[0][1]({ privileged: true }, event)
  expect(listener.mock.calls).toEqual(events.map((event) => [event]))
  expect(after).toHaveBeenCalledTimes(2)
  unsubscribe(); mocks.on.mock.calls[0][1]({}, events[0])
  expect(listener).toHaveBeenCalledTimes(2)
})
it('bounds subscriptions and frees a slot on unsubscribe', async () => {
  const api = await bridge(), subscriptions = Array.from({ length: 16 }, () => api.onEvent(() => {}))
  expect(() => api.onEvent(() => {})).toThrow('Too many panel event subscriptions.')
  subscriptions[0]()
  expect(() => api.onEvent(() => {})).not.toThrow()
})
