import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SettingsRepository } from './settingsRepository'

describe('SettingsRepository runtime update', () => {
  it('preserves unknown keys while atomically updating runtime fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bingo-gui-settings-'))
    const path = join(directory, 'settings.json')
    await writeFile(path, JSON.stringify({ unknown: { keep: true }, provider: 'old', model: 'old-model' }))

    await new SettingsRepository(path).saveRuntime({ provider: 'opencode-go', model: 'gpt-5.6-luna', thinkingLevel: 'high' })

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      unknown: { keep: true },
      provider: 'opencode-go',
      model: 'gpt-5.6-luna',
      thinkingLevel: 'high'
    })
  })

  it('does not overwrite invalid settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bingo-gui-settings-'))
    const path = join(directory, 'settings.json')
    await writeFile(path, '{invalid')
    await expect(new SettingsRepository(path).saveRuntime({ provider: 'default', model: 'model', thinkingLevel: 'off' })).rejects.toThrow('Cannot update')
    expect(await readFile(path, 'utf8')).toBe('{invalid')
  })
})
