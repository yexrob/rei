import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const mock = vi.hoisted(() => ({ listeners: new Map<string, (event: unknown, id: unknown) => void>() }))
vi.mock('electron', () => ({ ipcMain: { on: (channel: string, listener: (event: unknown, id: unknown) => void) => { mock.listeners.set(channel, listener) } } }))
function ack(event: unknown, id: unknown): void { mock.listeners.get('desktop:event-ack')?.(event, id) }
function boundedAck(event: unknown, id: number, ok: boolean): void { mock.listeners.get('desktop:bounded-ack')?.(event, { id, ok }) }
import { EventDelivery } from './event-delivery'
import type { BoundedDelivery, DesktopEvent } from '../../shared/desktop'
const bounded = (transferId: string, title = 'small'): BoundedDelivery => ({ kind: 'response', transferId, hostId: 'h', connectionId: 'c', session: null, method: 'session/listHeads', result: { heads: [{ id: 's', cwd: '/project', driver: 'model', createdAt: '', updatedAt: '', busy: false, title }], next: null } })
const event: DesktopEvent = { type: 'rpc', connectionId: 'c', method: 'event', params: { session: 's', ts: '', seq: 1, event: { type: 'notice', level: 'info', code: 'test', text: 'frame' } } }
function setup() {
  const mainFrame = { url: 'file:///app/index.html' }, send = vi.fn(), failed = vi.fn()
  const webContents = { mainFrame, send, isDestroyed: () => false }
  const window = { isDestroyed: () => false, webContents }
  const delivery = new EventDelivery(() => window as unknown as BrowserWindow, mainFrame.url, failed)
  return { delivery, send, failed, window, sender: { sender: webContents, senderFrame: mainFrame } }
}
beforeEach(() => { mock.listeners.clear(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })
describe('bounded renderer event delivery', () => {
  it('drains a synchronous burst in exact order without mistaking it for a stuck renderer', () => {
    const { delivery, send, failed, sender } = setup()
    const events = Array.from({ length: 1000 }, (_, n): DesktopEvent => ({ type: 'rpc', connectionId: 'connection', method: 'event', params: { session: 'session', ts: '', seq: n + 1, event: { type: 'turnStarted', turn: `turn-${n}`, inputs: [], origin: 'submit' } } }))
    for (const frame of events) delivery.send(frame)
    expect(send).toHaveBeenCalledTimes(256)
    expect(failed).not.toHaveBeenCalled()
    for (let n = 0; n < events.length; n += 1) {
      expect(send.mock.calls[n][1].event).toEqual(events[n])
      ack(sender, send.mock.calls[n][1].id)
    }
    expect(send).toHaveBeenCalledTimes(events.length)
    vi.advanceTimersByTime(30_000)
    expect(failed).not.toHaveBeenCalled()
  })
  it('fails once when the bounded main-process backlog fills, not merely when the IPC window fills', () => {
    const { delivery, send, failed } = setup()
    for (let n = 0; n < 4095; n += 1) delivery.send(event)
    expect(failed).not.toHaveBeenCalled()
    for (let n = 0; n < 1000; n += 1) delivery.send(event)
    expect(send).toHaveBeenCalledTimes(256)
    expect(failed).toHaveBeenCalledOnce()
    expect(failed.mock.calls[0][0]).toMatchObject({ code: 'RENDERER_BACKPRESSURE' })
  })
  it('bounds bytes across queued and in-flight events', () => {
    const { delivery, send, failed } = setup()
    const large: DesktopEvent = { type: 'connection', connection: { hostId: 'test-host', busy: false, status: 'ready', connectionId: 'c', workspace: 'x'.repeat(9 * 1024 * 1024), binary: null } }
    for (let n = 0; n < 4; n += 1) delivery.send(large)
    expect(send).toHaveBeenCalledTimes(3)
    expect(failed).toHaveBeenCalledOnce()
  })
  it('counts queued bytes as well as the IPC window, and keeps the failure reserve inside 32 MiB', () => {
    const { delivery, send, failed, sender } = setup()
    failed.mockImplementation(() => delivery.send({ type: 'connection', connection: { hostId: 'test-host', busy: false, status: 'failed', connectionId: 'c', workspace: null, binary: null } }))
    for (let n = 0; n < 256; n += 1) delivery.send(event)
    const large: DesktopEvent = { type: 'connection', connection: { hostId: 'test-host', busy: false, status: 'ready', connectionId: 'c', workspace: 'x'.repeat(9 * 1024 * 1024), binary: null } }
    for (let n = 0; n < 3; n += 1) delivery.send(large)
    expect(failed).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(256)
    delivery.send(large)
    expect(failed).toHaveBeenCalledOnce()
    ack(sender, 1)
    expect(send).toHaveBeenCalledTimes(257)
    expect(send.mock.calls[256][1].event.type).toBe('connection')
    expect(send.mock.calls.reduce((sum, call) => sum + Buffer.byteLength(JSON.stringify(call[1].event)), 0)).toBeLessThanOrEqual(32 * 1024 * 1024)
  })
  it('rejects malformed, duplicate, unknown and untrusted ACKs without freeing slots', () => {
    const { delivery, send, failed, sender } = setup()
    for (let n = 0; n < 300; n += 1) delivery.send(event)
    for (const id of [undefined, null, '1', NaN, Infinity, -1, 0, 1.5, 9999]) ack(sender, id)
    ack({ ...sender, sender: {} }, 1)
    ack({ ...sender, senderFrame: { url: 'file:///app/index.html' } }, 1)
    sender.sender.mainFrame.url = 'https://untrusted.example/'
    ack(sender, 1)
    sender.sender.mainFrame.url = 'file:///app/index.html'
    expect(send).toHaveBeenCalledTimes(256)
    ack(sender, 1)
    ack(sender, 1)
    expect(send).toHaveBeenCalledTimes(257)
    expect(failed).not.toHaveBeenCalled()
  })
  it('times out the oldest event even if newer events keep being acknowledged', () => {
    const { delivery, failed, sender } = setup()
    delivery.send(event)
    vi.advanceTimersByTime(29_000)
    delivery.send(event)
    ack(sender, 2)
    expect(failed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(failed).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(60_000)
    expect(failed).toHaveBeenCalledOnce()
  })
  it('preserves the physical IPC budget and delivers one reentrant failure notice after ACK', () => {
    const { delivery, send, failed, sender } = setup()
    const notice: DesktopEvent = { type: 'connection', connection: { hostId: 'test-host', busy: false, status: 'failed', connectionId: 'c', workspace: null, binary: null } }
    failed.mockImplementation(() => { delivery.send(notice); delivery.send(event) })
    for (let n = 0; n < 300; n += 1) delivery.send(event)
    vi.advanceTimersByTime(30_000)
    expect(failed).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledTimes(256)
    delivery.send(event)
    ack(sender, 1)
    expect(send).toHaveBeenCalledTimes(257)
    expect(send.mock.calls[256][1].event).toEqual(notice)
    ack(sender, 2)
    expect(send).toHaveBeenCalledTimes(257)
  })
  it('resets the queue, deadline and IDs safely for a replacement renderer', () => {
    const { delivery, send, failed, sender } = setup()
    for (let n = 0; n < 300; n += 1) delivery.send(event)
    const oldId = send.mock.calls[0][1].id
    delivery.reset()
    vi.advanceTimersByTime(30_000)
    expect(failed).not.toHaveBeenCalled()
    for (let n = 0; n < 257; n += 1) delivery.send(event)
    expect(send).toHaveBeenCalledTimes(512)
    ack(sender, oldId)
    expect(send).toHaveBeenCalledTimes(512)
    ack(sender, send.mock.calls[256][1].id)
    expect(send).toHaveBeenCalledTimes(513)
  })
  it('requires all old IPC and the failure notice to drain before explicit recovery', () => {
    const { delivery, send, failed, sender } = setup()
    failed.mockImplementation(() => delivery.send({ type: 'connection', connection: { hostId: 'test-host', busy: false, status: 'failed', connectionId: 'c', workspace: null, binary: null } }))
    delivery.send(event)
    vi.advanceTimersByTime(30_000)
    expect(() => delivery.recover()).toThrow('still recovering')
    ack(sender, 1)
    expect(() => delivery.recover()).toThrow('still recovering')
    ack(sender, 2)
    expect(() => delivery.recover()).not.toThrow()
    for (let n = 0; n < 257; n += 1) delivery.send(event)
    expect(send).toHaveBeenCalledTimes(258)
    ack(sender, 1)
    ack(sender, 2)
    expect(send).toHaveBeenCalledTimes(258)
    ack(sender, 3)
    expect(send).toHaveBeenCalledTimes(259)
    expect(failed).toHaveBeenCalledOnce()
  })
  it('keeps native menu actions usable in failed state without reopening old runtime traffic', () => {
    const { delivery, send, sender } = setup()
    delivery.send(event)
    vi.advanceTimersByTime(30_000)
    ack(sender, 1)
    const menu: DesktopEvent = { type: 'menu', action: 'preferences' }
    delivery.send(menu)
    delivery.send(event)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][1].event).toEqual(menu)
  })
  it('shares the 32 MiB window with opt-in bounded replies and waits for trusted consumer ACK', async () => {
    const { delivery, send, sender, failed } = setup()
    const pending = Array.from({ length: 11 }, (_, n) => delivery.sendBounded(bounded(`transfer-${n}`, 'x'.repeat(3 * 1024 * 1024))))
    const outcomes = Promise.allSettled(pending)
    expect(send).toHaveBeenCalledTimes(10)
    expect(failed).not.toHaveBeenCalled()
    ack(sender, send.mock.calls[0][1].id) // Ordinary event ACK cannot release a bounded packet.
    boundedAck({ ...sender, sender: {} }, send.mock.calls[0][1].id, true)
    expect(send).toHaveBeenCalledTimes(10)
    boundedAck(sender, send.mock.calls[0][1].id, true)
    expect(send).toHaveBeenCalledTimes(11)
    for (let n = 1; n < 11; n += 1) boundedAck(sender, send.mock.calls[n][1].id, true)
    expect((await outcomes).every(result => result.status === 'fulfilled')).toBe(true)
    expect(failed).not.toHaveBeenCalled()
  })
  it('rejects a single oversized bounded result before Electron IPC without aborting healthy hosts', async () => {
    const { delivery, send, failed } = setup()
    await expect(delivery.sendBounded(bounded('oversize', 'x'.repeat(9 * 1024 * 1024)))).rejects.toMatchObject({ code: 'BOUNDED_TOO_LARGE' })
    expect(send).not.toHaveBeenCalled()
    expect(failed).not.toHaveBeenCalled()
  })
  it('NACKs one bounded result without clearing another host or releasing an unacknowledged packet early', async () => {
    const { delivery, send, sender, failed } = setup()
    const a = delivery.sendBounded(bounded('a')), b = delivery.sendBounded(bounded('b'))
    boundedAck(sender, send.mock.calls[0][1].id, false)
    await expect(a).rejects.toMatchObject({ code: 'BOUNDED_CONSUMER_REJECTED' })
    expect(failed).not.toHaveBeenCalled()
    let settled = false
    void b.then(() => { settled = true })
    await Promise.resolve(); expect(settled).toBe(false)
    boundedAck(sender, send.mock.calls[1][1].id, true)
    await b
    expect(settled).toBe(true)
  })
  it('cancels a logical transfer but retains physical IPC bytes until trusted ACK or reset', async () => {
    const { delivery, send, sender } = setup()
    const cancelled = delivery.sendBounded(bounded('cancelled'))
    delivery.cancelTransfer('cancelled')
    await expect(cancelled).rejects.toMatchObject({ code: 'TRANSFER_CANCELLED' })
    expect(send).toHaveBeenCalledOnce()
    // The old packet is still physically in Electron. An ordinary ACK is inert.
    ack(sender, send.mock.calls[0][1].id)
    const fresh = delivery.sendBounded(bounded('fresh'))
    expect(send.mock.calls[1][1].id).toBeGreaterThan(send.mock.calls[0][1].id)
    boundedAck(sender, send.mock.calls[0][1].id, true)
    boundedAck(sender, send.mock.calls[1][1].id, true)
    await fresh
  })
  it('rejects outstanding bounded results on renderer replacement without reusing IDs', async () => {
    const { delivery, send, sender } = setup()
    const old = delivery.sendBounded(bounded('old'))
    const id = send.mock.calls[0][1].id
    delivery.reset()
    await expect(old).rejects.toMatchObject({ code: 'RENDERER_CHANGED' })
    const fresh = delivery.sendBounded(bounded('fresh'))
    boundedAck(sender, id, true)
    expect(send.mock.calls[1][1].id).not.toBe(id)
    boundedAck(sender, send.mock.calls[1][1].id, true)
    await fresh
  })
  it('does not throw or repeatedly overflow if webContents.send fails', () => {
    const { delivery, send, failed } = setup()
    send.mockImplementation(() => { throw new Error('destroyed') })
    expect(() => delivery.send(event)).not.toThrow()
    delivery.send(event)
    expect(failed).toHaveBeenCalledOnce()
  })
})
