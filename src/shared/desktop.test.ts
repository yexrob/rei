import { describe, expect, expectTypeOf, it } from 'vitest'
import { DESKTOP_IPC, type AgentPageTarget, type BingoDesktopApi, type ConversationSelection, type DesktopEvent, type HostEpoch } from './desktop'
import { answerB, draftA, emptyBootstrap, epochA, failedHostA, hostA, hostARestartEvents, hostB, interleavedHostEvents, multiHostBootstrap, pageA, pageTargetA, rejectedAgentPages, rejectedSelections, rendererInvalidated, rendererOnlyCollidingSelections, restartedHostA, selectionA, selectionB, stopA } from './desktop.fixtures'

describe('desktop multi-host contract fixtures', () => {
  it('publishes distinct channels for ensure, reconnect, selection, idle close and sourced page open', () => {
    expect(DESKTOP_IPC).toMatchObject({
      connect: 'desktop:connect', reconnect: 'desktop:reconnect', selectConversation: 'desktop:select-conversation', closeHost: 'desktop:close-host', openAgentPage: 'desktop:open-agent-page'
    })
    expect(new Set(Object.values(DESKTOP_IPC)).size).toBe(Object.values(DESKTOP_IPC).length)
    expectTypeOf<Parameters<BingoDesktopApi['reconnect']>[0]>().toEqualTypeOf<HostEpoch>()
    expectTypeOf<Parameters<BingoDesktopApi['selectConversation']>[0]>().toEqualTypeOf<ConversationSelection | null>()
    expectTypeOf<Parameters<BingoDesktopApi['openAgentPage']>[0]>().toEqualTypeOf<AgentPageTarget>()
  })

  it('bootstraps all hosts with exactly one independent selection and no legacy connection field', () => {
    expect(multiHostBootstrap.connections.map(host => host.hostId)).toEqual([hostA.hostId, hostB.hostId])
    expect(multiHostBootstrap.selection).toEqual(selectionB)
    expect(multiHostBootstrap).not.toHaveProperty('connection')
    expect(emptyBootstrap.connections).toEqual([])
    expect(emptyBootstrap.selection).toBeNull()
    expect(draftA.sessionId).toBeNull()
    expect(draftA.hostId).toBe(hostA.hostId)
  })

  it('distinguishes stable draft identity from replaceable execution epochs', () => {
    expect(restartedHostA.hostId).toBe(hostA.hostId)
    expect(restartedHostA.connectionId).not.toBe(hostA.connectionId)
    expect(failedHostA.connectionId).toBe(hostA.connectionId)
    expect(hostARestartEvents[1]).toMatchObject({ type: 'rpc', connectionId: hostA.connectionId })
    expect(epochA).toEqual({ hostId: hostA.hostId, connectionId: hostA.connectionId })
  })

  it('provides interleaved events with colliding subordinate IDs without changing the selected host', () => {
    const frames = interleavedHostEvents.flatMap(event => event.type === 'rpc' && event.method === 'event' ? [event] : [])
    expect(frames.map(event => [event.connectionId, event.params.seq])).toEqual([['epoch-a-1', 1], ['epoch-b-1', 1], ['epoch-a-1', 2], ['epoch-b-1', 2]])
    const questions = frames.flatMap(event => event.params.event.type === 'interactionOpened' ? [event.params.event.interaction] : [])
    expect(questions.map(question => question.id)).toEqual(['shared-question', 'shared-question'])
    expect(questions.map(question => question.session)).toEqual(['session-a', 'session-b'])
    expect(multiHostBootstrap.selection).toEqual(selectionB)
    expect(stopA).toMatchObject({ connectionId: 'epoch-a-1', params: { session: 'session-a', scope: { kind: 'head' } } })
    expect(answerB).toMatchObject({ connectionId: 'epoch-b-1', params: { session: 'session-b', interaction: 'shared-question' } })
  })

  it('keeps page state sourced and privileged opens identity-only', () => {
    expect(pageA).toMatchObject({ ...pageTargetA, title: 'Project A choice', status: 'available' })
    expect(Object.keys(pageTargetA).sort()).toEqual(['connectionId', 'hostId', 'itemId', 'sessionId'])
    expect(interleavedHostEvents).toContainEqual({ type: 'agent-page', page: { ...multiHostBootstrap.agentPages[1], status: 'opened' } })
    expect(hostARestartEvents).toContainEqual({ type: 'agent-page', page: { ...pageA, status: 'invalidated' } })
  })

  it('provides one small global invalidation event, not N host snapshots', () => {
    expect(rendererInvalidated).toMatchObject({ type: 'runtime-invalidated', error: { code: 'RENDERER_BACKPRESSURE' } })
    expect(Object.keys(rendererInvalidated).sort()).toEqual(['error', 'type'])
    expect(JSON.stringify(rendererInvalidated).length).toBeLessThan(1024)
    expectTypeOf<typeof rendererInvalidated>().toExtend<DesktopEvent>()
  })

  it('exports adversarial admission cases for actual main and renderer consumers', () => {
    expect(rejectedSelections).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'nonempty session without an epoch', input: { ...selectionA, connectionId: null } }),
      expect.objectContaining({ name: 'epoch belongs to another host' }),
      expect.objectContaining({ name: 'session is owned by another host' })
    ]))
    expect(rejectedAgentPages.map(testCase => testCase.name)).toContain('renderer-supplied URL')
    expect(rendererOnlyCollidingSelections[0].sessionId).toBe(rendererOnlyCollidingSelections[1].sessionId)
    expect(rendererOnlyCollidingSelections[0].hostId).not.toBe(rendererOnlyCollidingSelections[1].hostId)
  })
})
