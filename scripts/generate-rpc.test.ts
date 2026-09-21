// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const roots: string[] = []
const outputs = ['src/shared/rpc.ts', 'src/main/desktop/rpc-validation.ts']
const schema = JSON.stringify({
  protocol: 1,
  $defs: { EventParams: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  methods: { ping: { params: { type: 'object' }, result: { type: 'string' } } },
  notifications: { event: { params: { $ref: '#/$defs/EventParams' } } }
}, null, 2) + '\n'

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rei-rpc-generation-'))
  roots.push(root)
  await mkdir(join(root, 'scripts'))
  const script = join(root, 'scripts/generate-rpc.mjs'), input = join(root, 'rpc.json')
  await copyFile(new URL('./generate-rpc.mjs', import.meta.url), script)
  await writeFile(input, schema)
  const run = (...args: string[]) => execFileSync(process.execPath, [script, input, ...args], { encoding: 'utf8', stdio: 'pipe' })
  const bindings = () => Promise.all(outputs.map(path => readFile(join(root, path), 'utf8')))
  run()
  return { root, input, run, bindings }
}

describe('canonical protocol generation across checkout line endings', () => {
  it('generates identical LF output and schema digests from LF and CRLF schemas', async () => {
    const { input, run, bindings } = await fixture()
    const baseline = await bindings()
    expect(baseline.every(content => content.includes(createHash('sha256').update(schema).digest('hex')))).toBe(true)
    await writeFile(input, schema.replaceAll('\n', '\r\n'))
    run()
    expect(await bindings()).toEqual(baseline)
    expect((await bindings()).every(content => !content.includes('\r'))).toBe(true)
  })

  it.each([['LF', 'LF'], ['LF', 'CRLF'], ['CRLF', 'LF'], ['CRLF', 'CRLF']])('checks %s schemas against %s generated files', async (inputEol, outputEol) => {
    const { root, input, run, bindings } = await fixture()
    if (inputEol === 'CRLF') await writeFile(input, schema.replaceAll('\n', '\r\n'))
    if (outputEol === 'CRLF') {
      const contents = await bindings()
      await Promise.all(outputs.map((path, index) => writeFile(join(root, path), contents[index].replaceAll('\n', '\r\n'))))
    }
    expect(run('--check')).toContain('RPC bindings match canonical schema.')
  })

  it.each(outputs)('still rejects stale %s with CRLF line endings', async path => {
    const { root, run } = await fixture()
    const file = join(root, path)
    await writeFile(file, (await readFile(file, 'utf8')).replaceAll('\n', '\r\n') + '// stale binding\r\n')
    expect(() => run('--check')).toThrow(/differs from canonical schema/)
  })

  it('still rejects a changed schema with CRLF line endings', async () => {
    const { input, run } = await fixture()
    await writeFile(input, schema.replace('"protocol": 1', '"protocol": 2').replaceAll('\n', '\r\n'))
    expect(() => run('--check')).toThrow(/differs from canonical schema/)
  })
})
