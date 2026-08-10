import { describe, expect, it, vi } from 'vitest'
import type { BingoSession } from './bingoSession'
import { SessionManager } from './sessionManager'

const metadata = { bingoVersion: '1', protocolVersion: 1 as const, sessionId: 's1', displayName: 'New conversation', transcriptPath: '/tmp/s1', resumed: false, cwd: '/tmp', provider: 'default', model: 'm', thinkingLevel: 'off' as const, permissionMode: 'default', theme: 'auto' as const, supportsImages: false }

describe('SessionManager', () => {
  it('closes the old session before opening another and rejects stale connections', async () => {
    const sessions: Array<BingoSession & { close: ReturnType<typeof vi.fn> }> = []
    const factory = (): BingoSession => {
      const session = { open: vi.fn().mockResolvedValue(metadata), sendTurn: vi.fn(), cancelTurn: vi.fn(), respondToPrompt: vi.fn(), rename: vi.fn(), delete: vi.fn(), close: vi.fn() }
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

  it('uses an isolated maintenance child for an inactive rename', async () => {
    const instances: Array<BingoSession & { open: ReturnType<typeof vi.fn>; rename: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = []
    const factory = (): BingoSession => {
      const session = {
        open: vi.fn().mockResolvedValue(metadata), sendTurn: vi.fn(), cancelTurn: vi.fn(), respondToPrompt: vi.fn(),
        rename: vi.fn().mockResolvedValue({ ...metadata, sessionId: 's2--renamed', displayName: 'renamed' }), delete: vi.fn(), close: vi.fn()
      }
      instances.push(session)
      return session
    }
    const manager = new SessionManager(factory, vi.fn())
    await manager.open('s1')
    await expect(manager.rename('s2', 'renamed')).resolves.toMatchObject({ sessionId: 's2--renamed' })
    expect(instances).toHaveLength(2)
    expect(instances[1].open).toHaveBeenCalledWith('s2')
    expect(instances[1].rename).toHaveBeenCalledWith('renamed')
    expect(instances[1].close).toHaveBeenCalledOnce()
    expect(instances[0].close).not.toHaveBeenCalled()
  })
})
