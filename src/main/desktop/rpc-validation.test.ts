import { expect, it } from 'vitest'
import { rpcResultSchemas } from './rpc-validation'

// Shape captured from an isolated real bingo-improve serve --stdio session after
// a fake-provider turn and Write permission answer, then session/open by ID.
const resumed = {
  session: 'fixture-session',
  snapshot: {
    seq: 32,
    summary: { id: 'fixture-session', title: 'Create a note', cwd: '/isolated/workspace', driver: 'model', model: 'fake-1', provider: 'fake', createdAt: '2026-09-17T08:59:21.954785Z', updatedAt: '2026-09-17T08:59:22.039112Z' },
    items: [],
    lastTurn: {
      id: 'fixture-turn', status: { kind: 'completed' }, startedAt: '2026-09-17T08:59:22.039335Z', endedAt: '2026-09-17T08:59:22.768364Z',
      usage: { inputTokens: 27296, outputTokens: 42, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
    }
  }
}

it('accepts a resumed session with the canonical LastTurn record intact', () => {
  expect(rpcResultSchemas['session/open'].parse(resumed)).toEqual(resumed)
})

it('rejects obsolete bare statuses and incomplete or malformed LastTurn records', () => {
  for (const lastTurn of [{ kind: 'completed' }, { status: { kind: 'completed' } }, { ...resumed.snapshot.lastTurn, status: { kind: 'unknown' } }, { ...resumed.snapshot.lastTurn, usage: { inputTokens: -1, outputTokens: 0 } }]) {
    expect(rpcResultSchemas['session/open'].safeParse({ ...resumed, snapshot: { ...resumed.snapshot, lastTurn } }).success).toBe(false)
  }
})
