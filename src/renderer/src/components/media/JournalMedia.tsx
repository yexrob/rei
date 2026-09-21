import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { ContentPart, Image, Item } from '../../../../shared/rpc'
import { useI18n } from '../../i18n'

const JournalMediaContext = createContext<ReadonlyMap<string, string>>(new Map())
const maxImageChars = 7_000_000

export function recordedImageSource(image: Image): string | undefined {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(image.mediaType) || !image.data || image.data.length > maxImageChars || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) return undefined
  return `data:${image.mediaType};base64,${image.data}`
}

export function recordedImages(parts: ContentPart[]): Extract<ContentPart, { type: 'image' }>[] {
  const images: Extract<ContentPart, { type: 'image' }>[] = []
  let visited = 0
  function visit(parts: ContentPart[], depth: number): void {
    if (depth > 12) return
    for (const part of parts) {
      if (++visited > 4096 || images.length >= 64) return
      if (part.type === 'image') images.push(part)
      if (part.type === 'toolResult') visit(part.parts, depth + 1)
    }
  }
  visit(parts, 0)
  return images
}

export function collectJournalMedia(items: Item[]): ReadonlyMap<string, string> {
  const sources = new Map<string, string>()
  let budget = 28_000_000
  for (const item of items) {
    const parts = item.body.kind === 'user' ? item.body.parts : item.body.kind === 'toolCall' ? item.body.output?.parts ?? [] : []
    for (const image of recordedImages(parts)) {
      if (!image.path || image.path.length > 4096 || image.data.length > budget) continue
      const source = recordedImageSource(image)
      if (!source) continue
      sources.set(image.path, source)
      budget -= image.data.length
      if (sources.size >= 256) return sources
    }
  }
  return sources
}

export function JournalMediaProvider({ items, children }: { items: Item[]; children: ReactNode }): React.JSX.Element {
  const sources = useMemo(() => collectJournalMedia(items), [items])
  return <JournalMediaContext.Provider value={sources}>{children}</JournalMediaContext.Provider>
}

export function useRecordedImage(path: string): string | undefined {
  const sources = useContext(JournalMediaContext)
  // Decode Markdown's escaped separators before distinguishing drive paths from URL schemes.
  let decoded: string
  try { decoded = decodeURIComponent(path) } catch { decoded = path }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(decoded) && !/^[a-z]:[\\/]/i.test(decoded)) return undefined
  // A journal path is an identity, not a request to read or normalize a filesystem path.
  return sources.get(path) ?? sources.get(decoded)
}

export function JournalPictures({ parts }: { parts: ContentPart[] }): React.JSX.Element {
  const { t } = useI18n()
  return <>{recordedImages(parts).slice(0, 5).map((part, index) => {
    const source = recordedImageSource(part)
    return source ? <img key={index} className="attached-image" loading="lazy" alt={t('Attached image {count}', { count: index + 1 })} src={source} /> : null
  })}</>
}
