import type { AgentPageState, AgentPageTarget, ConnectionState, ConversationSelection, DesktopBootstrap, DesktopEvent, DesktopRequest, HostEpoch } from './desktop'

// Shared consumer fixtures, not a second implementation of native admission or
// renderer routing. Main, preload and renderer tests exercise their own code.
const time = '2026-09-22T00:00:00Z'
export const hostA: ConnectionState = { hostId: 'host-project-a', connectionId: 'epoch-a-1', workspace: '/approved/project-a', binary: '/approved/bingo', status: 'ready', busy: false }
export const hostB: ConnectionState = { hostId: 'host-project-b', connectionId: 'epoch-b-1', workspace: '/approved/project-b', binary: '/approved/bingo', status: 'ready', busy: false }
export const restartedHostA: ConnectionState = { ...hostA, connectionId: 'epoch-a-2' }
export const disconnectedHostA: ConnectionState = { ...hostA, connectionId: null, status: 'disconnected' }
export const failedHostA: ConnectionState = { ...hostA, status: 'failed', busy: true, error: { code: 'PROCESS_EXITED', message: 'The project A runtime stopped.' } }
// Main's invoke reply may overtake earlier lifecycle notifications. A native
// revision orders both channels, including disconnected(null) before startup.
export const orderedStartupConnections: Array<ConnectionState & { revision: number }> = [
  { ...hostA, revision: 1, status: 'disconnected', connectionId: null, busy: true },
  { ...hostA, revision: 2, status: 'connecting', busy: true },
  { ...hostA, revision: 3, status: 'ready' },
  { ...failedHostA, revision: 4 }
]
export const epochA: HostEpoch = { hostId: hostA.hostId, connectionId: hostA.connectionId }
export const epochB: HostEpoch = { hostId: hostB.hostId, connectionId: hostB.connectionId }
export const selectionA: ConversationSelection = { ...epochA, sessionId: 'session-a' }
export const selectionB: ConversationSelection = { ...epochB, sessionId: 'session-b' }
export const draftA: ConversationSelection = { ...epochA, sessionId: null }

export const pageA: AgentPageState = { hostId: hostA.hostId, connectionId: 'epoch-a-1', sessionId: 'session-a', itemId: 'shared-page-item', title: 'Project A choice', status: 'available' }
export const pageB: AgentPageState = { hostId: hostB.hostId, connectionId: 'epoch-b-1', sessionId: 'session-b', itemId: 'shared-page-item', title: 'Project B choice', status: 'available' }
export const pageTargetA: AgentPageTarget = { hostId: pageA.hostId, connectionId: pageA.connectionId, sessionId: pageA.sessionId, itemId: pageA.itemId }
export const pageTargetB: AgentPageTarget = { hostId: pageB.hostId, connectionId: pageB.connectionId, sessionId: pageB.sessionId, itemId: pageB.itemId }

export const multiHostBootstrap: DesktopBootstrap = {
  version: 'fixture', platform: 'test', scratchWorkspace: '/approved/scratch',
  preferences: { theme: 'system', workspace: hostB.workspace, binaryPath: null, recentWorkspaces: [hostA.workspace!, hostB.workspace!] },
  binary: { path: '/approved/bingo', source: 'fixture' },
  connections: [hostA, hostB], selection: selectionB, agentPages: [pageA, pageB]
}
export const emptyBootstrap: DesktopBootstrap = { ...multiHostBootstrap, connections: [], selection: null, agentPages: [] }

export const interleavedHostEvents: DesktopEvent[] = [
  { type: 'connection', connection: { ...hostA, busy: true } },
  { type: 'rpc', connectionId: 'epoch-a-1', method: 'event', params: { session: 'session-a', seq: 1, ts: time, event: { type: 'turnStarted', turn: 'shared-turn', inputs: [], origin: 'submit' } } },
  { type: 'rpc', connectionId: 'epoch-b-1', method: 'event', params: { session: 'session-b', seq: 1, ts: time, event: { type: 'turnStarted', turn: 'shared-turn', inputs: [], origin: 'submit' } } },
  { type: 'rpc', connectionId: 'epoch-a-1', method: 'event', params: { session: 'session-a', seq: 2, ts: time, event: { type: 'interactionOpened', interaction: { id: 'shared-question', session: 'session-a', openedAt: time, kind: { kind: 'permission', tool: 'Read', summary: 'Read in project A' }, answers: ['allowOnce', 'deny'] } } } },
  { type: 'rpc', connectionId: 'epoch-b-1', method: 'event', params: { session: 'session-b', seq: 2, ts: time, event: { type: 'interactionOpened', interaction: { id: 'shared-question', session: 'session-b', openedAt: time, kind: { kind: 'permission', tool: 'Read', summary: 'Read in project B' }, answers: ['allowOnce', 'deny'] } } } },
  { type: 'agent-page', page: pageA },
  { type: 'agent-page', page: { ...pageB, status: 'opened' } },
  { type: 'connection', connection: failedHostA }
]

export const hostARestartEvents: DesktopEvent[] = [
  { type: 'connection', connection: restartedHostA },
  { type: 'rpc', connectionId: 'epoch-a-1', method: 'event', params: { session: 'session-a', seq: 3, ts: time, event: { type: 'notice', level: 'error', code: 'LATE', text: 'Old epoch; never apply to epoch-a-2.' } } },
  { type: 'agent-page', page: { ...pageA, status: 'invalidated' } }
]
export const rendererInvalidated: DesktopEvent = { type: 'runtime-invalidated', error: { code: 'RENDERER_BACKPRESSURE', message: 'The window could not keep up. All runtime connections were invalidated; reconnect to recover saved history.' } }

export const stopA: DesktopRequest<'session/interrupt'> = { connectionId: 'epoch-a-1', method: 'session/interrupt', params: { session: 'session-a', intent: 'stop-a', scope: { kind: 'head' } } }
export const answerB: DesktopRequest<'session/answer'> = { connectionId: 'epoch-b-1', method: 'session/answer', params: { session: 'session-b', intent: 'answer-b', interaction: 'shared-question', answer: { kind: 'allowOnce' }, activation: 'pointer' } }

// Consumer tests install A/B above (and session-a/session-b as successfully
// opened), then assert refusal rather than forwarding these to another host.
export const rejectedSelections: Array<{ name: string; input: unknown }> = [
  { name: 'unknown host', input: { ...selectionA, hostId: 'host-missing' } },
  { name: 'epoch belongs to another host', input: { ...selectionA, connectionId: 'epoch-b-1' } },
  { name: 'session is owned by another host', input: { ...selectionB, sessionId: 'session-a' } },
  { name: 'session has not been opened', input: { ...selectionA, sessionId: 'session-unopened' } },
  { name: 'nonempty session without an epoch', input: { ...selectionA, connectionId: null } },
  { name: 'null host mixed with an epoch', input: { ...selectionA, hostId: null } }
]
export const staleEpochAfterRestart: HostEpoch = epochA
export const rejectedAgentPages: Array<{ name: string; input: unknown }> = [
  { name: 'forged item', input: { ...pageTargetA, itemId: 'item-not-running' } },
  { name: 'wrong host epoch', input: { ...pageTargetA, connectionId: 'epoch-b-1' } },
  { name: 'foreign session', input: { ...pageTargetB, sessionId: 'session-a' } },
  { name: 'renderer-supplied URL', input: { ...pageTargetA, url: 'https://untrusted.example/' } },
  { name: 'no epoch', input: { ...pageTargetA, connectionId: null } }
]

// Deliberately impossible for two owners of one real core journal. Renderer-only
// collision tests must still qualify IDs; native tests must NOT admit both.
export const rendererOnlyCollidingSelections: ConversationSelection[] = [selectionA, { ...selectionB, sessionId: selectionA.sessionId }]
