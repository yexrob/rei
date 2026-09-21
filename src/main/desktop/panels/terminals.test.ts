import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelsEvent } from '../../../shared/panels'
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), workspace: vi.fn(async (path: string) => path) }))
vi.mock('node-pty', () => ({ spawn: mocks.spawn }))
vi.mock('../binary', () => ({ workspaceDirectory: mocks.workspace }))
import { PanelTerminals } from './terminals'

function native() {
  let data: (value: string) => void = () => {}, exit: (value: { exitCode: number }) => void = () => {}
  return { write: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn(), kill: vi.fn(() => exit({ exitCode: 0 })),
    onData: (callback: typeof data) => { data = callback; return { dispose: vi.fn() } },
    onExit: (callback: typeof exit) => { exit = callback; return { dispose: vi.fn() } },
    data: (value: string) => data(value), exit: (exitCode: number) => exit({ exitCode }) }
}
function harness() {
  const ptys: ReturnType<typeof native>[] = [], events: PanelsEvent[] = []
  mocks.spawn.mockImplementation(() => { const pty = native(); ptys.push(pty); return pty })
  let workspace = '/approved'
  const terminals = new PanelTerminals({ workspace: () => workspace, emit: (event) => events.push(event) })
  return { terminals, ptys, events, setWorkspace: (value: string) => { workspace = value } }
}
beforeEach(() => { vi.useFakeTimers(); mocks.spawn.mockReset(); mocks.workspace.mockReset().mockImplementation(async (path) => path) })
afterEach(() => { vi.useRealTimers() })
describe('independent native terminal registry', () => {
  it('routes input/resize/ACK per id and removes each normal exit, including exit 7', async () => {
    const h = harness(), a = await h.terminals.start(), b = await h.terminals.start()
    expect(a.id).not.toBe(b.id)
    expect(h.terminals.snapshot()).toEqual([a, b])
    h.terminals.write(a.id!, 'first'); h.terminals.resize(b.id!, 90, 30)
    expect(h.ptys[0].write).toHaveBeenCalledWith('first'); expect(h.ptys[1].write).not.toHaveBeenCalled()
    expect(h.ptys[1].resize).toHaveBeenCalledWith(90, 30)
    h.ptys[0].data('last line'); h.ptys[0].exit(7); h.ptys[1].data('other output')
    await vi.advanceTimersByTimeAsync(16)
    const packets = h.events.filter((event) => event.type === 'terminal-data')
    expect(packets.map((event) => [event.id, event.data])).toEqual([[a.id, 'last line'], [b.id, 'other output']])
    h.terminals.ack(b.id!, packets[0].sequence)
    await vi.advanceTimersByTimeAsync(16)
    expect(h.terminals.snapshot()).toHaveLength(2)
    h.terminals.ack(a.id!, packets[0].sequence)
    await vi.advanceTimersByTimeAsync(16)
    expect(h.terminals.snapshot()).toEqual([b]); expect(h.ptys[1].kill).not.toHaveBeenCalled()
    h.ptys[1].exit(0); await vi.advanceTimersByTimeAsync(16)
    expect(h.terminals.snapshot()).toEqual([])
    expect(h.events.at(-1)).toEqual({ type: 'terminals', states: [] })
    expect(h.terminals.busy).toBe(false)
    h.terminals.ack(a.id!, 1)
    expect(() => h.terminals.write(a.id!, 'stale')).toThrow()
  })
  it('reserves eight concurrent starts before asynchronous cwd validation completes', async () => {
    const h = harness(), resolve: ((value: string) => void)[] = []
    mocks.workspace.mockImplementation(() => new Promise((done) => resolve.push(done)))
    const pending = Array.from({ length: 8 }, () => h.terminals.start())
    expect(h.terminals.busy).toBe(true)
    await expect(h.terminals.start()).rejects.toMatchObject({ code: 'TERMINAL_LIMIT' })
    expect(mocks.spawn).not.toHaveBeenCalled()
    resolve.forEach((done) => done('/approved')); await Promise.all(pending)
    expect(h.terminals.snapshot()).toHaveLength(8)
    await h.terminals.stop(h.terminals.snapshot()[0].id!)
    await h.terminals.close(); expect(h.terminals.snapshot()).toEqual([])
  })
  it.each(['close', 'workspace'])('cancels every pending start on %s and releases reservations', async (reason) => {
    const h = harness(), resolve: ((value: string) => void)[] = []
    mocks.workspace.mockImplementation(() => new Promise((done) => resolve.push(done)))
    const pending = [h.terminals.start(), h.terminals.start()]
    const rejected = pending.map((task) => expect(task).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' }))
    if (reason === 'close') await h.terminals.close()
    else h.setWorkspace('/different')
    resolve.forEach((done) => done('/approved')); await Promise.all(rejected)
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(h.terminals.snapshot()).toEqual([])
    expect(h.terminals.busy).toBe(false)
  })
  it('attempts shutdown of every PTY even when one fails, preserving the failed handle for retry', async () => {
    const h = harness(), a = await h.terminals.start(); await h.terminals.start()
    h.ptys[0].kill.mockImplementation(() => {})
    const closed = expect(h.terminals.close()).rejects.toMatchObject({ code: 'TERMINAL_STOP_FAILED' })
    await vi.advanceTimersByTimeAsync(2000); await closed
    expect(h.ptys[1].kill).toHaveBeenCalledOnce()
    expect(h.terminals.snapshot()).toMatchObject([{ id: a.id, status: 'running', error: expect.any(String) }])
    expect(h.terminals.busy).toBe(true)
    h.ptys[0].kill.mockImplementation(() => h.ptys[0].exit(0))
    await h.terminals.close(); expect(h.terminals.snapshot()).toEqual([])
  })
  it.each([0, 7])('removes a normal exit %s after an earlier stop timeout', async (exitCode) => {
    const h = harness(), state = await h.terminals.start()
    h.ptys[0].kill.mockImplementation(() => {})
    const stopped = expect(h.terminals.stop(state.id!)).rejects.toMatchObject({ code: 'TERMINAL_STOP_FAILED' })
    await vi.advanceTimersByTimeAsync(2000); await stopped
    expect(h.terminals.snapshot()).toMatchObject([{ status: 'running', error: expect.any(String) }])
    h.ptys[0].exit(exitCode); await vi.advanceTimersByTimeAsync(16)
    expect(h.terminals.snapshot()).toEqual([])
  })
  it('retains the original output-limit failure when its stop times out before a later exit', async () => {
    const h = harness(); await h.terminals.start()
    h.ptys[0].kill.mockImplementation(() => {})
    h.ptys[0].data('x'.repeat(1024 * 1024 + 1))
    await vi.advanceTimersByTimeAsync(2000)
    h.ptys[0].exit(0); await vi.advanceTimersByTimeAsync(16)
    expect(h.terminals.snapshot()).toMatchObject([{ status: 'exited', error: 'Terminal output exceeded its safety limit. Start a new terminal.' }])
    await h.terminals.close()
  })
  it('keeps output-limit errors recoverable until explicit close and closes only that tab', async () => {
    const h = harness(), a = await h.terminals.start(), b = await h.terminals.start()
    h.ptys[0].data('x'.repeat(1024 * 1024 + 1))
    expect(h.terminals.snapshot()).toMatchObject([{ id: a.id, status: 'exited', error: expect.any(String) }, { id: b.id, status: 'running' }])
    await h.terminals.stop(a.id!); expect(h.terminals.snapshot()).toEqual([b])
    expect(h.ptys[1].kill).not.toHaveBeenCalled(); await h.terminals.close()
  })
  it('bounds retained failed tabs too and frees their slot only after explicit close', async () => {
    const h = harness(), states = await Promise.all(Array.from({ length: 8 }, () => h.terminals.start()))
    h.ptys[0].data('x'.repeat(1024 * 1024 + 1))
    expect(h.terminals.snapshot()[0].status).toBe('exited')
    await expect(h.terminals.start()).rejects.toMatchObject({ code: 'TERMINAL_LIMIT' })
    await h.terminals.stop(states[0].id!)
    await h.terminals.start(); expect(h.terminals.snapshot()).toHaveLength(8)
    await h.terminals.close()
  })
  it('sanitizes failed launch, releases its reservation and permits a new launch', async () => {
    const h = harness(); mocks.spawn.mockImplementationOnce(() => { throw new Error('secret') })
    await expect(h.terminals.start()).rejects.toMatchObject({ code: 'TERMINAL_START_FAILED' })
    expect(h.terminals.snapshot()).toEqual([]); expect(h.terminals.busy).toBe(false)
    await h.terminals.start(); expect(h.terminals.snapshot()).toHaveLength(1)
    await h.terminals.close()
  })
})
