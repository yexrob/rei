// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attentionNotice, useAttentionNotifications, type AttentionSession } from './attention'

const t = (text: string) => text
const session = (status: string): AttentionSession => ({ hostId: 'h', sessionId: 's', title: 'Fix the build', status })

afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(window, 'bingoDesktop') })

describe('attention transitions', () => {
  it('notifies for permission/questions, completion and failure, but not first sight or idle churn', () => {
    expect(attentionNotice(undefined, session('waiting'), t)).toBeNull()
    expect(attentionNotice('working', session('waiting'), t)).toMatchObject({ kind: 'waiting', title: 'Bingo needs your input', body: 'Fix the build' })
    expect(attentionNotice('working', session('ready'), t)).toMatchObject({ kind: 'completed', title: 'Task finished' })
    expect(attentionNotice('retrying', session('failed'), t)).toMatchObject({ kind: 'failed', title: 'Task failed' })
    expect(attentionNotice('waiting', session('working'), t)).toBeNull()
    expect(attentionNotice('ready', session('failed'), t)).toBeNull()
    expect(attentionNotice('waiting', session('ready'), t)).toBeNull()
  })

  it('notifies only while unfocused and mirrors waiting sessions onto the badge', () => {
    const notify = vi.fn(async () => ({ ok: true as const, value: true })), setBadgeCount = vi.fn(async () => ({ ok: true as const, value: undefined }))
    Object.defineProperty(window, 'bingoDesktop', { configurable: true, value: { notify, setBadgeCount } })
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const { rerender } = renderHook(({ sessions, enabled }) => useAttentionNotifications(sessions, enabled, t), { initialProps: { sessions: [session('working')], enabled: true } })
    rerender({ sessions: [session('waiting')], enabled: true })
    expect(notify).not.toHaveBeenCalled()
    expect(setBadgeCount).toHaveBeenLastCalledWith(1)
    focus.mockReturnValue(false)
    rerender({ sessions: [session('working')], enabled: true })
    rerender({ sessions: [session('ready')], enabled: true })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'completed', hostId: 'h', sessionId: 's' }))
    rerender({ sessions: [session('waiting')], enabled: false })
    expect(notify).toHaveBeenCalledOnce()
    expect(setBadgeCount).toHaveBeenLastCalledWith(0)
  })
})
