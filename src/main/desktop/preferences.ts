import { open, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import type { DesktopPreferences, PreferencesPatch } from '../../shared/desktop'

export const nativePathSchema = z.string().min(1).max(4096).refine((path) => !path.includes('\0'), 'Invalid path')
export const preferencesPatchSchema = z.strictObject({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  workspace: nativePathSchema.nullable().optional(),
  binaryPath: nativePathSchema.nullable().optional()
})
export const windowBoundsSchema = z.strictObject({
  x: z.number().int(), y: z.number().int(), width: z.number().int().min(640).max(16_384),
  height: z.number().int().min(480).max(16_384), maximized: z.boolean().optional()
})
export type WindowBounds = z.infer<typeof windowBoundsSchema>
const documentSchema = z.strictObject({
  version: z.literal(1),
  preferences: preferencesPatchSchema.extend({
    theme: z.enum(['system', 'light', 'dark']), workspace: nativePathSchema.nullable(),
    binaryPath: nativePathSchema.nullable(), recentWorkspaces: z.array(nativePathSchema).max(12)
  }),
  window: windowBoundsSchema.optional()
})
export const DEFAULT_PREFERENCES: DesktopPreferences = { theme: 'system', workspace: null, binaryPath: null, recentWorkspaces: [] }

/** Owns desktop preferences only; never opens bingo configuration or journals. */
export class PreferencesStore {
  private document: z.infer<typeof documentSchema> = { version: 1, preferences: { ...DEFAULT_PREFERENCES } }
  private writes: Promise<void> = Promise.resolve()
  private writable = true
  readonly path: string
  constructor(private readonly directory: string) { this.path = join(directory, 'desktop-preferences.json') }

  async load(): Promise<void> {
    try {
      const file = await open(this.path, 'r')
      try {
        const buffer = Buffer.alloc(128 * 1024 + 1)
        let length = 0
        while (length < buffer.length) {
          const read = await file.read(buffer, length, buffer.length - length, null)
          if (!read.bytesRead) break
          length += read.bytesRead
        }
        if (length > 128 * 1024) throw new Error('Preferences file exceeds 128 KB.')
        this.document = documentSchema.parse(JSON.parse(buffer.subarray(0, length).toString('utf8')))
      } finally { await file.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.writable = false
      throw new Error(`Desktop preferences could not be read. The file has been preserved: ${this.path}`)
    }
  }
  get preferences(): DesktopPreferences { return structuredClone(this.document.preferences) }
  get bounds(): WindowBounds | undefined { return this.document.window && { ...this.document.window } }

  save(patch: PreferencesPatch): Promise<DesktopPreferences> {
    const parsed = preferencesPatchSchema.parse(patch)
    return this.enqueue(() => {
      const preferences = { ...this.document.preferences, ...parsed }
      if (parsed.workspace) preferences.recentWorkspaces = [parsed.workspace, ...preferences.recentWorkspaces.filter((path) => path !== parsed.workspace)].slice(0, 12)
      return { ...this.document, preferences }
    }).then(() => this.preferences)
  }
  saveBounds(bounds: WindowBounds): Promise<void> {
    return this.enqueue(() => ({ ...this.document, window: windowBoundsSchema.parse(bounds) }))
  }
  flush(): Promise<void> { return this.writes }

  private enqueue(update: () => z.infer<typeof documentSchema>): Promise<void> {
    const operation = this.writes.then(async () => {
      if (!this.writable) throw new Error('Desktop preferences are unreadable and have not been overwritten.')
      const next = update()
      await mkdir(this.directory, { recursive: true })
      await writeFileAtomic(this.path, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, fsync: true })
      this.document = next
    })
    this.writes = operation.catch(() => {})
    return operation
  }
}

export function restoreBounds(saved: WindowBounds | undefined, workAreas: Array<{ x: number; y: number; width: number; height: number }>): WindowBounds | undefined {
  if (!saved || !workAreas.length) return undefined
  const area = workAreas.find((area) => saved.x < area.x + area.width && saved.x + saved.width > area.x && saved.y < area.y + area.height && saved.y + saved.height > area.y) ?? workAreas[0]
  const width = Math.min(saved.width, area.width)
  const height = Math.min(saved.height, area.height)
  return { width, height, x: Math.max(area.x, Math.min(saved.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(saved.y, area.y + area.height - height)), maximized: saved.maximized }
}
