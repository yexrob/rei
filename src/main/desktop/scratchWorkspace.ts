import { createHash } from 'node:crypto'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { DesktopFailure } from './rpc-client'

function unsafe(): DesktopFailure {
  return new DesktopFailure('UNSAFE_SCRATCH_WORKSPACE', 'Personal space is unavailable or unsafe. Check the desktop temporary directory ownership and permissions; no files were removed.')
}

/** A stable, private cwd, not a project preference. Never cleans up user files. */
export class ScratchWorkspace {
  private constructor(readonly path: string) {}

  static async create(tempDirectory: string, applicationDirectory: string): Promise<ScratchWorkspace> {
    if (!isAbsolute(tempDirectory) || !isAbsolute(applicationDirectory)) throw unsafe()
    const root = await realpath(tempDirectory)
    // App-data identity separates installations/profiles without persisting another preference.
    const identity = createHash('sha256').update(`${process.getuid?.() ?? ''}\0${resolve(applicationDirectory)}`).digest('hex').slice(0, 24)
    const scratch = new ScratchWorkspace(join(root, `bingo-desktop-${identity}`))
    await scratch.ensure()
    return scratch
  }

  async ensure(): Promise<string> {
    try {
      await trustedParents(dirname(this.path))
      try { await mkdir(this.path, { mode: 0o700 }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      const before = await lstat(this.path)
      if (!before.isDirectory() || before.isSymbolicLink()) throw unsafe()
      const uid = process.getuid?.()
      if (uid !== undefined && (before.uid !== uid || (before.mode & 0o077) !== 0)) throw unsafe()
      // lstat rejects symlinks/junctions; realpath also catches other redirection.
      if (await realpath(this.path) !== this.path) throw unsafe()
      const after = await lstat(this.path)
      if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode || before.uid !== after.uid) throw unsafe()
      return this.path
    } catch { throw unsafe() }
  }
}

async function trustedParents(directory: string): Promise<void> {
  const uid = process.getuid?.()
  for (let path = directory; ; path = dirname(path)) {
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw unsafe()
    if (uid !== undefined) {
      // Shared system temp is safe only with sticky-bit unlink protection. A
      // foreign-owned ancestor could replace the directory even when it is 0700.
      if (stat.uid !== uid && stat.uid !== 0) throw unsafe()
      if ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0) throw unsafe()
    }
    // Windows has no POSIX uid/mode check; it uses the native per-user temp ACL.
    if (dirname(path) === path) return
  }
}
