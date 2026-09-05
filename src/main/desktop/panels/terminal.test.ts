import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), workspace: vi.fn(async (path: string) => path) }))
vi.mock('node-pty', () => ({ spawn: mocks.spawn }))
vi.mock('../binary', () => ({ workspaceDirectory: mocks.workspace }))
import { PanelTerminal } from './terminal'
import type { PanelsEvent } from '../../../shared/panels'

function harness() {
  let onData: (data: string) => void = () => {}, onExit: (event: { exitCode: number }) => void = () => {}
  const subscriptions = [vi.fn(), vi.fn()]
  const pty = { write: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn(), kill: vi.fn((_signal?: string) => onExit({ exitCode: 0 })), onData: vi.fn((callback) => { onData = callback; return { dispose: subscriptions[0] } }), onExit: vi.fn((callback) => { onExit = callback; return { dispose: subscriptions[1] } }) }
  mocks.spawn.mockReturnValue(pty)
  const events: PanelsEvent[] = []
  let workspace: string | null = '/approved/workspace'
  const terminal = new PanelTerminal({ workspace: () => workspace, emit: (event) => events.push(event) })
  return { terminal, pty, events, subscriptions, data: (value: string) => onData(value), exit: (code: number) => onExit({ exitCode: code }), setWorkspace: (value: string | null) => { workspace = value } }
}
beforeEach(() => { vi.useFakeTimers(); mocks.spawn.mockReset(); mocks.workspace.mockReset().mockImplementation(async (path) => path) })
afterEach(() => { vi.useRealTimers() })
describe('PTY lifecycle and flow control', () => {
  it('starts only explicitly, uses the approved workspace, and starts idempotently', async () => {
    const h = harness()
    expect(mocks.spawn).not.toHaveBeenCalled()
    const [first, second] = await Promise.all([h.terminal.start(), h.terminal.start()])
    expect(first).toEqual(second)
    expect(first).toMatchObject({ status: 'running', cwd: '/approved/workspace' })
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.spawn.mock.calls[0][1]).toEqual([])
    expect(mocks.spawn.mock.calls[0][2]).toMatchObject({ cwd: '/approved/workspace', cols: 80, rows: 24, env: { TERM: 'xterm-256color' } })
    await h.terminal.start()
    expect(mocks.spawn).toHaveBeenCalledOnce()
    h.terminal.close()
  })
  it('does not start without an approved workspace', async () => {
    const h = harness(); h.setWorkspace(null)
    await expect(h.terminal.start()).rejects.toMatchObject({ code: 'NO_WORKSPACE' })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it.each(['workspace', 'close'])('rechecks %s changes after asynchronous cwd validation', async (change) => {
    const h = harness()
    let resolve!: (path: string) => void
    mocks.workspace.mockImplementation(() => new Promise((done) => { resolve = done }))
    const start = h.terminal.start()
    if (change === 'workspace') h.setWorkspace('/different')
    else h.terminal.close()
    resolve('/approved/workspace')
    await expect(start).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('forwards input and dimensions only for the active terminal, and kills on close', async () => {
    const h = harness(), state = await h.terminal.start()
    h.terminal.write(state.id!, 'printf hello\r')
    h.terminal.resize(state.id!, 90, 30)
    expect(h.pty.write).toHaveBeenCalledWith('printf hello\r')
    expect(h.pty.resize).toHaveBeenCalledWith(90, 30)
    expect(() => h.terminal.write('stale', 'oops')).toThrow()
    h.terminal.close(); h.terminal.close()
    expect(h.pty.kill).toHaveBeenCalledOnce()
    expect(h.subscriptions.every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
    expect(h.terminal.snapshot().status).toBe('exited')
  })
  it('batches output, pauses at bounded unacknowledged data and resumes after consumer ACKs', async () => {
    const h = harness(), { id } = await h.terminal.start()
    h.data('a'.repeat(70000))
    expect(h.pty.pause).toHaveBeenCalledOnce()
    expect(h.events.filter((event) => event.type === 'terminal-data')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(16)
    const packets = h.events.filter((event) => event.type === 'terminal-data')
    expect(packets).toHaveLength(4)
    expect(packets.every((event) => event.data.length <= 16384)).toBe(true)
    expect(packets.reduce((length, event) => length + event.data.length, 0)).toBe(65536)
    await vi.advanceTimersByTimeAsync(100)
    expect(h.events.filter((event) => event.type === 'terminal-data')).toHaveLength(4)
    h.terminal.ack(id!, 1000)
    expect(h.pty.resume).not.toHaveBeenCalled()
    for (const packet of packets) h.terminal.ack(id!, packet.sequence)
    expect(h.pty.resume).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(16)
    expect(h.events.filter((event) => event.type === 'terminal-data').map((event) => event.data).join('')).toHaveLength(70000)
    h.terminal.close()
  })
  it('ignores duplicate/stale ACKs and preserves the final output before exit', async () => {
    const h = harness(), { id } = await h.terminal.start()
    h.data('last line\r\n'); h.exit(7)
    await vi.advanceTimersByTimeAsync(16)
    expect(h.terminal.snapshot().status).toBe('running')
    const packet = h.events.find((event) => event.type === 'terminal-data')!
    if (packet.type !== 'terminal-data') throw new Error('packet missing')
    h.terminal.ack('old-terminal', packet.sequence)
    expect(h.terminal.snapshot().status).toBe('running')
    h.terminal.ack(id!, packet.sequence); h.terminal.ack(id!, packet.sequence)
    await vi.advanceTimersByTimeAsync(16)
    expect(h.terminal.snapshot()).toMatchObject({ status: 'exited', exitCode: 7 })
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(h.pty.kill).not.toHaveBeenCalled()
  })
  it('terminates a producer that exceeds the hard buffer cap without leaking output to errors', async () => {
    const h = harness(); await h.terminal.start()
    h.data('x'.repeat(1024 * 1024 + 1))
    expect(h.pty.kill).toHaveBeenCalledOnce()
    expect(h.terminal.snapshot()).toMatchObject({ status: 'exited', error: 'Terminal output exceeded its safety limit. Start a new terminal.' })
    expect(h.events.some((event) => event.type === 'terminal-data')).toBe(false)
  })
  it('waits for exit and escalates an ignored graceful stop without discarding the PTY', async () => {
    const h = harness(), { id } = await h.terminal.start()
    h.pty.kill.mockImplementation((signal?: string) => { if (signal === 'SIGKILL') h.exit(137) })
    const stopping = h.terminal.stop(id!)
    expect(h.terminal.snapshot().status).toBe('stopping')
    expect(h.subscriptions[1]).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(199)
    expect(h.pty.kill).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await stopping
    expect(h.pty.kill).toHaveBeenLastCalledWith('SIGKILL')
    expect(h.terminal.snapshot()).toMatchObject({ status: 'exited', exitCode: 137 })
    expect(h.subscriptions[1]).toHaveBeenCalledOnce()
  })
  it('bounds failed shutdown, keeps the handle/listener and permits retry', async () => {
    const h = harness(); await h.terminal.start()
    h.pty.kill.mockImplementation(() => {})
    const first = h.terminal.close()
    const rejection = expect(first).rejects.toMatchObject({ code: 'TERMINAL_STOP_FAILED' })
    await vi.advanceTimersByTimeAsync(2000); await rejection
    expect(h.terminal.snapshot().status).toBe('running')
    expect(h.subscriptions[1]).not.toHaveBeenCalled()
    h.pty.kill.mockImplementation(() => h.exit(0))
    await h.terminal.close()
    expect(h.terminal.snapshot().status).toBe('exited')
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })
  it('returns a sanitized native spawn failure', async () => {
    const h = harness()
    mocks.spawn.mockImplementation(() => { throw new Error('test-only-secret') })
    await expect(h.terminal.start()).rejects.toMatchObject({ code: 'TERMINAL_START_FAILED', message: 'The local shell could not start. Check the workspace and terminal installation.' })
    expect(h.terminal.snapshot().status).toBe('idle')
  })
})
