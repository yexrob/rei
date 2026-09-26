import { expect, it } from 'vitest'
import { exactSerializedItem, exactBytes, exactFnv64, invalidParts, maxNativePartBytes, validParts } from './part-transfer.fixtures'

it('defines exact UTF-8 payload, byte offsets and independent FNV-1a/64 vector', () => {
  expect(Buffer.byteLength(exactSerializedItem, 'utf8')).toBe(exactBytes)
  expect(validParts.map(part => part.offset)).toEqual([0, 28, 32])
  expect(validParts.map(part => part.index)).toEqual([0, 1, 2])
  expect(validParts.map(part => part.data).join('')).toBe(exactSerializedItem)
  expect(validParts.reduce((bytes, part) => bytes + Buffer.byteLength(part.data, 'utf8'), 0)).toBe(exactBytes)
  expect(exactFnv64).toBe('a6a4eddc16724d5c')
  expect(maxNativePartBytes).toBeLessThan(1024 * 1024)
})
it('enumerates byte/order/epoch/token/integrity and over-budget negative consumers before implementation', () => {
  expect(invalidParts.map(test => test.name)).toEqual([
    'duplicate part', 'missing middle part', 'wrong host', 'old epoch', 'foreign session', 'unbound token', 'offset overlap', 'changed digest', 'transport over byte cap'
  ])
  expect(invalidParts.every(test => test.reason.length > 0)).toBe(true)
  // These are cases for the real trusted-ACK consumer, NOT a pass for a future
  // part receiver. At freeze, that receiver must import every case and reject.
})
