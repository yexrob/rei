// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BingoGuiApi, RendererSessionEvent, SessionListOutput, SessionOpened } from '../../shared/contracts/ipc'
import App from './App'

const firstSession = {
  id: 'project-1',
  name: 'First session',
  preview: 'Remember the amber nonce',
  updatedAt: '2026-08-10T05:00:00.000Z',
  messageCount: 2
}

const secondSession = {
  id: 'project-2',
  name: 'Second session',
  preview: 'Latest answer',
  updatedAt: '2026-08-10T06:00:00.000Z',
  messageCount: 1
}

function opened(sessionId: string, history: SessionOpened['history'] = []): SessionOpened {
  return {
    connectionId: crypto.randomUUID(),
    metadata: {
      bingoVersion: '0.4.0', protocolVersion: 1, sessionId, displayName: sessionId === firstSession.id ? firstSession.name : 'New conversation', resumed: history.length > 0,
      cwd: '/workspace', provider: 'default', model: 'model', thinkingLevel: 'off', permissionMode: 'default', theme: 'auto', supportsImages: false
    },
    history
  }
}

function api(list: SessionListOutput): BingoGuiApi {
  let listener: ((event: RendererSessionEvent) => void) | undefined
  const runtimeSettings = {
    providers: [
      { name: 'default', protocol: 'anthropic' as const, apiBaseUrl: 'https://example.test', supportsImages: true, credentialConfigured: true, builtin: false },
      { name: 'opencode-go', protocol: 'openai' as const, apiBaseUrl: 'https://opencode.ai/zen/go', supportsImages: false, credentialConfigured: false, builtin: true }
    ],
    provider: 'opencode-go', model: 'gpt-5.6-luna', thinkingLevel: 'off' as const
  }
  const snapshot = {
    path: '/home/.config/bingo/settings.json', revision: 'a'.repeat(64),
    values: { apiBaseUrl: 'https://example.test', provider: 'opencode-go', model: 'gpt-5.6-luna', thinkingLevel: 'off' as const, permissionMode: 'default', theme: 'auto' as const, sendImages: true },
    layers: {
      user: { path: '/home/.config/bingo/settings.json', exists: true, keys: ['provider'], values: { provider: 'opencode-go' } },
      project: { path: '/workspace/.bingo/settings.json', exists: false, keys: [], values: {} },
      local: { path: '/workspace/.bingo/local.json', exists: false, keys: [], values: {} }
    },
    sources: { provider: '/home/.config/bingo/settings.json' }, shadowed: [], providers: runtimeSettings.providers
  }
  return {
    getAppInfo: vi.fn(),
    probeRuntime: vi.fn().mockResolvedValue({ ok: true, value: { binaryPath: '/bingo', bingoVersion: '0.4.0', protocolVersion: 1, workspacePath: '/workspace' } }),
    listSessions: vi.fn().mockResolvedValue({ ok: true, value: list }),
    openSession: vi.fn().mockImplementation(async ({ sessionId }: { sessionId: string | null }) => ({ ok: true, value: opened(sessionId ?? 'new-session', sessionId === firstSession.id ? [
      { type: 'message', value: { id: 'history-user', role: 'user', markdown: 'Remember amber' } },
      { type: 'message', value: { id: 'history-assistant', role: 'assistant', markdown: 'I will remember amber' } }
    ] : []) })),
    renameSession: vi.fn().mockImplementation(async ({ sessionId, name }: { sessionId: string; name: string }) => ({ ok: true, value: { previousId: sessionId, session: { ...firstSession, id: `${sessionId}--${name}`, name } } })),
    deleteSession: vi.fn().mockImplementation(async ({ sessionId }: { sessionId: string }) => ({ ok: true, value: { deletedId: sessionId } })),
    readRuntimeSettings: vi.fn().mockResolvedValue({ ok: true, value: runtimeSettings }),
    listModels: vi.fn().mockImplementation(async ({ provider }: { provider: string }) => ({ ok: true, value: { provider, models: provider === 'default' ? ['model-default'] : ['gpt-5.6-luna'] } })),
    saveRuntimeSettings: vi.fn().mockImplementation(async (input) => ({ ok: true, value: { connectionId: crypto.randomUUID(), settings: { ...runtimeSettings, ...input } } })),
    readSettings: vi.fn().mockResolvedValue({ ok: true, value: snapshot }),
    saveSettings: vi.fn().mockResolvedValue({ ok: true, value: { connectionId: crypto.randomUUID(), snapshot } }),
    closeSession: vi.fn().mockResolvedValue({ ok: true, value: { closed: true } }),
    sendTurn: vi.fn().mockResolvedValue({ ok: true, value: { accepted: true } }),
    cancelTurn: vi.fn(),
    respondToPrompt: vi.fn(),
    captureVisual: vi.fn(),
    onSessionEvent: vi.fn().mockImplementation((next) => { listener = next; return () => { listener = undefined } })
  } as BingoGuiApi
}

describe('session sidebar', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(cleanup)

  it('shows newest-first summaries and opens the exact session with restored history', async () => {
    const bridge = api({ sessions: [secondSession, firstSession], warnings: [] })
    window.bingoGui = bridge
    render(<App />)

    expect((await screen.findAllByRole('button', { name: /Second session/ })).find((button) => button.classList.contains('session-item'))).toBeTruthy()
    const conversationButtons = screen.getAllByRole('button').filter((button) => button.classList.contains('session-item'))
    expect(conversationButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining('Second session'),
      expect.stringContaining('First session')
    ])
    expect(screen.getByText('Latest answer')).toBeTruthy()

    const firstButton = screen.getAllByRole('button', { name: /First session/ }).find((button) => button.classList.contains('session-item'))
    expect(firstButton).toBeTruthy()
    if (firstButton) fireEvent.click(firstButton)

    await waitFor(() => expect(bridge.openSession).toHaveBeenCalledWith({ sessionId: firstSession.id }))
    expect(await screen.findByText('Remember amber')).toBeTruthy()
    expect(screen.getByText('I will remember amber')).toBeTruthy()
    expect(screen.getByRole('heading', { name: firstSession.name })).toBeTruthy()
  })

  it('renames through IPC and requires confirmation before delete', async () => {
    const bridge = api({ sessions: [firstSession], warnings: [] })
    window.bingoGui = bridge
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /First session/ }).some((button) => button.classList.contains('session-item'))).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Actions for First session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(bridge.renameSession).toHaveBeenCalledWith({ sessionId: firstSession.id, name: 'Renamed' }))
    expect((await screen.findAllByRole('button', { name: /Renamed/ })).some((button) => button.classList.contains('session-item'))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Renamed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('alertdialog', { name: /Delete “Renamed”/ })).toBeTruthy()
    expect(bridge.deleteSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
    await waitFor(() => expect(bridge.deleteSession).toHaveBeenCalledWith({ sessionId: `${firstSession.id}--Renamed` }))
    expect(screen.queryAllByRole('button', { name: /Renamed/ }).some((button) => button.classList.contains('session-item'))).toBe(false)
  })

  it('shows credential state, reloads models by provider, and saves validated runtime choices', async () => {
    const bridge = api({ sessions: [], warnings: [] })
    window.bingoGui = bridge
    render(<App />)

    const provider = await screen.findByLabelText('Provider')
    expect((provider as HTMLSelectElement).value).toBe('opencode-go')
    expect(screen.getByRole('option', { name: 'opencode-go · built-in · not configured' })).toBeTruthy()
    fireEvent.change(provider, { target: { value: 'default' } })
    await waitFor(() => expect(bridge.listModels).toHaveBeenCalledWith({ workspacePath: '/workspace', provider: 'default' }))
    expect(await screen.findByRole('option', { name: 'model-default' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Thinking level'), { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(bridge.saveRuntimeSettings).toHaveBeenCalledWith({ workspacePath: '/workspace', provider: 'default', model: 'model-default', thinkingLevel: 'high' }))
  })

  it('loads the settings snapshot and shows a Saved toast after persistence', async () => {
    const bridge = api({ sessions: [], warnings: [] })
    window.bingoGui = bridge
    render(<App />)
    await screen.findByLabelText('Provider')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getAllByText('/home/.config/bingo/settings.json')).toHaveLength(2)
    expect(screen.getByText(/credential not configured/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(bridge.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: '/workspace', baseRevision: 'a'.repeat(64), values: expect.objectContaining({ theme: 'dark' }) })))
    expect((await screen.findByRole('status')).textContent).toBe('Saved')
  })
})
