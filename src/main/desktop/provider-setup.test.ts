import { describe, expect, it, vi } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { configureProvider, configureProviderSchema } from './provider-setup'
const fixture = fileURLToPath(new URL('./__fixtures__/provider-setup.cjs', import.meta.url))
const input = { name: 'fixture', protocol: 'openai' as const, baseUrl: 'https://api.example.test/v1', apiKey: 'test-credential-only' }
function launch(mode = 'success') {
  let child: ChildProcessWithoutNullStreams | undefined
  const spawnNative = vi.fn((_binary: string, args: string[], options: SpawnOptionsWithoutStdio) => {
    child = spawn(process.execPath, [fixture, ...args], { ...options, env: { ...options.env, REI_SETUP_FIXTURE: mode }, stdio: ['pipe', 'pipe', 'pipe'] })
    return child
  })
  return { spawnNative, get child() { return child } }
}
describe('canonical native provider configuration', () => {
  it('sends exactly four answers over stdin, never through argv or environment', async () => {
    const { spawnNative } = launch()
    expect(await configureProvider('/approved/bingo', process.cwd(), input, { spawnNative })).toBeUndefined()
    const [binary, args, options] = spawnNative.mock.calls[0]
    expect(binary).toBe('/approved/bingo')
    expect(args).toEqual(['provider', 'add', '--cwd', process.cwd()])
    expect(JSON.stringify({ args, options })).not.toContain(input.apiKey)
    expect(options.shell).toBe(false)
  })
  it('never includes native diagnostics or keys in errors', async () => {
    const { spawnNative } = launch('failure')
    const error = await configureProvider('/approved/bingo', process.cwd(), input, { spawnNative }).catch((error) => error)
    expect(error.code).toBe('PROVIDER_SETUP_FAILED')
    expect(error.message).not.toContain(input.apiKey)
    expect(error.message).not.toContain('Should never surface')
  })
  it('bounds native output and stops the process', async () => {
    const setup = launch('overflow')
    await expect(configureProvider('/approved/bingo', process.cwd(), input, { spawnNative: setup.spawnNative })).rejects.toMatchObject({ code: 'PROVIDER_SETUP_OUTPUT_LIMIT' })
    expect(setup.child?.exitCode !== null || setup.child?.signalCode !== null).toBe(true)
  })
  it('times out and reaps a process that never completes', async () => {
    const setup = launch('hang')
    await expect(configureProvider('/approved/bingo', process.cwd(), input, { spawnNative: setup.spawnNative, timeout: 1000 })).rejects.toMatchObject({ code: 'PROVIDER_SETUP_TIMEOUT' })
    expect(setup.child?.exitCode !== null || setup.child?.signalCode !== null).toBe(true)
  })
  it('rejects newline injection and embedded URL credentials before launching', async () => {
    const { spawnNative } = launch()
    for (const patch of [{ name: 'a\nb' }, { protocol: 'anthropic\nopenai' }, { baseUrl: 'https://api.example.test\nkey' }, { apiKey: 'key\nextra' }, { apiKey: 'key\r' }, { apiKey: 'key\0' }, { baseUrl: 'https://user:key@example.com' }, { baseUrl: 'https://example.com?key=secret' }]) {
      await expect(configureProvider('/approved/bingo', process.cwd(), { ...input, ...patch } as typeof input, { spawnNative })).rejects.toMatchObject({ code: 'INVALID_PROVIDER' })
    }
    expect(spawnNative).not.toHaveBeenCalled()
  })
  it('permits canonical optional endpoint/key without weakening line bounds', () => {
    expect(configureProviderSchema.safeParse({ name: 'new-provider', protocol: 'anthropic', baseUrl: '', apiKey: '' }).success).toBe(true)
    expect(configureProviderSchema.safeParse({ ...input, apiKey: 'x'.repeat(16 * 1024 + 1) }).success).toBe(false)
    expect(configureProviderSchema.safeParse({ ...input, args: ['anything'] }).success).toBe(false)
  })
})
