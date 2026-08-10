import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { RuntimeLocator } from '../runtime/runtimeLocator'
import type { SessionManager } from '../runtime/sessionManager'
import type { TranscriptRepository } from '../storage/transcriptRepository'
import { IPC, type Result, type SessionListOutput } from '../../shared/contracts/ipc'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, input?: unknown) => unknown>()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.0', isPackaged: true },
  ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, input?: unknown) => unknown) => electron.handlers.set(channel, handler) }
}))

import { registerIpc } from './registerIpc'

describe('registerIpc session:list', () => {
  it('returns TranscriptRepository.list through the read-only IPC channel', async () => {
    const output: SessionListOutput = {
      sessions: [{ id: 'session-1', name: 'Session 1', preview: 'Latest reply', updatedAt: '2026-08-10T00:00:00.000Z', messageCount: 2 }],
      warnings: []
    }
    const transcripts = { list: vi.fn().mockResolvedValue(output) }
    const mainFrame = {}
    const webContents = { mainFrame }

    registerIpc(
      { webContents } as unknown as BrowserWindow,
      {} as RuntimeLocator,
      {} as SessionManager,
      transcripts as unknown as TranscriptRepository
    )

    const handler = electron.handlers.get(IPC.sessionList)
    expect(handler).toBeDefined()
    const result = await handler?.({ sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent) as Result<SessionListOutput>
    expect(result).toEqual({ ok: true, value: output })
    expect(transcripts.list).toHaveBeenCalledOnce()
  })
})
