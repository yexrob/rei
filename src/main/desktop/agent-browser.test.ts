import { describe, expect, it } from 'vitest'
import { AgentBrowser } from './agent-browser'
import type { DesktopEvent } from '../../shared/desktop'
import type { Event } from '../../shared/rpc'

const url = `http://127.0.0.1:43210/${'a'.repeat(43)}`
const frame = (event: Event, connectionId = 'connection'): DesktopEvent => ({ type: 'rpc', connectionId, method: 'event', params: { session: 's', seq: 1, ts: '2026-09-05T00:00:00Z', event } })
const tool = (name = 'ShowPage', status: 'running' | 'pending' = 'running'): DesktopEvent => frame({ type: 'itemStarted', item: { id: 'i', status, startedAt: '2026-09-05T00:00:00Z', body: { kind: 'toolCall', callId: 'call', name, input: {} } } })
const progress = (value: string, connectionId = 'connection') => frame({ type: 'itemDelta', item: 'i', kind: 'tail', n: 1, data: value }, connectionId)

describe('agent browser routing', () => {
  it('opens a live loopback page once, without parsing arbitrary assistant links', () => {
    const router = new AgentBrowser()
    expect(router.route(progress(url))).toBeNull()
    router.route(tool())
    expect(router.route(progress(`Choose a layout — ${url}`))).toBe(url)
    expect(router.route(progress(`Choose a layout — ${url}`))).toBeNull()
  })
  it.each(['Bash', 'WebFetch', 'mcp__server__ShowPage'])('does not automatically open links from %s', (name) => {
    const router = new AgentBrowser(); router.route(tool(name))
    expect(router.route(progress(url))).toBeNull()
  })
  it('does not open pending unapproved tools or foreign connections', () => {
    const router = new AgentBrowser(); router.route(tool('ShowPage', 'pending'))
    expect(router.route(progress(url))).toBeNull()
    router.route(tool()); expect(router.route(progress(url, 'stale'))).toBeNull()
  })
  it.each([url.replace('127.0.0.1', 'example.com'), url.replace('http:', 'https:'), `${url}/answer`, `${url}?token=value`, url.replace(':43210', ':99999'), 'javascript:alert(1)'])('refuses unexpected page destinations', (value) => {
    const router = new AgentBrowser(); router.route(tool())
    expect(router.route(progress(value))).toBeNull()
  })
  it('clears transient page identity when the connection ends', () => {
    const router = new AgentBrowser(); router.route(tool())
    router.route({ type: 'connection', connection: { status: 'disconnected', connectionId: null, binary: null, workspace: null } })
    expect(router.route(progress(url))).toBeNull()
  })
})
