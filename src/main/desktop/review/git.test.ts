import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { readReview } from './git'

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
  await writeFile(join(root, 'untracked.txt'), 'not included\n')
  const before = await readFile(join(root, '.git/index'))
  const staged = await readReview(root, 'staged')
  const unstaged = await readReview(root, 'unstaged')
  expect(staged).toMatchObject({ status: 'ready', scope: 'staged', files: [{ path: 'example.txt', additions: 1, deletions: 1, binary: false }] })
  expect(staged.files[0].patch).toContain('+staged')
  expect(unstaged.files[0].patch).toContain('+working')
  expect(unstaged.files).toHaveLength(1)
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
