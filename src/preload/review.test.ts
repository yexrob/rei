import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn().mockResolvedValue({ ok: true, value: {} }) }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { invoke: mocks.invoke } }))
import { installReviewBridge } from './review'

it('exposes one frozen read-only method without Electron or process handles', async () => {
  installReviewBridge()
  const [name, api] = mocks.expose.mock.calls[0]
  expect(name).toBe('bingoReview')
  expect(Object.keys(api)).toEqual(['snapshot'])
  expect(Object.isFrozen(api)).toBe(true)
  await api.snapshot({ scope: 'staged' })
  expect(mocks.invoke).toHaveBeenCalledWith('review:snapshot', { scope: 'staged' })
})
