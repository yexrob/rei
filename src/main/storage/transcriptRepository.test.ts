import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { TranscriptRepository } from './transcriptRepository'

describe('TranscriptRepository', () => {
  it('lists newest first, projects messages, and warns on corrupt lines', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bingo-transcripts-')); await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'older.jsonl'), `${JSON.stringify({ role: 'user', content: [{ type: 'text', text: 'old' }] })}\n`)
    await new Promise((resolve) => setTimeout(resolve, 10))
    await writeFile(join(directory, 'newer--Named.jsonl'), `${JSON.stringify({ role: 'user', content: [{ type: 'text', text: 'hello' }] })}\nnot-json\n${JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'final  answer' }] })}\n`)
    const result = await new TranscriptRepository(directory).list()
    expect(result.sessions.map((session) => session.id)).toEqual(['newer--Named', 'older'])
    expect(result.sessions[0]).toMatchObject({ name: 'Named', preview: 'final answer', messageCount: 2 })
    expect(result.warnings).toHaveLength(1)
  })

  it('rejects path-like session IDs', async () => {
    const repository = new TranscriptRepository('/tmp')
    await expect(repository.load('../secret')).rejects.toThrow('Invalid session ID')
  })

  it('titles a session from its first user message and strips markdown from previews', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bingo-gui-summary-'))
    await writeFile(join(dir, 'demo-1.jsonl'), [
      JSON.stringify({ role: 'user', content: [{ type: 'text', text: '**First question** about X' }] }),
      JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'Answer with `inline` code.' }] }),
    ].join('\n'))
    const repo = new TranscriptRepository(dir)
    const { sessions } = await repo.list()
    expect(sessions[0].name).toBe('First question about X')
    expect(sessions[0].preview).toBe('Answer with inline code.')
  })
})