// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { imageFiles, readImageFiles } from './images'

const file = (type: string, bytes = 3) => new File([new Uint8Array(bytes).fill(65)], 'x', { type })

describe('pasted and dropped images', () => {
  it('reads accepted images as base64 with their media type', async () => {
    await expect(readImageFiles([file('image/png')], 0)).resolves.toEqual([{ mediaType: 'image/png', data: 'QUFB' }])
  })
  it('applies the picker count, format and size limits before reading', async () => {
    await expect(readImageFiles([file('image/png'), file('image/png')], 1)).rejects.toThrow('Attach at most two images')
    await expect(readImageFiles([file('image/svg+xml')], 0)).rejects.toThrow('Only PNG, JPEG, GIF and WebP')
    await expect(readImageFiles([file('image/jpeg', 5 * 1024 * 1024 + 1)], 0)).rejects.toThrow('no larger than 5 MB')
  })
  it('ignores non-image files in a transfer', () => {
    expect(imageFiles([file('text/plain'), file('image/gif')]).map(item => item.type)).toEqual(['image/gif'])
  })
})
