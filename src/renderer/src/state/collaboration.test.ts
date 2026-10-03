import { describe, expect, it } from 'vitest'
import type { Frame, Item, SessionState, SessionSummary } from '../../../shared/rpc'
import { rustInitial } from './fixtures'
import { createSessionProjection, projectFrame } from './session'
import { isAgentSession, isRoomSession, roomMetadata, rootSessionId, selectCollaboration } from './collaboration'

const root: SessionSummary = { ...rustInitial.summary, id: 'root', title: 'Project' }
const agent = (id: string, parent = 'root'): SessionSummary => ({ ...root, id, title: id, key: `agent/${parent}/${id}`, parent: { session: parent } })
const room: SessionSummary = { ...root, id: 'room', title: 'review', key: 'rooms/root/review', driver: 'log', parent: { session: 'root' } }
const state = (summary: SessionSummary, patch: Partial<SessionState> = {}) => createSessionProjection({ ...rustInitial, summary, ...patch })
const item = (id: string, body: Item['body']): Item => ({ id, round: 0, status: 'running', startedAt: root.createdAt, body })
const frame = (seq: number, event: Frame['event']): Frame => ({ seq, ts: root.createdAt, session: 'root', event })

describe('source-backed collaboration selectors', () => {
  it('finds the main ancestor and excludes unrelated threads and arbitrary log sessions', () => {
    const sessions = [room, agent('z'), root, agent('nested', 'z'), { ...room, id: 'setup', key: 'setup' }, { ...root, id: 'other' }]
    const selected = selectCollaboration(sessions, {}, 'nested')
    expect(selected.rootId).toBe('root')
    expect(selected.entries.map((entry) => entry.id)).toEqual(['root', 'nested', 'room', 'z'])
    expect(selected.entries[0]).toMatchObject({ kind: 'agent', main: true })
    expect(selected.entries.find((entry) => entry.id === 'room')).toMatchObject({ kind: 'room', main: false, name: 'review' })
    expect(rootSessionId(sessions, 'missing')).toBeNull()
  })

  it('resolves every descendant against one shared index, including deep chains and cycles', () => {
    const chain = Array.from({ length: 3000 }, (_, index) => agent(`a${index}`, index ? `a${index - 1}` : 'root'))
    const cycle = [agent('x', 'y'), agent('y', 'x')]
    const started = performance.now()
    const selected = selectCollaboration([root, ...chain, ...cycle], {}, 'a2999')
    expect(performance.now() - started).toBeLessThan(1000)
    expect(selected.entries).toHaveLength(3001)
    expect(selectCollaboration([root, ...cycle], {}, 'x').rootId).toBeNull()
    expect(rootSessionId([root, ...chain], 'a10')).toBe('root')
  })

  it('recognizes renamed agents by stable parent-qualified key rather than mutable title', () => {
    const renamed = { ...agent('reviewer'), title: 'Source reviewer' }
    expect(isAgentSession(renamed)).toBe(true)
    expect(selectCollaboration([root, renamed], {}, renamed.id).entries[1]).toMatchObject({ id: 'reviewer', name: 'Source reviewer', kind: 'agent' })
    for (const patch of [{ driver: 'log' as const }, { title: '  ' }, { key: 'agent/root/' }, { key: 'agent/other/reviewer' }, { parent: null }]) expect(isAgentSession({ ...renamed, ...patch })).toBe(false)
  })

  it('does not invent a root for missing ancestors or cycles', () => {
    expect(rootSessionId([agent('orphan', 'absent')], 'orphan')).toBeNull()
    expect(rootSessionId([agent('a', 'b'), agent('b', 'a')], 'a')).toBeNull()
    expect(selectCollaboration([], {}, null).entries).toEqual([])
  })

  it('requires all canonical room identity fields and reads defensive extension metadata', () => {
    expect(isRoomSession(room)).toBe(true)
    for (const patch of [{ driver: 'model' as const }, { key: 'room/review' }, { title: null }, { parent: null }]) expect(isRoomSession({ ...room, ...patch })).toBe(false)
    const metadata = roomMetadata(state(room, { extensions: { 'bingo.rooms': { opened: { purpose: 'Review source', by: 'parent' }, members: { members: ['parent', 'z', 'missing'] }, closed: false } } }).snapshot)
    expect(metadata).toEqual({ purpose: 'Review source', members: ['parent', 'z', 'missing'], closed: true })
    expect(roomMetadata(state(room, { extensions: { 'bingo.rooms': { opened: [], members: { members: ['z', 3, null] }, closed: null } } }).snapshot)).toEqual({ purpose: '', members: ['z'], closed: false })
  })

  it('keeps order fixed when busy and update timestamps change, and derives statuses from projections', () => {
    const child = agent('a')
    const sessions = [child, root, room]
    const projections = { a: state(child, { lastTurn: { id: 't', status: { kind: 'failed', error: { code: 'INTERNAL', message: 'failed' } }, startedAt: root.createdAt, endedAt: root.createdAt, usage: { inputTokens: 0, outputTokens: 0 } } }), room: state(room, { extensions: { 'bingo.rooms': { closed: {} } } }) }
    expect(selectCollaboration(sessions, projections, 'a').entries.map(({ id, status }) => [id, status])).toEqual([['root', 'loading'], ['a', 'failed'], ['room', 'closed']])
    expect(selectCollaboration([{ ...child, busy: true, updatedAt: '2099-01-01' }, root, room], projections, 'a').entries.map(({ id }) => id)).toEqual(['root', 'a', 'room'])
  })

  it('surfaces accepted notices, interactions and terminal errors without duplicating row text', () => {
    let projection = state(root, { items: [item('old', { kind: 'assistant', text: 'Earlier output' })] })
    const select = () => selectCollaboration([root], { root: projection }, 'root').entries[0].activity
    projection = projectFrame(projection, frame(1, { type: 'notice', level: 'warn', code: 'RETRY', text: 'Waiting for capacity' }))
    expect(select()).toMatchObject({ kind: 'notice', text: 'Waiting for capacity' })
    projection = projectFrame(projection, frame(2, { type: 'interactionOpened', interaction: { id: 'ask', session: 'root', openedAt: root.createdAt, answers: ['allowOnce'], kind: { kind: 'permission', tool: 'Edit', summary: 'Edit src/main.ts' } } }))
    expect(select()).toMatchObject({ kind: 'interactionOpened', text: 'Edit src/main.ts' })
    projection = projectFrame(projection, frame(3, { type: 'turnCompleted', turn: 't', usage: { inputTokens: 0, outputTokens: 0 }, status: { kind: 'failed', error: { code: 'INTERNAL', message: 'Provider unavailable' } } }))
    expect(select()).toMatchObject({ kind: 'turnCompleted', text: 'Provider unavailable' })
    projection = projectFrame(projection, frame(2, { type: 'notice', level: 'error', code: 'OLD', text: 'Stale notice' }))
    expect(select()?.text).toBe('Provider unavailable')
  })

  it('uses the last accepted journal activity, including an earlier concurrent tool tail', () => {
    let projection = state(root)
    projection = projectFrame(projection, frame(1, { type: 'itemStarted', item: item('first', { kind: 'toolCall', callId: 'c1', name: 'Read', input: { file_path: 'src/a.ts' } }) }))
    projection = projectFrame(projection, frame(2, { type: 'itemStarted', item: item('second', { kind: 'toolCall', callId: 'c2', name: 'Bash', input: { command: 'npm test' } }) }))
    projection = projectFrame(projection, frame(3, { type: 'itemDelta', item: 'first', kind: 'tail', n: 0, data: 'reading lines 20–40' }))
    const select = () => selectCollaboration([root], { root: projection }, 'root').entries[0].activity
    expect(select()).toEqual({ kind: 'toolCall', text: 'Read', detail: 'src/a.ts · reading lines 20–40' })
    projection = projectFrame(projection, frame(2, { type: 'itemUpdated', item: item('second', { kind: 'assistant', text: 'stale' }) }))
    expect(select()?.text).toBe('Read')
    projection = projectFrame(projection, frame(4, { type: 'rewound', generation: 1, toTurn: 't', dropped: ['first'], filesRestored: [] }))
    expect(select()?.text).toBe('Bash')
    projection = projectFrame(projection, frame(5, { type: 'compacted', generation: 2, boundary: 'second', summary: 'summary', kept: [] }))
    expect(projection.activityFrame).toBeUndefined()
  })
})
