import { execFile } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { lstat, open, readlink } from 'node:fs/promises'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ReviewFile, ReviewScope, ReviewSnapshot } from '../../../shared/review'
import { DesktopFailure } from '../rpc-client'

const execute = promisify(execFile)
const maxOutput = 2 * 1024 * 1024
const maxPatch = 256 * 1024
const maxFiles = 50
const maxLines = 3000

/** Absolute git from absolute PATH entries only, so a workspace-local git(.exe) is never executed. */
export function findGit(pathValue = process.env.PATH ?? '', platform: NodeJS.Platform = process.platform, cwd = process.cwd()): string | null {
  for (const entry of pathValue.split(platform === 'win32' ? ';' : delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1')
    if (!directory || !isAbsolute(directory) || resolve(directory) === resolve(cwd)) continue
    const candidate = join(directory, platform === 'win32' ? 'git.exe' : 'git')
    try {
      if (!statSync(candidate).isFile()) continue
      if (platform !== 'win32') accessSync(candidate, constants.X_OK)
      return candidate
    } catch { /* Try the next PATH entry. */ }
  }
  return null
}
let resolvedGit: string | null = null
function gitExecutable(): string {
  resolvedGit ??= findGit()
  if (!resolvedGit) throw new DesktopFailure('GIT_NOT_FOUND', 'Git was not found on PATH. Install Git, then refresh the review.')
  return resolvedGit
}
function environment(): NodeJS.ProcessEnv {
  // Inherited Git overrides must not redirect a review into another index/repository.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
}
async function git(cwd: string, args: string[], signal: AbortSignal, maxBuffer = maxOutput): Promise<string> {
  const result = await execute(gitExecutable(), ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args], {
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
async function patches(cwd: string, args: string[], files: ReviewFile[], signal: AbortSignal): Promise<number> {
  let bytes = 0
  for (const file of files) {
    if (file.binary) continue
    if (bytes >= maxOutput) { file.truncated = true; continue }
    try {
      file.patch = await git(cwd, [...args, '--patch', '--unified=3', '--', file.path], signal, Math.min(maxPatch, maxOutput - bytes))
      bytes += Buffer.byteLength(file.patch)
      if (file.patch.split('\n').length > maxLines) { file.patch = null; file.truncated = true }
    } catch (error) {
      if ((error as { code?: string }).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error
      file.truncated = true
    }
  }
  return bytes
}
/** Synthesizes a bounded `new file` patch for one untracked path without following symlinks. */
async function newFile(cwd: string, file: ReviewFile, bytes: number, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted()
  const path = join(cwd, file.path), info = await lstat(path).catch(() => null)
  const unread = (): number => { Object.assign(file, { additions: null, deletions: null, truncated: true }); return bytes }
  if (!info || !info.isFile() && !info.isSymbolicLink()) return unread()
  let content: Buffer
  if (info.isSymbolicLink()) content = Buffer.from(await readlink(path))
  else if (info.size > maxOutput) return unread()
  else {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(info.size)
      let length = 0
      while (length < buffer.length) { const read = await handle.read(buffer, length, buffer.length - length, null); if (!read.bytesRead) break; length += read.bytesRead }
      content = buffer.subarray(0, length)
    } finally { await handle.close() }
  }
  if (content.subarray(0, 8000).includes(0)) { Object.assign(file, { binary: true, additions: null, deletions: null }); return bytes }
  const text = content.toString('utf8'), terminated = text.endsWith('\n'), lines = text.length ? text.split('\n') : []
  if (terminated) lines.pop()
  file.additions = lines.length
  const mode = info.isSymbolicLink() ? '120000' : info.mode & 0o111 ? '100755' : '100644'
  const header = `diff --git a/${file.path} b/${file.path}\nnew file mode ${mode}\n`
  if (bytes >= maxOutput) { file.truncated = true; return bytes }
  if (!lines.length) { file.patch = header; return bytes + Buffer.byteLength(header) }
  const patch = `${header}--- /dev/null\n+++ b/${file.path}\n@@ -0,0 +1${lines.length === 1 ? '' : `,${lines.length}`} @@\n${lines.map(line => `+${line}\n`).join('')}${terminated ? '' : '\\ No newline at end of file\n'}`
  if (lines.length > maxLines || Buffer.byteLength(patch) > Math.min(maxPatch, maxOutput - bytes)) { file.truncated = true; return bytes }
  file.patch = patch
  return bytes + Buffer.byteLength(patch)
}
export async function readReview(cwd: string | null, scope: ReviewScope, abort?: AbortSignal): Promise<ReviewSnapshot> {
  if (!cwd) return empty(scope, 'no-workspace')
  const deadline = AbortSignal.timeout(10_000)
  const signal = abort ? AbortSignal.any([abort, deadline]) : deadline
  if (!(await repository(cwd, signal))) return empty(scope, 'not-repository')
  const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--submodule=short', '--relative', ...(scope === 'staged' ? ['--cached'] : [])]
  const tracked = parseStats(await git(cwd, [...args, '--numstat', '-z', '--', '.'], signal))
  // `git diff` ignores untracked files; the working-tree review lists them as new files.
  // Only the visible (first maxFiles) untracked files are read, so totals may exclude hidden ones.
  const untracked = scope === 'unstaged' ? (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.'], signal)).split('\0').filter(Boolean) : []
  const all = [...tracked, ...untracked.map((path): ReviewFile => ({ path, additions: 0, deletions: 0, binary: false, patch: null, truncated: false }))].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const files = all.slice(0, maxFiles), added = new Set(untracked)
  let bytes = await patches(cwd, args, files.filter(file => !added.has(file.path)), signal)
  for (const file of files) if (added.has(file.path)) bytes = await newFile(cwd, file, bytes, signal)
  return {
    scope, status: 'ready', files, totalFiles: all.length,
    additions: all.reduce((sum, file) => sum + (file.additions ?? 0), 0),
    deletions: all.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
    truncated: files.length < all.length || files.some((file) => file.truncated)
  }
}
