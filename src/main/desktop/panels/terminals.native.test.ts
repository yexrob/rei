import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
// Do not run a developer's startup scripts; Windows still exercises its native cmd.exe path.
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>()
  return { ...actual, userInfo: () => ({ ...actual.userInfo(), shell: '/bin/sh' }) }
})
import { PanelTerminals } from './terminals'

it('runs two real native shells, isolates their output and removes each normal exit', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'rei-multi-pty-')))
  const output = new Map<string, string>()
  const terminals = new PanelTerminals({ workspace: () => workspace, emit: (event) => {
    if (event.type !== 'terminal-data') return
    output.set(event.id, (output.get(event.id) ?? '') + event.data)
    terminals.ack(event.id, event.sequence)
  } })
  try {
    const a = await terminals.start(), b = await terminals.start()
    expect(a.id).not.toBe(b.id)
    terminals.write(a.id!, 'echo __REI_FIRST_PTY__\r')
    terminals.write(b.id!, 'echo __REI_SECOND_PTY__\r')
    await vi.waitFor(() => {
      expect(output.get(a.id!)).toContain('__REI_FIRST_PTY__')
      expect(output.get(b.id!)).toContain('__REI_SECOND_PTY__')
    }, { timeout: 3000 })
    expect(output.get(a.id!)).not.toContain('__REI_SECOND_PTY__')
    expect(output.get(b.id!)).not.toContain('__REI_FIRST_PTY__')
    terminals.write(a.id!, 'exit 7\r')
    await vi.waitFor(() => expect(terminals.snapshot().map((state) => state.id)).toEqual([b.id]), { timeout: 3000 })
    terminals.write(b.id!, 'echo __REI_STILL_ALIVE__\r')
    await vi.waitFor(() => expect(output.get(b.id!)).toContain('__REI_STILL_ALIVE__'), { timeout: 3000 })
    terminals.write(b.id!, 'exit\r')
    await vi.waitFor(() => expect(terminals.snapshot()).toEqual([]), { timeout: 3000 })
    expect(terminals.busy).toBe(false)
  } finally { await terminals.close(); await rm(workspace, { recursive: true, force: true }) }
}, 15000)
