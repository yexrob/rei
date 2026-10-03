import { DESKTOP_IMAGE_LIMITS } from '../../shared/desktop'
import type { Image } from '../../shared/rpc'

// Same formats and limits as Main's native picker (readImage in desktop/ipc.ts).
export const ATTACHABLE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export const IMAGE_ERRORS = {
  count: 'Attach at most two images per message. Remove an image before adding another.',
  type: 'Only PNG, JPEG, GIF and WebP images can be attached.',
  size: 'Images must be no larger than 5 MB.'
} as const

export class ImageAttachmentError extends Error {
  constructor(readonly reason: keyof typeof IMAGE_ERRORS) { super(IMAGE_ERRORS[reason]) }
}

/** Image files in a paste or drop; anything else (text, folders) is ignored. */
export function imageFiles(list: FileList | File[] | null | undefined): File[] {
  return [...(list ?? [])].filter(file => file.type.startsWith('image/'))
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

/** Validates everything before reading anything, so a bad drop attaches nothing. */
export async function readImageFiles(files: File[], existing: number): Promise<Image[]> {
  if (existing + files.length > DESKTOP_IMAGE_LIMITS.count) throw new ImageAttachmentError('count')
  if (files.some(file => !(ATTACHABLE_IMAGE_TYPES as readonly string[]).includes(file.type))) throw new ImageAttachmentError('type')
  if (files.some(file => file.size > DESKTOP_IMAGE_LIMITS.bytesPerImage)) throw new ImageAttachmentError('size')
  return Promise.all(files.map(async file => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length > DESKTOP_IMAGE_LIMITS.bytesPerImage) throw new ImageAttachmentError('size')
    return { mediaType: file.type, data: base64(bytes) }
  }))
}
