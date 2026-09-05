import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { BingoInspector } from './bingoInspector'

// Run the real script child through Node; Windows cannot execute Unix shebang fixtures.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: (file: string, args: string[], options: import('node:child_process').SpawnOptions) => actual.spawn(process.execPath, [file, ...args], options) }
})

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bingo-gui-inspect-'))
  const path = join(directory, 'fake-bingo.mjs')
  await writeFile(path, `#!/usr/bin/env node
let seq=1
console.log(JSON.stringify({protocolVersion:1,seq:seq++,sessionId:null,type:'inspection.ready',metadata:{bingoVersion:'1.0',protocolVersion:1}}))
let buffer=''; process.stdin.on('data', chunk => { buffer += chunk; let i; while((i=buffer.indexOf('\\n'))>=0){ const line=buffer.slice(0,i); buffer=buffer.slice(i+1); if(!line) continue; const c=JSON.parse(line); if(c.type==='providers.list') console.log(JSON.stringify({protocolVersion:1,seq:seq++,sessionId:null,type:'providers.result',commandId:c.commandId,providers:[{name:'default',protocol:'anthropic',apiBaseUrl:'https://example.test',supportsImages:true,credentialConfigured:true,builtin:false},{name:'opencode-go',protocol:'openai',apiBaseUrl:'https://opencode.ai/zen/go',supportsImages:false,credentialConfigured:false,builtin:true}]})); if(c.type==='models.list') console.log(JSON.stringify({protocolVersion:1,seq:seq++,sessionId:null,type:'models.result',commandId:c.commandId,provider:c.provider,models:['model-a']})); if(c.type==='session.close'){ console.log(JSON.stringify({protocolVersion:1,seq:seq++,sessionId:null,type:'session.closed',commandId:c.commandId})); process.exit(0); } } })
`)
  await chmod(path, 0o755)
  return path
}

describe('BingoInspector', () => {
  it('uses inspect mode to list canonical providers and models', async () => {
    const inspector = new BingoInspector(await fixture(), process.cwd())
    await expect(inspector.open()).resolves.toMatchObject({ bingoVersion: '1.0' })
    await expect(inspector.listProviders()).resolves.toMatchObject([
      { name: 'default', credentialConfigured: true, builtin: false },
      { name: 'opencode-go', credentialConfigured: false, builtin: true }
    ])
    await expect(inspector.listModels('opencode-go')).resolves.toEqual(['model-a'])
    await inspector.close()
  })
})
