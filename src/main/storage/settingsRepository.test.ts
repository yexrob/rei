import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SettingsRepository } from './settingsRepository'

const editable = { apiBaseUrl: 'https://user.test', provider: 'opencode-go', model: 'gpt-5.6-luna', thinkingLevel: 'high' as const, permissionMode: 'default', theme: 'dark' as const, sendImages: false }

describe('SettingsRepository', () => {
  it('preserves unknown keys, creates a backup, and returns three-layer source metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bingo-gui-settings-'))
    const workspace = join(directory, 'workspace')
    const path = join(directory, 'settings.json')
    await mkdir(join(workspace, '.bingo'), { recursive: true })
    await writeFile(path, JSON.stringify({ unknown: { keep: true }, provider: 'old', apiKey: 'secret' }))
    await writeFile(join(workspace, '.bingo', 'settings.json'), JSON.stringify({ permissionMode: 'plan' }))
    const repository = new SettingsRepository(path)
    const before = await repository.read(workspace)

    expect(before.values.permissionMode).toBe('plan')
    expect(before.shadowed).toContain('permissionMode')
    const saved = await repository.save(workspace, before.revision, { ...editable, permissionMode: 'plan' })

    expect(saved.values.provider).toBe('opencode-go')
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ unknown: { keep: true }, apiKey: 'secret', provider: 'opencode-go' })
    expect((await readdir(directory)).some((name) => name.startsWith('settings.json.bak-'))).toBe(true)
  })

  it('leaves invalid settings byte-identical', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bingo-gui-settings-'))
    const path = join(directory, 'settings.json')
    await writeFile(path, '{invalid')
    await expect(new SettingsRepository(path).read(directory)).rejects.toThrow(`Cannot read ${path}`)
    expect(await readFile(path, 'utf8')).toBe('{invalid')
  })

  it('rejects stale revisions without writing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bingo-gui-settings-'))
    const path = join(directory, 'settings.json')
    await writeFile(path, '{}')
    const repository = new SettingsRepository(path)
    await expect(repository.save(directory, 'stale', editable)).rejects.toThrow('SETTINGS_CONFLICT')
    expect(await readFile(path, 'utf8')).toBe('{}')
  })
})
