import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../../shared/desktop'
import { attentionNoticeSchema, badgeCountSchema } from './security'

const electron = vi.hoisted(() => {
  const created: Array<{ options: unknown; handlers: Map<string, () => void>; show: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = []
  class Notification {
    static isSupported = vi.fn(() => true)
    handlers = new Map<string, () => void>()
    show = vi.fn(); close = vi.fn()
    constructor(public options: unknown) { created.push(this) }
    on(name: string, handler: () => void) { this.handlers.set(name, handler); return this }
  }
  return { created, Notification, setBadgeCount: vi.fn() }
})
vi.mock('electron', () => ({ Notification: electron.Notification, app: { setBadgeCount: electron.setBadgeCount } }))
const { AttentionNotifications } = await import('./notifications')

function fakeWindow(focused: boolean) {
  return { isDestroyed: () => false, isFocused: () => focused, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn(), webContents: { isDestroyed: () => false, send: vi.fn() } }
}
const notice = { kind: 'waiting' as const, title: 'Bingo needs your input', body: 'Fix the build', hostId: 'host', sessionId: 'session' }

beforeEach(() => { electron.created.length = 0; electron.setBadgeCount.mockReset() })

describe('attention notifications', () => {
  it('shows only while the window is unfocused and the preference is on', () => {
    let enabled = true
    const focused = fakeWindow(true), away = fakeWindow(false)
    let current = focused
    const notifications = new AttentionNotifications({ window: () => current as never, enabled: () => enabled })
    expect(notifications.show(notice)).toBe(false)
    current = away
    expect(notifications.show(notice)).toBe(true)
    enabled = false
    expect(notifications.show(notice)).toBe(false)
    expect(electron.created).toHaveLength(1)
    expect(electron.created[0].show).toHaveBeenCalledOnce()
  })

  it('focuses the window and routes a click to the session through its own channel', () => {
    const window = fakeWindow(false)
    new AttentionNotifications({ window: () => window as never, enabled: () => true }).show(notice)
    electron.created[0].handlers.get('click')!()
    expect(window.restore).toHaveBeenCalled(); expect(window.focus).toHaveBeenCalled()
    expect(window.webContents.send).toHaveBeenCalledWith(DESKTOP_IPC.notificationActivated, { hostId: 'host', sessionId: 'session' })
  })

  it('sets badge counts only on supported platforms and clears them when disabled', () => {
    let enabled = true
    const mac = new AttentionNotifications({ window: () => null, enabled: () => enabled, platform: 'darwin' })
    mac.setBadgeCount(2); mac.setBadgeCount(2)
    enabled = false; mac.setBadgeCount(3)
    expect(electron.setBadgeCount.mock.calls).toEqual([[2], [0]])
    new AttentionNotifications({ window: () => null, enabled: () => true, platform: 'win32' }).setBadgeCount(4)
    expect(electron.setBadgeCount).toHaveBeenCalledTimes(2)
  })

  it('validates renderer-supplied notices and badge counts', () => {
    expect(attentionNoticeSchema.safeParse(notice).success).toBe(true)
    expect(attentionNoticeSchema.safeParse({ ...notice, title: 'x'.repeat(121) }).success).toBe(false)
    expect(attentionNoticeSchema.safeParse({ ...notice, kind: 'custom' }).success).toBe(false)
    expect(attentionNoticeSchema.safeParse({ ...notice, extra: true }).success).toBe(false)
    expect(badgeCountSchema.safeParse(-1).success).toBe(false)
    expect(badgeCountSchema.safeParse(1.5).success).toBe(false)
  })
})
