import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentBrowser } from './agent-browser'
import { hostA, hostB, selectionA, selectionB, pageTargetA, pageTargetB, rejectedAgentPages } from '../../shared/desktop.fixtures'
import type { ConnectionState, ConversationSelection, DesktopEvent, AgentPageTarget } from '../../shared/desktop'
import type { Event } from '../../shared/rpc'
const url = `http://127.0.0.1:43210/${'a'.repeat(43)}`
let sequence = 0
beforeEach(() => { sequence = 0 })
const frame = (target: AgentPageTarget, event: Event): DesktopEvent => ({ type: 'rpc', connectionId: target.connectionId, method: 'event', params: { session: target.sessionId, seq: ++sequence, ts: '', event } })
const tool = (target = pageTargetA, name = 'ShowPage', status: 'running' | 'pending' = 'running') => frame(target, { type: 'itemStarted', item: { id: target.itemId, status, startedAt: '', body: { kind: 'toolCall', callId: 'call', name, input: { title: 'Choice' } } } })
const progress = (value: string, target = pageTargetA) => frame(target, { type: 'itemDelta', item: target.itemId, kind: 'tail', n: 1, data: value })
function setup() {
  let selected: ConversationSelection | null = selectionB
  const connections = new Map<string, ConnectionState>([[hostA.connectionId!, hostA], [hostB.connectionId!, hostB]])
  const emit = vi.fn(), open = vi.fn()
  const router = new AgentBrowser({ connection: id => connections.get(id) ?? null, selection: () => selected, emit, open })
  return { router, emit, open, select: (value: ConversationSelection | null) => { selected = value }, connections }
}
describe('sourced agent browser routing', () => {
  it('announces background pages without navigation, then opens only the selected source', () => {
    const { router, open, emit, select } = setup()
    router.route(tool()); router.route(progress(url))
    expect(open).not.toHaveBeenCalled()
    expect(emit).toHaveBeenLastCalledWith({ type: 'agent-page', page: { ...pageTargetA, title: 'Choice', status: 'available' } })
    expect(() => router.open(pageTargetA)).toThrow('Select')
    select(selectionA); router.open(pageTargetA)
    expect(open).toHaveBeenCalledExactlyOnceWith(url)
    expect(emit).toHaveBeenLastCalledWith({ type: 'agent-page', page: { ...pageTargetA, title: 'Choice', status: 'opened' } })
  })
  it('preserves foreground automatic approved ShowPage opening and deduplicates progress', () => {
    const { router, open } = setup()
    router.route(tool(pageTargetB)); router.route(progress(url, pageTargetB)); router.route(progress(url, pageTargetB))
    expect(open).toHaveBeenCalledExactlyOnceWith(url)
  })
  it.each(['Bash', 'WebFetch', 'mcp__server__ShowPage'])('never opens assistant/unapproved tool links from %s', name => {
    const { router, open, select } = setup(); select(selectionA)
    router.route(progress(url)); router.route(tool(pageTargetA, name)); router.route(progress(url))
    expect(open).not.toHaveBeenCalled()
  })
  it.each([url.replace('127.0.0.1', 'example.com'), url.replace('http:', 'https:'), `${url}/answer`, `${url}?token=value`, url.replace(':43210', ':99999'), 'javascript:alert(1)'])('refuses unexpected page destination %s', value => {
    const { router, open, select } = setup(); select(selectionA); router.route(tool()); router.route(progress(value))
    expect(open).not.toHaveBeenCalled()
  })
  it.each(rejectedAgentPages)('rejects shared page admission fixture: $name', ({ input }) => {
    const { router, select } = setup(); select(selectionA); router.route(tool()); router.route(progress(url))
    expect(() => router.open(input as AgentPageTarget)).toThrow()
  })
  it('never resurrects a completed page from an older same-epoch running-item replay', () => {
    const { router, open, select } = setup(); select(selectionA)
    const running = frame(pageTargetA, { type: 'itemUpdated', item: { id: pageTargetA.itemId, status: 'running', startedAt: '', body: { kind: 'toolCall', callId: 'call', name: 'ShowPage', input: {}, progress: url } } })
    router.route(running)
    router.route(frame(pageTargetA, { type: 'itemCompleted', item: { id: pageTargetA.itemId, status: 'completed', startedAt: '', body: { kind: 'toolCall', callId: 'call', name: 'ShowPage', input: {} } } }))
    router.route(running)
    expect(open).toHaveBeenCalledOnce()
    expect(router.snapshot()).toEqual([])
    expect(() => router.open(pageTargetA)).toThrow('completed')
  })
  it('invalidates only the failing host, and rejects completed/old epoch items', () => {
    const { router, emit, connections } = setup()
    router.route(tool()); router.route(progress(url)); router.route(tool(pageTargetB)); router.route(progress(url, pageTargetB))
    connections.set(hostA.connectionId!, { ...hostA, status: 'failed' })
    router.route({ type: 'connection', connection: { ...hostA, status: 'failed' } })
    expect(router.snapshot()).toEqual([{ ...pageTargetB, title: 'Choice', status: 'opened' }])
    expect(emit).toHaveBeenCalledWith({ type: 'agent-page', page: { ...pageTargetA, title: 'Choice', status: 'invalidated' } })
    router.route(frame(pageTargetB, { type: 'itemCompleted', item: { id: pageTargetB.itemId, status: 'completed', startedAt: '', body: { kind: 'toolCall', callId: 'call', name: 'ShowPage', input: {} } } }))
    expect(() => router.open(pageTargetB)).toThrow()
    expect(router.snapshot()).toEqual([])
  })
})
