import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { RuntimeLocator } from '../runtime/runtimeLocator'
import type { SessionManager } from '../runtime/sessionManager'
import type { TranscriptRepository } from '../storage/transcriptRepository'
import type { SettingsRepository } from '../storage/settingsRepository'
import { IPC, type Result, type RuntimeSettings, type SessionListOutput, type SessionOpened } from '../../shared/contracts/ipc'

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
      transcripts as unknown as TranscriptRepository,
      {} as SettingsRepository,
      '/bingo'
    )

    const handler = electron.handlers.get(IPC.sessionList)
    expect(handler).toBeDefined()
    const result = await handler?.({ sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent) as Result<SessionListOutput>
    expect(result).toEqual({ ok: true, value: output })
    expect(transcripts.list).toHaveBeenCalledOnce()
  })

  it('loads history before opening the exact requested session', async () => {
    const history = [{ type: 'message' as const, value: { id: 'session-1:1', role: 'user' as const, markdown: 'Remember amber' } }]
    const transcripts = { list: vi.fn(), load: vi.fn().mockResolvedValue({ history, warnings: [] }) }
    const sessions = {
      open: vi.fn().mockResolvedValue({
        connectionId: crypto.randomUUID(),
        metadata: { bingoVersion: '1', protocolVersion: 1, sessionId: 'session-1', displayName: 'Session 1', transcriptPath: '/private/session-1.jsonl', resumed: true, cwd: '/tmp', provider: 'default', model: 'm', thinkingLevel: 'off', permissionMode: 'default', theme: 'auto', supportsImages: false }
      })
    }
    const mainFrame = {}
    const webContents = { mainFrame }
    registerIpc({ webContents } as unknown as BrowserWindow, {} as RuntimeLocator, sessions as unknown as SessionManager, transcripts as unknown as TranscriptRepository, {} as SettingsRepository, '/bingo')

    const handler = electron.handlers.get(IPC.sessionOpen)
    const result = await handler?.({ sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent, { sessionId: 'session-1' }) as Result<SessionOpened>

    expect(transcripts.load).toHaveBeenCalledWith('session-1')
    expect(sessions.open).toHaveBeenCalledWith('session-1')
    expect(result).toMatchObject({ ok: true, value: { history } })
    if (result.ok) expect(result.value.metadata).not.toHaveProperty('transcriptPath')
  })

  it('returns the active session theme through runtime settings', async () => {
    const providers: RuntimeSettings['providers'] = [{ name: 'default', protocol: 'anthropic', apiBaseUrl: 'https://example.test', supportsImages: true, credentialConfigured: true, builtin: false }]
    const sessions = {
      snapshot: vi.fn().mockReturnValue({ connectionId: crypto.randomUUID(), sessionId: 'session-1', idle: true }),
      listProviders: vi.fn().mockResolvedValue(providers),
      currentMetadata: vi.fn().mockReturnValue({ provider: 'default', model: 'model', thinkingLevel: 'high', theme: 'dark' })
    }
    const mainFrame = {}
    const webContents = { mainFrame }
    registerIpc({ webContents } as unknown as BrowserWindow, {} as RuntimeLocator, sessions as unknown as SessionManager, {} as TranscriptRepository, {} as SettingsRepository, '/bingo')

    const handler = electron.handlers.get(IPC.settingsReadRuntime)
    const result = await handler?.({ sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent, { workspacePath: '/tmp' }) as Result<RuntimeSettings>

    expect(result).toEqual({ ok: true, value: { providers, provider: 'default', model: 'model', thinkingLevel: 'high', theme: 'dark' } })
  })

  it('rejects an unavailable model before settings persistence', async () => {
    const providers: RuntimeSettings['providers'] = [{ name: 'default', protocol: 'anthropic', apiBaseUrl: 'https://example.test', supportsImages: true, credentialConfigured: true, builtin: false }]
    const sessions = {
      snapshot: vi.fn().mockReturnValue({ connectionId: crypto.randomUUID(), sessionId: 'session-1', idle: true }),
      listProviders: vi.fn().mockResolvedValue(providers),
      listModels: vi.fn().mockResolvedValue(['valid-model'])
    }
    const settings = { saveRuntime: vi.fn() }
    const mainFrame = {}
    const webContents = { mainFrame }
    registerIpc({ webContents } as unknown as BrowserWindow, {} as RuntimeLocator, sessions as unknown as SessionManager, {} as TranscriptRepository, settings as unknown as SettingsRepository, '/bingo')

    const handler = electron.handlers.get(IPC.settingsSaveRuntime)
    const result = await handler?.({ sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent, { workspacePath: '/tmp', provider: 'default', model: 'invalid-model', thinkingLevel: 'off' }) as Result<unknown>

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFIG_INVALID', level: 'field' } })
    expect(settings.saveRuntime).not.toHaveBeenCalled()
  })
})
