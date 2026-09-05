import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ScratchWorkspace } from './scratchWorkspace'

let directory: string
beforeEach(async () => { directory = await realpath(await mkdtemp(join(tmpdir(), 'rei-scratch-test-'))) })
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }) })
const unsafe = { code: 'UNSAFE_SCRATCH_WORKSPACE' }

describe('private temporary workspace', () => {
  it('uses a stable private child per desktop profile, preserving files across relaunches', async () => {
    const profile = join(directory, 'profile')
    const scratch = await ScratchWorkspace.create(directory, profile)
    expect(dirname(scratch.path)).toBe(directory)
    expect(scratch.path).not.toBe(directory)
    if (process.getuid) {
      const stat = await lstat(scratch.path)
      expect(stat.uid).toBe(process.getuid())
      expect(stat.mode & 0o777).toBe(0o700)
    }
    await writeFile(join(scratch.path, 'notes.txt'), 'keep this user file')
    const relaunched = await ScratchWorkspace.create(directory, profile)
    expect(relaunched.path).toBe(scratch.path)
    expect(await readFile(join(relaunched.path, 'notes.txt'), 'utf8')).toBe('keep this user file')
    expect((await ScratchWorkspace.create(directory, join(directory, 'other-profile'))).path).not.toBe(scratch.path)
  })
  it('allows concurrent native creation of the same private workspace', async () => {
    const workspaces = await Promise.all([ScratchWorkspace.create(directory, directory), ScratchWorkspace.create(directory, directory)])
    expect(workspaces[0].path).toBe(workspaces[1].path)
    expect((await lstat(workspaces[0].path)).isDirectory()).toBe(true)
  })
  it('recreates a removed leaf at exactly the same cwd', async () => {
    const scratch = await ScratchWorkspace.create(directory, directory)
    await rm(scratch.path, { recursive: true })
    expect(await scratch.ensure()).toBe(scratch.path)
    expect((await lstat(scratch.path)).isDirectory()).toBe(true)
  })
  it('refuses regular files without deleting or overwriting them', async () => {
    const scratch = await ScratchWorkspace.create(directory, directory)
    await rm(scratch.path, { recursive: true })
    await writeFile(scratch.path, 'do not replace')
    await expect(scratch.ensure()).rejects.toMatchObject(unsafe)
    await expect(ScratchWorkspace.create(directory, directory)).rejects.toMatchObject(unsafe)
    expect(await readFile(scratch.path, 'utf8')).toBe('do not replace')
  })
  it('refuses planted symlinks or junctions and never follows them to an external workspace', async () => {
    const scratch = await ScratchWorkspace.create(directory, directory)
    const target = join(directory, 'external')
    await mkdir(target)
    await writeFile(join(target, 'untouched.txt'), 'not our workspace')
    await rm(scratch.path, { recursive: true })
    await symlink(target, scratch.path, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(scratch.ensure()).rejects.toMatchObject(unsafe)
    await expect(ScratchWorkspace.create(directory, directory)).rejects.toMatchObject(unsafe)
    expect((await lstat(scratch.path)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(target, 'untouched.txt'), 'utf8')).toBe('not our workspace')
  })
  it('refuses a temp ancestor replaced with a symlink or junction', async () => {
    const temp = join(directory, 'temp')
    const target = join(directory, 'external')
    await mkdir(temp)
    await mkdir(target)
    const scratch = await ScratchWorkspace.create(temp, directory)
    await rm(temp, { recursive: true })
    await symlink(target, temp, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(scratch.ensure()).rejects.toMatchObject(unsafe)
    await expect(lstat(join(target, scratch.path.split(/[\\/]/).at(-1)!))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.skipIf(!process.getuid)('refuses group/world-accessible scratch without silently changing its permissions', async () => {
    const scratch = await ScratchWorkspace.create(directory, directory)
    await chmod(scratch.path, 0o755)
    await expect(scratch.ensure()).rejects.toMatchObject(unsafe)
    expect((await lstat(scratch.path)).mode & 0o777).toBe(0o755)
  })
  it.skipIf(!process.getuid)('refuses writable non-sticky temp ancestors', async () => {
    const temp = join(directory, 'insecure-temp')
    await mkdir(temp)
    await chmod(temp, 0o777)
    await expect(ScratchWorkspace.create(temp, directory)).rejects.toMatchObject(unsafe)
  })
  it.skipIf(!process.getuid || process.getuid() === 0)('refuses ownership changes instead of trusting a predictable path', async () => {
    const scratch = await ScratchWorkspace.create(directory, directory)
    vi.spyOn(process, 'getuid').mockReturnValue(process.getuid!() + 1)
    await expect(scratch.ensure()).rejects.toMatchObject(unsafe)
  })
  it('rejects relative native roots and profile identities', async () => {
    await expect(ScratchWorkspace.create('.', directory)).rejects.toMatchObject(unsafe)
    await expect(ScratchWorkspace.create(directory, '.')).rejects.toMatchObject(unsafe)
  })
})
