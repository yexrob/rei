import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import writeFileAtomic from 'write-file-atomic'

export type RuntimeSettingsPatch = {
  provider: string
  model: string
  thinkingLevel: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

export class SettingsRepository {
  constructor(private readonly path: string) {}

  async saveRuntime(patch: RuntimeSettingsPatch): Promise<void> {
    let source = '{}\n'
    try { source = await readFile(this.path, 'utf8') } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    let value: unknown
    try { value = JSON.parse(source) } catch (error) {
      throw new Error(`Cannot update ${this.path}: ${error instanceof Error ? error.message : 'invalid JSON'}`)
    }
    if (!isObject(value)) throw new Error(`Cannot update ${this.path}: settings must be a JSON object`)
    const next = { ...value, provider: patch.provider, model: patch.model, thinkingLevel: patch.thinkingLevel }
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true })
    await writeFileAtomic(this.path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, fsync: true })
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
