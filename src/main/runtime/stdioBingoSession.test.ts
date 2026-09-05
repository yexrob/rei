import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { StdioBingoSession } from './stdioBingoSession'

// Run the real script child through Node; Windows cannot execute Unix shebang fixtures.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: (file: string, args: string[], options: import('node:child_process').SpawnOptions) => actual.spawn(process.execPath, [file, ...args], options) }
})

const sessionId = 'session-1'
const turnId = '123e4567-e89b-42d3-a456-426614174000'

async function fixture(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bingo-gui-session-'))
  const path = join(directory, 'fake-bingo.mjs')
  await writeFile(path, source)
  await chmod(path, 0o755)
  return path
}

describe('StdioBingoSession', () => {
  it('parses split lines and writes validated commands', async () => {
    const binary = await fixture(`#!/usr/bin/env node
const ready = JSON.stringify({protocolVersion:1,seq:1,sessionId:${JSON.stringify(sessionId)},type:'session.ready',metadata:{bingoVersion:'1.0',protocolVersion:1,sessionId:${JSON.stringify(sessionId)},displayName:'Test',transcriptPath:'/tmp/test',resumed:false,cwd:process.cwd(),provider:'default',model:'test',thinkingLevel:'off',permissionMode:'default',theme:'auto',supportsImages:false}})+'\\n'
process.stdout.write(ready.slice(0, 30)); setTimeout(() => process.stdout.write(ready.slice(30)), 5)
process.stdin.once('data', data => { const c=JSON.parse(data); process.stdout.write(JSON.stringify({protocolVersion:1,seq:2,sessionId:${JSON.stringify(sessionId)},type:'turn.started',commandId:c.commandId,turnId:c.turnId})+'\\n') })
`)
    const events = vi.fn()
    const session = new StdioBingoSession(binary, process.cwd(), { onEvent: events, onExit: vi.fn() })
    await expect(session.open()).resolves.toMatchObject({ sessionId })
    await session.sendTurn(turnId, 'hello')
    await vi.waitFor(() => expect(events).toHaveBeenCalledTimes(2))
  })

  it('closes on sequence gaps', async () => {
    const binary = await fixture(`#!/usr/bin/env node
console.log(JSON.stringify({protocolVersion:1,seq:2,sessionId:null,type:'warning',msg:'gap'})); setTimeout(()=>{}, 1000)
`)
    const onExit = vi.fn()
    const session = new StdioBingoSession(binary, process.cwd(), { onEvent: vi.fn(), onExit })
    await expect(session.open()).rejects.toThrow('sequence mismatch')
    expect(onExit).toHaveBeenCalled()
  })

  it('waits for bingo-owned rename and delete responses', async () => {
    const binary = await fixture(`#!/usr/bin/env node
let seq=1, id=${JSON.stringify(sessionId)}
console.log(JSON.stringify({protocolVersion:1,seq:seq++,sessionId:id,type:'session.ready',metadata:{bingoVersion:'1.0',protocolVersion:1,sessionId:id,displayName:'Test',transcriptPath:'/tmp/test',resumed:true,cwd:process.cwd(),provider:'default',model:'test',thinkingLevel:'off',permissionMode:'default',theme:'auto',supportsImages:false}}))
let buffer=''; process.stdin.on('data', chunk => { buffer += chunk; let i; while ((i=buffer.indexOf('\\n')) >= 0) { const line=buffer.slice(0,i); buffer=buffer.slice(i+1); if (!line) continue; const c=JSON.parse(line); if(c.type==='session.rename'){ const previous=id; id=id+'--Renamed'; console.log(JSON.stringify({protocolVersion:1,seq:seq++,sessionId:id,type:'session.renamed',commandId:c.commandId,previousSessionId:previous,metadata:{bingoVersion:'1.0',protocolVersion:1,sessionId:id,displayName:'Renamed',transcriptPath:'/tmp/renamed',resumed:true,cwd:process.cwd(),provider:'default',model:'test',thinkingLevel:'off',permissionMode:'default',theme:'auto',supportsImages:false}})); } else if(c.type==='session.delete'){ console.log(JSON.stringify({protocolVersion:1,seq:seq++,sessionId:id,type:'session.deleted',commandId:c.commandId,deletedSessionId:id})); process.exit(0); } } })
`)
    const session = new StdioBingoSession(binary, process.cwd(), { onEvent: vi.fn(), onExit: vi.fn() })
    await session.open(sessionId)
    await expect(session.rename('Renamed')).resolves.toMatchObject({ sessionId: `${sessionId}--Renamed` })
    await expect(session.delete()).resolves.toBe(`${sessionId}--Renamed`)
    await session.close()
  })
})
