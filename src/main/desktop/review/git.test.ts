import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { findGit, readReview } from './git'

const roots: string[] = []
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rei-review-'))
  roots.push(root)
  git(root, 'init', '--template=', '-q')
  git(root, 'config', 'user.name', 'Review fixture')
  git(root, 'config', 'user.email', 'review@example.invalid')
  return root
}
function git(root: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '' } })
}
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

it('separates staged and unstaged tracked patches without writing the index or working tree', async () => {
  const root = await fixture()
  await writeFile(join(root, 'example.txt'), 'original\n')
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture')
  await writeFile(join(root, 'example.txt'), 'staged\n'); git(root, 'add', '.')
  await writeFile(join(root, 'example.txt'), 'working\n')
  await writeFile(join(root, 'untracked.txt'), 'only unstaged\n')
  const before = await readFile(join(root, '.git/index'))
  const staged = await readReview(root, 'staged')
  const unstaged = await readReview(root, 'unstaged')
  expect(staged).toMatchObject({ status: 'ready', scope: 'staged', files: [{ path: 'example.txt', additions: 1, deletions: 1, binary: false }] })
  expect(staged.files[0].patch).toContain('+staged')
  expect(unstaged.files[0].patch).toContain('+working')
  expect(staged.files).toHaveLength(1)
  expect(unstaged.files.map(file => file.path)).toEqual(['example.txt', 'untracked.txt'])
  expect(await readFile(join(root, '.git/index'))).toEqual(before)
  expect(await readFile(join(root, 'example.txt'), 'utf8')).toBe('working\n')
})

// Windows forbids control characters in filenames; spaces and Unicode exercise its parser boundary.
it.each(['space café 名字.txt', ...(process.platform === 'win32' ? [] : ['tab\tname\n.txt'])])('supports unborn repositories, binary files and subdirectory boundaries with %j', async (filename) => {
  const root = await fixture()
  await mkdir(join(root, 'inside'))
  await writeFile(join(root, 'outside.txt'), 'outside\n')
  await writeFile(join(root, 'inside', filename), 'inside\n')
  await writeFile(join(root, 'inside', 'binary.dat'), Buffer.from([0, 1, 2]))
  git(root, 'add', '.')
  const result = await readReview(join(root, 'inside'), 'staged')
  expect(result.status).toBe('ready')
  expect(result.files.map((file) => file.path)).toEqual(['binary.dat', filename])
  expect(result.files[0]).toMatchObject({ binary: true, additions: null, deletions: null })
  expect(result.files[1].patch).toContain('+inside')
})

it('returns distinct no-workspace, non-repository and empty states', async () => {
  expect(await readReview(null, 'unstaged')).toMatchObject({ status: 'no-workspace', files: [] })
  const root = await fixture()
  expect(await readReview(root, 'unstaged')).toMatchObject({ status: 'ready', files: [] })
  const plain = await mkdtemp(join(tmpdir(), 'rei-review-plain-')); roots.push(plain)
  expect(await readReview(plain, 'staged')).toMatchObject({ status: 'not-repository', files: [] })
})

it('bounds large patches and file counts while preserving total change counts', async () => {
  const root = await fixture()
  for (let index = 0; index < 51; index++) await writeFile(join(root, `${String(index).padStart(2, '0')}.txt`), index === 0 ? 'x'.repeat(300_000) : 'added\n')
  git(root, 'add', '.')
  const result = await readReview(root, 'staged')
  expect(result).toMatchObject({ totalFiles: 51, additions: 51, deletions: 0, truncated: true })
  expect(result.files).toHaveLength(50)
  expect(result.files[0]).toMatchObject({ patch: null, truncated: true })
})

it('ignores inherited Git repository/index overrides', async () => {
  const root = await fixture()
  const other = await fixture()
  await writeFile(join(root, 'approved.txt'), 'approved\n'); git(root, 'add', '.')
  await writeFile(join(other, 'other.txt'), 'other\n'); git(other, 'add', '.')
  vi.stubEnv('GIT_DIR', join(other, '.git'))
  vi.stubEnv('GIT_WORK_TREE', other)
  vi.stubEnv('GIT_INDEX_FILE', join(other, '.git/index'))
  expect((await readReview(root, 'staged')).files.map((file) => file.path)).toEqual(['approved.txt'])
})

it('never invokes repository external diff or textconv programs', async () => {
  const root = await fixture()
  await writeFile(join(root, '.gitattributes'), '*.txt diff=hostile\n')
  await writeFile(join(root, 'test.txt'), 'before\n')
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture')
  git(root, 'config', 'diff.external', 'invalid-review-external-command')
  git(root, 'config', 'diff.hostile.textconv', 'invalid-review-textconv-command')
  await writeFile(join(root, 'test.txt'), 'after\n')
  expect((await readReview(root, 'unstaged')).files[0].patch).toContain('+after')
})

it('shows untracked files as bounded new-file patches in the unstaged scope only', async () => {
  const root = await fixture()
  await writeFile(join(root, '.gitignore'), 'ignored.log\n')
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture')
  await mkdir(join(root, 'dir'))
  await writeFile(join(root, 'dir', 'new.txt'), 'one\ntwo\n')
  await writeFile(join(root, 'tail.txt'), 'no newline')
  await writeFile(join(root, 'empty.txt'), '')
  await writeFile(join(root, 'blob.bin'), Buffer.from([1, 0, 2]))
  await writeFile(join(root, 'huge.txt'), 'y\n'.repeat(200_000))
  await writeFile(join(root, 'ignored.log'), 'ignored\n')
  if (process.platform !== 'win32') await symlink('/etc/passwd', join(root, 'link'))
  const result = await readReview(root, 'unstaged')
  const byPath = Object.fromEntries(result.files.map(file => [file.path, file]))
  expect(Object.keys(byPath).sort()).toEqual(['blob.bin', 'dir/new.txt', 'empty.txt', 'huge.txt', ...(process.platform === 'win32' ? [] : ['link']), 'tail.txt'])
  expect(byPath['dir/new.txt']).toMatchObject({ additions: 2, deletions: 0, binary: false, truncated: false, patch: 'diff --git a/dir/new.txt b/dir/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/dir/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n' })
  expect(byPath['tail.txt'].patch).toMatch(/@@ -0,0 \+1 @@\n\+no newline\n\\ No newline at end of file\n$/)
  expect(byPath['empty.txt']).toMatchObject({ additions: 0, patch: 'diff --git a/empty.txt b/empty.txt\nnew file mode 100644\n' })
  expect(byPath['blob.bin']).toMatchObject({ binary: true, additions: null, patch: null })
  expect(byPath['huge.txt']).toMatchObject({ additions: 200_000, patch: null, truncated: true })
  if (process.platform !== 'win32') expect(byPath.link).toMatchObject({ additions: 1, patch: expect.stringContaining('new file mode 120000') })
  if (process.platform !== 'win32') expect(byPath.link.patch).not.toContain('root:')
  expect(result).toMatchObject({ totalFiles: Object.keys(byPath).length, truncated: true })
  expect((await readReview(root, 'staged')).files).toEqual([])
})

it('resolves git only from absolute PATH entries outside the working directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rei-git-path-')); roots.push(root)
  for (const dir of ['cwd', 'bin', 'plain']) await mkdir(join(root, dir))
  const name = process.platform === 'win32' ? 'git.exe' : 'git'
  for (const dir of ['cwd', 'bin', 'plain']) await writeFile(join(root, dir, name), '')
  await chmod(join(root, 'bin', name), 0o755)
  await chmod(join(root, 'cwd', name), 0o755)
  const separator = process.platform === 'win32' ? ';' : ':'
  const path = ['', '.', 'relative/bin', join(root, 'cwd'), ...(process.platform === 'win32' ? [] : [join(root, 'plain')]), join(root, 'bin')].join(separator)
  expect(findGit(path, process.platform, join(root, 'cwd'))).toBe(join(root, 'bin', name))
  expect(findGit(['.', 'relative'].join(separator), process.platform, root)).toBeNull()
  expect(findGit(`"${join(root, 'bin')}"`, 'win32', root)).toBe(process.platform === 'win32' ? join(root, 'bin', name) : null)
})
