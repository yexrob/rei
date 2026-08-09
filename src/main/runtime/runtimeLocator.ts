import { access, realpath } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { constants } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import type { GuiError, Result, RuntimeInfo } from '../../shared/contracts/ipc'

const PROBE_TIMEOUT_MS = 10_000
const VERSION_PATTERN = /^bingo\s+(.+)$/m

type LocateOptions = {
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export class RuntimeLocator {
  constructor(private readonly options: LocateOptions = {}) {}

  async probe(workspacePath: string): Promise<Result<RuntimeInfo>> {
    const env = this.options.env ?? process.env
    const binary = await this.resolveBinary(env)
    if (!binary.ok) return binary

    const workspace = await this.resolveWorkspace(workspacePath)
    if (!workspace.ok) return workspace

    const version = await this.readVersion(binary.value, env)
    if (!version.ok) return version

    const protocol = await this.probeProtocol(binary.value, workspace.value, env)
    if (!protocol.ok) {
      return {
        ok: false,
        error: {
          ...protocol.error,
          msg: `${protocol.error.msg} Binary: ${binary.value}. Version: ${version.value}.`
        }
      }
    }

    return {
      ok: true,
      value: {
        binaryPath: binary.value,
        bingoVersion: version.value,
        protocolVersion: 1,
        workspacePath: workspace.value
      }
    }
  }

  private async resolveBinary(env: NodeJS.ProcessEnv): Promise<Result<string>> {
    const override = env.BINGO_GUI_BINARY
    if (override) {
      if (!isAbsolute(override)) {
        return this.error('BINGO_NOT_FOUND', `BINGO_GUI_BINARY must be an absolute path: ${override}`)
      }
      return this.executablePath(override)
    }

    for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
      const candidate = join(directory, 'bingo')
      try {
        await access(candidate, constants.X_OK)
        return { ok: true, value: await realpath(candidate) }
      } catch {
        continue
      }
    }

    return this.error('BINGO_NOT_FOUND', 'bingo was not found on PATH. Install bingo, update PATH, then retry.')
  }

  private async executablePath(path: string): Promise<Result<string>> {
    try {
      await access(path, constants.X_OK)
      return { ok: true, value: await realpath(path) }
    } catch {
      return this.error('BINGO_NOT_FOUND', `The configured bingo binary is missing or not executable: ${path}`)
    }
  }

  private async resolveWorkspace(path: string): Promise<Result<string>> {
    if (!isAbsolute(path)) return this.error('BAD_ARGUMENT', `Workspace path must be absolute: ${path}`)
    try {
      return { ok: true, value: await realpath(path) }
    } catch {
      return this.error('BAD_ARGUMENT', `Workspace is unavailable: ${path}`)
    }
  }

  private readVersion(binary: string, env: NodeJS.ProcessEnv): Promise<Result<string>> {
    return new Promise((resolve) => {
      execFile(binary, ['--version'], { env, timeout: this.options.timeoutMs ?? PROBE_TIMEOUT_MS }, (error, stdout) => {
        if (error) {
          resolve(this.error('BINGO_PROBE_FAILED', `Could not read the bingo version. Check the binary and retry.`))
          return
        }
        const match = VERSION_PATTERN.exec(stdout.trim())
        resolve(match ? { ok: true, value: match[1] } : this.error('BINGO_PROBE_FAILED', 'bingo returned an invalid version. Check the binary and retry.'))
      })
    })
  }

  private probeProtocol(binary: string, cwd: string, env: NodeJS.ProcessEnv): Promise<Result<1>> {
    return new Promise((resolve) => {
      const child = spawn(binary, ['--json-events'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let settled = false
      let timer: NodeJS.Timeout

      const finish = (result: Result<1>): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (!child.killed) child.kill()
        resolve(result)
      }

      const inspect = (): void => {
        const line = stdout.split('\n')[0]
        if (!line) return
        try {
          const event = JSON.parse(line) as { protocolVersion?: unknown; seq?: unknown; type?: unknown }
          if (event.protocolVersion === 1 && event.seq === 1 && event.type === 'session.ready') {
            finish({ ok: true, value: 1 })
            return
          }
        } catch {
          // handled as unsupported below
        }
        finish(this.error('BINGO_PROTOCOL_UNSUPPORTED', 'This bingo version does not support GUI protocol v1. Install a compatible bingo build, then retry.'))
      }

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        inspect()
      })
      child.on('error', () => finish(this.error('BINGO_PROBE_FAILED', 'Could not start bingo. Check the binary and retry.')))
      child.on('exit', () => finish(this.error('BINGO_PROTOCOL_UNSUPPORTED', 'This bingo version does not support GUI protocol v1. Install a compatible bingo build, then retry.')))

      timer = setTimeout(
        () => finish(this.error('BINGO_PROBE_TIMEOUT', 'bingo did not respond within 10 seconds. Check the binary and retry.')),
        this.options.timeoutMs ?? PROBE_TIMEOUT_MS
      )
    })
  }

  private error<T>(code: string, msg: string): Result<T> {
    return { ok: false, error: { code, msg, level: 'flow', recoverable: true, action: 'retry' } }
  }
}
