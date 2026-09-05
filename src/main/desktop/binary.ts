import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { DesktopFailure } from './rpc-client'

export type BinaryLocation = { path: string | null; source: string }
type DiscoveryOptions = { appPath: string; resourcesPath: string; packaged: boolean; preference: string | null; env?: NodeJS.ProcessEnv }
export async function executable(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new DesktopFailure('INVALID_BINARY', 'Choose an absolute native executable path.')
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isFile()) throw new DesktopFailure('INVALID_BINARY', 'The selected binary is not a file.')
  if (process.platform === 'win32' && !canonical.toLowerCase().endsWith('.exe')) throw new DesktopFailure('INVALID_BINARY', 'Choose a native .exe binary, not a shell script.')
  await access(canonical, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
  return canonical
}
export async function workspaceDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new DesktopFailure('INVALID_WORKSPACE', 'Choose an absolute workspace directory.')
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isDirectory()) throw new DesktopFailure('INVALID_WORKSPACE', 'The workspace is not a directory.')
  return canonical
}
export async function discoverBinary(options: DiscoveryOptions): Promise<BinaryLocation> {
  const env = options.env ?? process.env
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const explicit = env.BINGO_GUI_BINARY ?? options.preference
  if (explicit) {
    try { return { path: await executable(explicit), source: env.BINGO_GUI_BINARY ? 'environment' : 'preferences' } }
    catch { return { path: null, source: env.BINGO_GUI_BINARY ? 'invalid environment override' : 'unavailable saved binary' } }
  }
  const candidates: Array<[string, string]> = [
    [join(options.resourcesPath, 'bin', `bingo${suffix}`), 'bundled'],
    [join(options.resourcesPath, 'bingo', `bingo${suffix}`), 'bundled']
  ]
  if (!options.packaged) {
    for (const base of [options.appPath, process.cwd()]) {
      for (const profile of ['debug', 'release']) candidates.push([resolve(base, '..', 'bingo-improve', 'target', profile, `bingo${suffix}`), 'development'])
    }
  }
  const directories = [...(env.PATH ?? '').split(delimiter), join(homedir(), '.cargo', 'bin'), join(homedir(), '.local', 'bin')]
  if (process.platform !== 'win32') directories.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin')
  for (const directory of directories) if (isAbsolute(directory)) candidates.push([join(directory, `bingo${suffix}`), 'PATH'])
  for (const [candidate, source] of candidates) {
    try { return { path: await executable(candidate), source } } catch { /* Try the next native location. */ }
  }
  return { path: null, source: 'not found' }
}
