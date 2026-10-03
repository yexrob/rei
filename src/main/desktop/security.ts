import { z } from 'zod'
import { DESKTOP_METHODS } from '../../shared/desktop'
import { nativePathSchema, preferencesPatchSchema } from './preferences'
import { DesktopFailure } from './rpc-client'

export const connectSchema = z.strictObject({ workspace: nativePathSchema.optional(), binary: nativePathSchema.optional() })
export const hostEpochSchema = z.strictObject({ hostId: z.string().min(1).max(100), connectionId: z.string().min(1).max(100).nullable() })
export const selectionSchema = hostEpochSchema.extend({ sessionId: z.string().min(1).max(512).nullable() }).refine(value => value.sessionId === null || value.connectionId !== null).nullable()
export const agentPageSchema = z.strictObject({ hostId: z.string().min(1).max(100), connectionId: z.string().min(1).max(100), sessionId: z.string().min(1).max(512), itemId: z.string().min(1).max(512) })
export const requestSchema = z.strictObject({ connectionId: z.string().min(1).max(100), method: z.enum(DESKTOP_METHODS), params: z.record(z.string(), z.unknown()) })
const transferId = z.string().min(1).max(100)
const connectionId = z.string().min(1).max(100)
const session = z.string().min(1).max(512)
const hostId = z.string().min(1).max(100)
const token = z.string().min(1).max(256)
const partBase = { transferId, hostId, connectionId, session, token }
const exportBase = { ...partBase, totalBytes: z.number().int().safe().positive(), checksum: z.string().regex(/^[0-9a-f]{16}$/), suggestedName: z.string().min(1).max(160) }
export const boundedRequestSchema = z.strictObject({ transferId, hostId, request: requestSchema }).refine(input => ['session/listHeads', 'session/open', 'session/history', 'session/children'].includes(input.request.method))
export const partRequestSchema = z.union([
  z.strictObject({ ...partBase, kind: z.literal('item'), item: z.string().min(1).max(512), generation: z.number().int().safe().nonnegative(), offset: z.number().int().safe().nonnegative(), maxBytes: z.number().int().safe().min(1).max(256 * 1024) }),
  z.strictObject({ ...partBase, kind: z.enum(['field', 'event']), offset: z.number().int().safe().nonnegative(), maxBytes: z.number().int().safe().min(1).max(256 * 1024) })
])
export const transferCancelSchema = z.strictObject({ transferId, connectionId, session: session.nullable() })
export const exportReferenceSchema = z.union([
  z.strictObject({ ...exportBase, kind: z.literal('item'), item: z.string().min(1).max(512), generation: z.number().int().safe().nonnegative() }),
  z.strictObject({ ...exportBase, kind: z.enum(['field', 'event']) })
])
export const deletionSchema = z.strictObject({ connectionId: z.string().min(1).max(100), session: z.string().min(1).max(512) })
export const exportSchema = z.strictObject({ text: z.string().max(8 * 1024 * 1024), suggestedName: z.string().min(1).max(160) })
export const attentionNoticeSchema = z.strictObject({ kind: z.enum(['waiting', 'completed', 'failed']), title: z.string().min(1).max(120), body: z.string().max(240), hostId: z.string().min(1).max(100), sessionId: z.string().min(1).max(512) })
export const badgeCountSchema = z.number().int().min(0).max(999)
export { preferencesPatchSchema }
export function externalUrl(input: unknown): string {
  const value = z.string().min(1).max(4096).parse(input)
  let url: URL
  try { url = new URL(value) } catch { throw new DesktopFailure('INVALID_URL', 'This is not a valid web URL.') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new DesktopFailure('UNSAFE_URL', 'Only HTTP and HTTPS links without embedded credentials may be opened.')
  return url.href
}
export function sameDocument(actual: string, expected: string): boolean {
  try {
    const a = new URL(actual), b = new URL(expected)
    return a.protocol === b.protocol && a.host === b.host && a.pathname === b.pathname && a.search === b.search && !a.username && !a.password
  } catch { return false }
}
export function trustedSender(event: { sender: unknown; senderFrame: unknown }, contents: { mainFrame: unknown }, expectedUrl: string): boolean {
  if (event.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame) return false
  return sameDocument((event.senderFrame as { url: string }).url, expectedUrl)
}
export function allowsClipboardWrite(requestingContents: unknown, expectedContents: { mainFrame: { url: string } }, permission: string, details: { isMainFrame: boolean; requestingUrl?: string }, documentUrl: string): boolean {
  return permission === 'clipboard-sanitized-write'
    && requestingContents === expectedContents
    && details.isMainFrame === true
    && typeof details.requestingUrl === 'string'
    && sameDocument(details.requestingUrl, documentUrl)
    && sameDocument(expectedContents.mainFrame.url, documentUrl)
}
export function suggestedFilename(input: string): string {
  return input.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/^\.+/, '').slice(0, 120) || 'conversation.txt'
}
