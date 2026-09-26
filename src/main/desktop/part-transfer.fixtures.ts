import { hostA, hostB, restartedHostA } from '../../shared/desktop.fixtures'

// Consumer boundary examples only. They do not claim a frozen Core or desktop
// message shape; bind these to generated RPC types after Core contract freeze.
export const exactSerializedItem = '{"kind":"assistant","text":"🧪 test"}'
export const exactBytes = 39
export const exactFnv64 = 'a6a4eddc16724d5c' // FNV-1a/64 over UTF-8 bytes, not authentication.
export const maxNativePartBytes = 256 * 1024
const token = 'opaque-server-connection-and-session-bound-token'
const transfer = 'native-transfer-1'
const source = { hostId: hostA.hostId, connectionId: hostA.connectionId!, sessionId: 'session-a' }
const pieces: string[] = ['{"kind":"assistant","text":"', '🧪', ' test"}']
const offsets = [0, Buffer.byteLength(pieces[0]), Buffer.byteLength(pieces[0] + pieces[1])]
export const validParts = pieces.map((data, index) => ({
  ...source, token, transfer, index, total: pieces.length, offset: offsets[index], totalBytes: exactBytes, digest: exactFnv64, data
}))
export type PartFixture = typeof validParts[number]
export const invalidParts: Array<{ name: string; parts: PartFixture[]; reason: string }> = [
  { name: 'duplicate part', parts: [validParts[0], validParts[1], validParts[1], validParts[2]], reason: 'non-contiguous index' },
  { name: 'missing middle part', parts: [validParts[0], validParts[2]], reason: 'non-contiguous index/offset' },
  { name: 'wrong host', parts: [validParts[0], { ...validParts[1], hostId: hostB.hostId }, validParts[2]], reason: 'foreign host' },
  { name: 'old epoch', parts: [validParts[0], { ...validParts[1], connectionId: restartedHostA.connectionId! }, validParts[2]], reason: 'stale epoch' },
  { name: 'foreign session', parts: [validParts[0], { ...validParts[1], sessionId: 'session-b' }, validParts[2]], reason: 'foreign session' },
  { name: 'unbound token', parts: [validParts[0], { ...validParts[1], token: 'other-token' }, validParts[2]], reason: 'stale or forged token' },
  { name: 'offset overlap', parts: [validParts[0], { ...validParts[1], offset: 1 }, validParts[2]], reason: 'non-contiguous byte offset' },
  { name: 'changed digest', parts: [validParts[0], validParts[1], { ...validParts[2], digest: '0000000000000000' }], reason: 'payload integrity' },
  { name: 'transport over byte cap', parts: [{ ...validParts[0], data: 'x'.repeat(maxNativePartBytes + 1) }], reason: 'per-part transport budget' }
]
