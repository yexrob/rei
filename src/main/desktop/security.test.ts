import { describe, expect, it } from 'vitest'
import { allowsClipboardWrite, connectSchema, deletionSchema, externalUrl, preferencesPatchSchema, requestSchema, sameDocument, suggestedFilename, trustedSender } from './security'
import { rpcNotificationSchemas, rpcParamsSchemas } from './rpc-validation'

describe('desktop trust boundary', () => {
  it('accepts only the owning top frame at the exact application document', () => {
    const mainFrame = { url: 'file:///Applications/Rei.app/renderer/index.html' }
    const contents = { mainFrame }
    expect(trustedSender({ sender: contents, senderFrame: mainFrame }, contents, mainFrame.url)).toBe(true)
    expect(trustedSender({ sender: {}, senderFrame: mainFrame }, contents, mainFrame.url)).toBe(false)
    expect(trustedSender({ sender: contents, senderFrame: { ...mainFrame } }, contents, mainFrame.url)).toBe(false)
    expect(trustedSender({ sender: contents, senderFrame: null }, contents, mainFrame.url)).toBe(false)
    expect(trustedSender({ sender: contents, senderFrame: mainFrame }, contents, 'file:///other/index.html')).toBe(false)
    expect(sameDocument('http://localhost:5173/#session', 'http://localhost:5173/')).toBe(true)
    expect(sameDocument('http://localhost:5174/', 'http://localhost:5173/')).toBe(false)
    expect(sameDocument('https://evil.test/index.html', 'file:///index.html')).toBe(false)
  })
  it('allows sanitized clipboard writes only from the exact trusted top document', () => {
    const url = 'file:///app/index.html'
    const contents = { mainFrame: { url } }
    const details = { isMainFrame: true, requestingUrl: url }
    expect(allowsClipboardWrite(contents, contents, 'clipboard-sanitized-write', details, url)).toBe(true)
    for (const permission of ['clipboard-read', 'deprecated-sync-clipboard-read', 'media', 'fileSystem', 'unknown']) expect(allowsClipboardWrite(contents, contents, permission, details, url)).toBe(false)
    expect(allowsClipboardWrite(null, contents, 'clipboard-sanitized-write', details, url)).toBe(false)
    expect(allowsClipboardWrite({}, contents, 'clipboard-sanitized-write', details, url)).toBe(false)
    expect(allowsClipboardWrite(contents, contents, 'clipboard-sanitized-write', { ...details, isMainFrame: false }, url)).toBe(false)
    expect(allowsClipboardWrite(contents, contents, 'clipboard-sanitized-write', { isMainFrame: true }, url)).toBe(false)
    expect(allowsClipboardWrite(contents, contents, 'clipboard-sanitized-write', { ...details, requestingUrl: 'https://evil.test/' }, url)).toBe(false)
    contents.mainFrame.url = 'https://evil.test/'
    expect(allowsClipboardWrite(contents, contents, 'clipboard-sanitized-write', details, url)).toBe(false)
  })
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test', 'bingo://shell', 'https://u:p@example.com/', 'not a URL'])('blocks external URL %s', (url) => {
    expect(() => externalUrl(url)).toThrow()
  })
  it('opens only credential-free web URLs and bounds them', () => {
    expect(externalUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(externalUrl('http://localhost:3000/')).toBe('http://localhost:3000/')
    expect(() => externalUrl('https://example.com/' + 'x'.repeat(5000))).toThrow()
  })
  it('allows an omitted workspace only inside a bounded native connect object', () => {
    expect(connectSchema.parse({})).toEqual({})
    expect(connectSchema.parse({ binary: '/approved/bingo' })).toEqual({ binary: '/approved/bingo' })
    expect(connectSchema.parse({ workspace: '/approved/project' })).toEqual({ workspace: '/approved/project' })
    for (const input of [undefined, null, { workspace: null }, { workspace: '' }, { workspace: '/safe\0evil' }, { cwd: '/unapproved' }, { workspace: '/safe', confirmed: true }]) expect(connectSchema.safeParse(input).success).toBe(false)
  })
  it('disallows unknown IPC keys and arbitrary RPC method forwarding', () => {
    expect(requestSchema.safeParse({ connectionId: 'c', method: 'session/submit', params: {} }).success).toBe(true)
    for (const method of ['initialize', 'shutdown', 'session/delete', 'session/extend', 'session/signal', 'exec', '__proto__']) expect(requestSchema.safeParse({ connectionId: 'c', method, params: {} }).success).toBe(false)
    expect(requestSchema.safeParse({ connectionId: 'c', method: 'session/list', params: {}, shell: 'rm' }).success).toBe(false)
    expect(connectSchema.safeParse({ workspace: '/safe', binary: '/bingo', args: ['--danger'] }).success).toBe(false)
    expect(connectSchema.safeParse({ workspace: '/safe\0evil' }).success).toBe(false)
    expect(preferencesPatchSchema.safeParse({ providers: { key: 'never' } }).success).toBe(false)
    expect(deletionSchema.safeParse({ connectionId: 'c', session: 's', confirmed: true }).success).toBe(false)
  })
  it('uses canonical deep request validation including nested answers', () => {
    const answer = { session: 's', intent: 'i', interaction: 'q', activation: 'pointer', answer: { kind: 'form', answers: [{ kind: 'choice', ids: ['one'] }] } }
    expect(rpcParamsSchemas['session/answer'].safeParse(answer).success).toBe(true)
    expect(rpcParamsSchemas['session/answer'].safeParse({ ...answer, answer: { kind: 'allowEverythingForever' } }).success).toBe(false)
    expect(rpcParamsSchemas['session/submit'].safeParse({ session: 's', intent: 'i', input: { kind: 'text', text: 42, origin: { surface: 'desktop' } } }).success).toBe(false)
  })
  it('preserves tagged reference siblings and rejects untagged images', () => {
    const input = { session: 's', intent: 'i', input: { kind: 'text', text: '', images: [{ mediaType: 'image/png', data: 'YQ==' }], origin: { surface: 'desktop' } } }
    expect(rpcParamsSchemas['session/submit'].safeParse(input).success).toBe(true)
    const frame = { seq: 1, session: 's', ts: '2026-01-01', event: { type: 'itemStarted', item: { id: 'i', startedAt: '2026-01-01', status: 'completed', body: { kind: 'user', parts: [{ type: 'image', mediaType: 'image/png', data: 'YQ==' }], origin: { surface: 'desktop' } } } } }
    expect(rpcNotificationSchemas.event.safeParse(frame).success).toBe(true)
    const invalid = structuredClone(frame)
    Reflect.deleteProperty(invalid.event.item.body.parts[0], 'type')
    expect(rpcNotificationSchemas.event.safeParse(invalid).success).toBe(false)
    const interaction = { seq: 2, session: 's', ts: '2026-01-01', event: { type: 'interactionOpened', interaction: { id: 'q', session: 's', openedAt: '2026-01-01', kind: { kind: 'question', question: 'Proceed?', options: [] }, answers: ['text'] } } }
    expect(rpcNotificationSchemas.event.safeParse(interaction).success).toBe(true)
    Reflect.deleteProperty(interaction.event.interaction.kind, 'kind')
    expect(rpcNotificationSchemas.event.safeParse(interaction).success).toBe(false)
  })
  it('suggests a filename, not a renderer-controlled destination path', () => {
    expect(suggestedFilename('../../private/name\0.md')).not.toContain('/')
    expect(suggestedFilename('')).toBe('conversation.txt')
  })
})
