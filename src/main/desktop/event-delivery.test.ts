import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const mock = vi.hoisted(() => ({ ack: undefined as undefined | ((event: unknown, id: unknown) => void) }))
vi.mock('electron', () => ({ ipcMain: { on: (_channel: string, listener: typeof mock.ack) => { mock.ack = listener } } }))
import { EventDelivery } from './event-delivery'
import type { DesktopEvent } from '../../shared/desktop'
const event: DesktopEvent = { type: 'menu', action: 'preferences' }
function setup() {
  const mainFrame = { url: 'file:///app/index.html' }, send = vi.fn(), failed = vi.fn()
  const webContents = { mainFrame, send, isDestroyed: () => false }
  const window = { isDestroyed: () => false, webContents }
  const delivery = new EventDelivery(() => window as unknown as BrowserWindow, mainFrame.url, failed)
  return { delivery, send, failed, sender: { sender: webContents, senderFrame: mainFrame } }
}
beforeEach(() => { mock.ack = undefined })
describe('bounded renderer event delivery', () => {
  it('fails explicitly instead of growing an unacknowledged Electron queue', () => {
    const { delivery, send, failed } = setup()
    for (let n = 0; n < 257; n += 1) delivery.send(event)
    expect(send).toHaveBeenCalledTimes(256)
    expect(failed).toHaveBeenCalledOnce()
    expect(failed.mock.calls[0][0]).toMatchObject({ code: 'RENDERER_BACKPRESSURE' })
  })
  it('accepts acknowledgements only from the trusted top frame', () => {
    const { delivery, send, failed, sender } = setup()
    for (let n = 0; n < 256; n += 1) { delivery.send(event); mock.ack?.({ ...sender, sender: {} }, n + 1) }
    mock.ack?.(sender, 1)
    mock.ack?.(sender, 1) // A duplicate acknowledgement must not reduce the budget twice.
    delivery.send(event)
    expect(send).toHaveBeenCalledTimes(257)
    delivery.send(event)
    expect(failed).toHaveBeenCalledOnce()
  })
  it('keeps streaming with acknowledged events and resets after renderer replacement', () => {
    const { delivery, send, failed, sender } = setup()
    for (let n = 0; n < 1000; n += 1) { delivery.send(event); mock.ack?.(sender, n + 1) }
    expect(send).toHaveBeenCalledTimes(1000)
    expect(failed).not.toHaveBeenCalled()
    delivery.reset()
    delivery.send(event)
    expect(failed).not.toHaveBeenCalled()
  })
})
