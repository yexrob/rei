import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ReviewFile, ReviewScope, ReviewSnapshot } from '../../../shared/review'
import { DesktopFailure } from '../rpc-client'

const execute = promisify(execFile)
const maxOutput = 2 * 1024 * 1024
const maxPatch = 256 * 1024
const maxFiles = 50

function environment(): NodeJS.ProcessEnv {
  // Inherited Git overrides must not redirect a review into another index/repository.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
}
async function git(cwd: string, args: string[], signal: AbortSignal, maxBuffer = maxOutput): Promise<string> {
  const result = await execute('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args], {
    cwd, env: environment(), encoding: 'utf8', timeout: 10_000, maxBuffer, windowsHide: true, signal
  })
  return result.stdout
}
function empty(scope: ReviewScope, status: ReviewSnapshot['status']): ReviewSnapshot {
  return { scope, status, files: [], totalFiles: 0, additions: 0, deletions: 0, truncated: false }
}
function parseStats(output: string): ReviewFile[] {
  return output.split('\0').filter(Boolean).map((record) => {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record)
    if (!match) throw new DesktopFailure('REVIEW_ERROR', 'Git returned an unsupported change summary.')
    const binary = match[1] === '-' || match[2] === '-'
    return { path: match[3], additions: binary ? null : Number(match[1]), deletions: binary ? null : Number(match[2]), binary, patch: null, truncated: false }
  })
}
async function repository(cwd: string, signal: AbortSignal): Promise<boolean> {
  try { return (await git(cwd, ['rev-parse', '--is-inside-work-tree'], signal)).trim() === 'true' }
  catch (error) {
    if (String((error as { stderr?: string }).stderr).includes('not a git repository')) return false
    throw error
  }
}
async function patches(cwd: string, args: string[], files: ReviewFile[], signal: AbortSignal): Promise<void> {
  let bytes = 0
  for (const file of files) {
    if (file.binary) continue
    if (bytes >= maxOutput) { file.truncated = true; continue }
    try {
      file.patch = await git(cwd, [...args, '--patch', '--unified=3', '--', file.path], signal, Math.min(maxPatch, maxOutput - bytes))
      bytes += Buffer.byteLength(file.patch)
      if (file.patch.split('\n').length > 3000) { file.patch = null; file.truncated = true }
    } catch (error) {
      if ((error as { code?: string }).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error
      file.truncated = true
    }
  }
}
export async function readReview(cwd: string | null, scope: ReviewScope, abort?: AbortSignal): Promise<ReviewSnapshot> {
  if (!cwd) return empty(scope, 'no-workspace')
  const deadline = AbortSignal.timeout(10_000)
  const signal = abort ? AbortSignal.any([abort, deadline]) : deadline
  if (!(await repository(cwd, signal))) return empty(scope, 'not-repository')
  const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--submodule=short', '--relative', ...(scope === 'staged' ? ['--cached'] : [])]
  const all = parseStats(await git(cwd, [...args, '--numstat', '-z', '--', '.'], signal))
  const files = all.slice(0, maxFiles)
  await patches(cwd, args, files, signal)
  return {
    scope, status: 'ready', files, totalFiles: all.length,
    additions: all.reduce((sum, file) => sum + (file.additions ?? 0), 0),
    deletions: all.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
    truncated: files.length < all.length || files.some((file) => file.truncated)
  }
}
