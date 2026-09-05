import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeLocator } from './runtimeLocator'

// Run the real script child through Node; Windows cannot execute Unix shebang fixtures.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: (file: string, args: string[], options: import('node:child_process').SpawnOptions) => actual.spawn(process.execPath, [file, ...args], options) }
})

async function fixture(body: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bingo-gui-probe-'))
  const path = join(directory, 'bingo')
  await writeFile(path, `#!/usr/bin/env node\n${body}`)
  await chmod(path, 0o755)
  return path
}

describe('RuntimeLocator probe', () => {
  it('uses side-effect-free probe and returns its version', async () => {
    const binary = await fixture(`
if (process.argv.slice(2).join(' ') !== '--json-events --probe') process.exit(9)
console.log(JSON.stringify({protocolVersion:1,seq:1,sessionId:null,type:'protocol.ready',bingoVersion:'0.4.0'}))
`)
    const result = await new RuntimeLocator({ env: { ...process.env, BINGO_GUI_BINARY: binary } }).probe(process.cwd())
    expect(result).toMatchObject({ ok: true, value: { bingoVersion: '0.4.0', protocolVersion: 1, workspacePath: process.cwd() } })
    if (result.ok) expect(result.value.binaryPath).toMatch(/bingo-gui-probe-.+[\\/]bingo$/)
  })

  it('rejects extra probe events', async () => {
    const record = JSON.stringify({ protocolVersion: 1, seq: 1, sessionId: null, type: 'protocol.ready', bingoVersion: '0.4.0' })
    const binary = await fixture(`console.log(${JSON.stringify(record)}); console.log(${JSON.stringify(record)})`)
    const result = await new RuntimeLocator({ env: { ...process.env, BINGO_GUI_BINARY: binary } }).probe(process.cwd())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('BINGO_PROTOCOL_UNSUPPORTED')
  })
})
