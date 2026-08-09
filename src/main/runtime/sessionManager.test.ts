import { describe, expect, it, vi } from 'vitest'
import type { BingoSession } from './bingoSession'
import { SessionManager } from './sessionManager'

const metadata = { bingoVersion: '1', protocolVersion: 1 as const, sessionId: 's1', displayName: 'New conversation', transcriptPath: '/tmp/s1', resumed: false, cwd: '/tmp', provider: 'default', model: 'm', thinkingLevel: 'off' as const, permissionMode: 'default', theme: 'auto' as const, supportsImages: false }

describe('SessionManager', () => {
  it('closes the old session before opening another and rejects stale connections', async () => {
    const sessions: Array<BingoSession & { close: ReturnType<typeof vi.fn> }> = []
    const factory = (): BingoSession => {
      const session = { open: vi.fn().mockResolvedValue(metadata), sendTurn: vi.fn(), cancelTurn: vi.fn(), respondToPrompt: vi.fn(), close: vi.fn() }
      sessions.push(session)
      return session
    }
    const manager = new SessionManager(factory, vi.fn())
    const first = await manager.open()
    const second = await manager.open('s1')
    expect(sessions[0].close).toHaveBeenCalledOnce()
    await expect(manager.send(first.connectionId, crypto.randomUUID(), 'stale')).rejects.toThrow('stale')
    await expect(manager.send(second.connectionId, crypto.randomUUID(), 'ok')).resolves.toBeUndefined()
  })
})
