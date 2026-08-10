import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import writeFileAtomic from 'write-file-atomic'

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Theme = 'auto' | 'dark' | 'light'
export type RuntimeSettingsPatch = { provider: string; model: string; thinkingLevel: ThinkingLevel }
export type EditableSettingsPatch = RuntimeSettingsPatch & { apiBaseUrl: string; permissionMode: string; theme: Theme; sendImages: boolean }
export type SettingsLayerSnapshot = {
  path: string
  exists: boolean
  keys: string[]
  values: Partial<Record<keyof EditableSettingsPatch, unknown>>
}
export type SettingsFileSnapshot = {
  path: string
  revision: string
  values: EditableSettingsPatch
  layers: { user: SettingsLayerSnapshot; project: SettingsLayerSnapshot; local: SettingsLayerSnapshot }
  sources: Partial<Record<keyof EditableSettingsPatch, string>>
  shadowed: Array<keyof EditableSettingsPatch>
}

type JsonObject = Record<string, unknown>
const MISSING_REVISION = createHash('sha256').update('').digest('hex')
const EDITABLE_KEYS: Array<keyof EditableSettingsPatch> = ['apiBaseUrl', 'provider', 'model', 'thinkingLevel', 'permissionMode', 'theme', 'sendImages']

export class SettingsRepository {
  constructor(private readonly path: string) {}

  async read(workspacePath: string): Promise<SettingsFileSnapshot> {
    const user = await this.readLayer(this.path)
    const project = await this.readLayer(`${workspacePath}/.bingo/settings.json`)
    const local = await this.readLayer(`${workspacePath}/.bingo/local.json`)
    const merged = { ...user.object, ...project.object, ...local.object }
    const values: EditableSettingsPatch = {
      apiBaseUrl: stringValue(merged.apiBaseUrl),
      provider: stringValue(merged.provider, 'default'),
      model: stringValue(merged.model),
      thinkingLevel: thinkingValue(merged.thinkingLevel),
      permissionMode: stringValue(merged.permissionMode, 'default'),
      theme: themeValue(merged.theme),
      sendImages: booleanValue(merged.sendImages, true)
    }
    const layers = { user: projectLayer(user), project: projectLayer(project), local: projectLayer(local) }
    const sources: SettingsFileSnapshot['sources'] = {}
    const shadowed: Array<keyof EditableSettingsPatch> = []
    for (const key of EDITABLE_KEYS) {
      if (key in local.object) { sources[key] = local.path; shadowed.push(key) }
      else if (key in project.object) { sources[key] = project.path; shadowed.push(key) }
      else if (key in user.object) sources[key] = user.path
    }
    return { path: this.path, revision: user.revision, values, layers, sources, shadowed }
  }

  async saveRuntime(patch: RuntimeSettingsPatch): Promise<void> {
    await this.patch(undefined, patch, false)
  }

  async save(workspacePath: string, baseRevision: string, patch: EditableSettingsPatch): Promise<SettingsFileSnapshot> {
    const before = await this.read(workspacePath)
    if (before.revision !== baseRevision) throw new Error('SETTINGS_CONFLICT: Settings changed on disk. Reload and retry.')
    const blocked = EDITABLE_KEYS.filter((key) => before.shadowed.includes(key) && before.values[key] !== patch[key])
    if (blocked.length > 0) throw new Error(`CONFIG_SHADOWED: ${blocked.join(', ')} ${blocked.length === 1 ? 'is' : 'are'} overridden by a workspace layer.`)
    await this.patch(before, patch, true)
    return this.read(workspacePath)
  }

  private async patch(before: SettingsFileSnapshot | undefined, patch: Partial<EditableSettingsPatch>, backup: boolean): Promise<void> {
    const layer = await this.readLayer(this.path)
    if (before && layer.revision !== before.revision) throw new Error('SETTINGS_CONFLICT: Settings changed on disk. Reload and retry.')
    const next = { ...layer.object, ...patch }
    if (backup && layer.exists) await copyFile(this.path, `${this.path}.bak-${timestamp()}`)
    await mkdir(dirname(this.path), { recursive: true })
    await writeFileAtomic(this.path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, fsync: true })
  }

  private async readLayer(path: string): Promise<{ path: string; exists: boolean; source: string; revision: string; object: JsonObject }> {
    let source: string
    try { source = await readFile(path, 'utf8') } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { path, exists: false, source: '', revision: MISSING_REVISION, object: {} }
      throw error
    }
    let value: unknown
    try { value = JSON.parse(source) } catch (error) { throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : 'invalid JSON'}`) }
    if (!isObject(value)) throw new Error(`Cannot read ${path}: settings must be a JSON object`)
    return { path, exists: true, source, revision: createHash('sha256').update(source).digest('hex'), object: value }
  }
}

function projectLayer(layer: { path: string; exists: boolean; object: JsonObject }): SettingsLayerSnapshot {
  const values: SettingsLayerSnapshot['values'] = {}
  for (const key of EDITABLE_KEYS) if (key in layer.object) values[key] = layer.object[key]
  return { path: layer.path, exists: layer.exists, keys: Object.keys(layer.object), values }
}
function isObject(value: unknown): value is JsonObject { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function stringValue(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback }
function booleanValue(value: unknown, fallback: boolean): boolean { return typeof value === 'boolean' ? value : fallback }
function thinkingValue(value: unknown): ThinkingLevel { return ['off', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(value)) ? value as ThinkingLevel : 'off' }
function themeValue(value: unknown): Theme { return value === 'dark' || value === 'light' ? value : 'auto' }
function timestamp(): string { return new Date().toISOString().replace(/[:.]/g, '-') }
