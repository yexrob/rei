import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { z } from 'zod'
import type { ConfigureProviderInput } from '../../shared/desktop'
import { DesktopFailure } from './rpc-client'

const line = z.string().max(16 * 1024).refine((value) => !/[\x00-\x1f\x7f]/.test(value) && value === value.trim(), 'Use one line without surrounding whitespace')
export const configureProviderSchema = z.strictObject({
  name: z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  protocol: z.enum(['openai', 'anthropic']),
  baseUrl: line.max(4096).refine((value) => {
    if (!value) return true
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash } catch { return false }
  }, 'Use a web base URL without credentials, query strings, or fragments'),
  apiKey: line
})

type SpawnNative = (binary: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams
/** The canonical CLI owns both config and credential writes. Nothing is journaled. */
export async function configureProvider(binary: string, cwd: string, input: ConfigureProviderInput, options: { spawnNative?: SpawnNative; timeout?: number } = {}): Promise<void> {
  const parsed = configureProviderSchema.safeParse(input)
  if (!parsed.success) throw new DesktopFailure('INVALID_PROVIDER', 'Use a simple provider name and single-line values. The endpoint must be an HTTP(S) base URL without embedded credentials or query parameters.')
  const value = parsed.data
  const payload = Buffer.from([value.name, value.protocol, value.baseUrl, value.apiKey, ''].join('\n'), 'utf8')
  const launch: SpawnNative = options.spawnNative ?? ((binary, args, options) => spawn(binary, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] }))
  try {
    await new Promise<void>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams
      try { child = launch(binary, ['provider', 'add', '--cwd', cwd], { cwd, env: process.env, shell: false, windowsHide: true }) }
      catch { reject(new DesktopFailure('PROVIDER_SETUP_FAILED', 'The native provider setup could not be started.')); return }
      let settled = false
      let bytes = 0
      let forceTimer: ReturnType<typeof setTimeout> | undefined
      let terminationError: DesktopFailure | undefined
      const finish = (error?: DesktopFailure) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error); else resolve()
      }
      const terminate = (error: DesktopFailure) => {
        if (terminationError || settled) return
        terminationError = error
        clearTimeout(timer)
        child.kill()
        forceTimer = setTimeout(() => child.kill('SIGKILL'), 500)
      }
      const timer = setTimeout(() => terminate(new DesktopFailure('PROVIDER_SETUP_TIMEOUT', 'Provider setup timed out. It may have partially saved; reconnect and inspect providers before trying again.')), options.timeout ?? 30_000)
      const discard = (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 64 * 1024 && !settled) terminate(new DesktopFailure('PROVIDER_SETUP_OUTPUT_LIMIT', 'Provider setup returned excessive output. Reconnect and inspect providers before trying again.'))
      }
      child.stdout.on('data', discard)
      child.stderr.on('data', discard)
      child.on('error', () => finish(new DesktopFailure('PROVIDER_SETUP_FAILED', 'The native provider setup could not be started.')))
      child.stdin.on('error', () => terminate(new DesktopFailure('PROVIDER_SETUP_FAILED', 'The provider setup input closed before completion. Reconnect and inspect providers before trying again.')))
      child.on('close', (code) => {
        if (forceTimer) clearTimeout(forceTimer)
        finish(terminationError ?? (code === 0 ? undefined : new DesktopFailure('PROVIDER_SETUP_FAILED', 'bingo could not add this provider. Its name may already exist, or settings may not be writable plain JSON. No diagnostics or credentials were exposed; inspect provider setup in a terminal before retrying.')))
      })
      child.stdin.end(payload, () => payload.fill(0))
    })
  } finally { payload.fill(0) }
}
