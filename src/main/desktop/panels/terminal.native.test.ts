import { mkdtemp, mkdir, realpath, rename, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IPty } from 'node-pty'
const mocks = vi.hoisted(() => ({ pty: null as IPty | null, spawns: 0 }))
// Use a fixed OS shell rather than invoking user startup scripts in this fixture.
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>()
  return { ...actual, userInfo: () => ({ ...actual.userInfo(), shell: '/bin/sh' }) }
})
vi.mock('node-pty', async (original) => {
  const actual = await original<typeof import('node-pty')>()
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => { mocks.spawns++; mocks.pty = actual.spawn(...args); return mocks.pty } }
})
import { PanelTerminal } from './terminal'

beforeEach(() => { mocks.pty = null; mocks.spawns = 0 })
describe.skipIf(process.platform === 'win32')('production PanelTerminal with real filesystem and native PTY', () => {
  it('rejects an approved canonical workspace replaced by a symlink before spawning', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'rei-terminal-cwd-')))
    const workspace = join(root, 'approved'), outside = join(root, 'outside')
    await mkdir(workspace); await mkdir(outside)
    const terminal = new PanelTerminal({ workspace: () => workspace, emit: () => {} })
    try {
      await rename(workspace, join(root, 'old-approved')); await symlink(outside, workspace)
      await expect(terminal.start()).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' })
      expect(mocks.spawns).toBe(0)
    } finally { await terminal.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('reaps a real shell ignoring SIGHUP through bounded SIGKILL escalation', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'rei-terminal-stop-')))
    let ready!: () => void, output = ''
    const marker = new Promise<void>((resolve) => { ready = resolve })
    const terminal = new PanelTerminal({ workspace: () => root, emit: (event) => {
      if (event.type !== 'terminal-data') return
      output += event.data
      terminal.ack(event.id, event.sequence)
      if (output.includes('\r\n__REI_HUP_READY__\r\n')) ready()
    } })
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const state = await terminal.start()
      const pid = mocks.pty!.pid
      terminal.write(state.id!, "trap '' HUP; printf '__REI_HUP_READY__\\n'; read ignored\n")
      await Promise.race([marker, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Native shell fixture did not become ready.')), 3000) })])
      const stop = terminal.close()
      expect(terminal.snapshot().status).toBe('stopping')
      expect(() => process.kill(pid, 0)).not.toThrow()
      await stop
      expect(terminal.snapshot().status).toBe('exited')
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      if (timeout) clearTimeout(timeout)
      await terminal.close().catch(() => { if (mocks.pty) { try { process.kill(mocks.pty.pid, 'SIGKILL') } catch { /* Already reaped. */ } } })
      await rm(root, { recursive: true, force: true })
    }
  }, 7000)
})
