// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { inspectNative, validateNative, verifyProtocol, validateBundle } = require('./validate-bundle.cjs')
const { prepareBundle, bundleTarget } = require('./prepare-bundle.cjs')
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function temporary() { const root = await mkdtemp(join(tmpdir(), 'rei-bundle-')); roots.push(root); return root }
function native(platform: string, arch: string): Buffer {
  const bytes = Buffer.alloc(512)
  if (platform === 'darwin') {
    bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(arch === 'arm64' ? 0x100000c : 0x1000007, 4); bytes.writeUInt32LE(2, 12)
  } else if (platform === 'linux') {
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]); bytes.writeUInt16LE(3, 16); bytes.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18)
  } else {
    bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128); bytes.writeUInt16LE(arch === 'arm64' ? 0xaa64 : 0x8664, 132); bytes.writeUInt16LE(2, 150)
  }
  return bytes
}

describe('mandatory native runtime bundle', () => {
  it.each(['darwin', 'linux', 'win32'].flatMap(platform => ['x64', 'arm64'].map(arch => [platform, arch])))('identifies %s %s executable headers', (platform, arch) => {
    expect(inspectNative(native(platform, arch))).toEqual({ platform, arch })
  })
  it('rejects scripts, truncated binaries and Mach-O libraries', () => {
    expect(() => inspectNative(Buffer.from('#!/bin/sh\necho bingo'))).toThrow(/native executable/)
    expect(() => inspectNative(Buffer.from('MZ'))).toThrow(/native executable/)
    const library = native('darwin', 'arm64'); library.writeUInt32LE(6, 12)
    expect(() => inspectNative(library)).toThrow(/native executable/)
  })
  it('rejects a wrong architecture and missing runtime instead of using PATH', async () => {
    const root = await temporary(); const file = join(root, 'bingo')
    await writeFile(file, native('darwin', 'arm64'), { mode: 0o755 })
    await expect(validateNative(file, { platform: 'darwin', arch: 'x64' })).rejects.toThrow(/darwin\/arm64.*darwin\/x64/)
    await expect(prepareBundle({ projectDir: root, platform: process.platform, arch: process.arch, env: {} })).rejects.toThrow(/bingo-improve.*BINGO_BUNDLE_BINARY/)
  })
  it('requires an absolute explicit path, never silently falling back', async () => {
    await expect(prepareBundle({ projectDir: await temporary(), platform: process.platform, arch: process.arch, env: { BINGO_BUNDLE_BINARY: 'bingo' } })).rejects.toThrow(/absolute/)
  })
  it('builds the sibling source with a locked explicit native target by default', async () => {
    const root = await temporary(); const projectDir = join(root, 'Rei'); const source = join(root, 'bingo-improve')
    await mkdir(projectDir); await mkdir(source); await writeFile(join(source, 'Cargo.toml'), '[workspace]\n')
    const build = vi.fn(async (_command: string, args: string[]) => {
      expect(args).toContain('--locked'); expect(args).toContain('--release'); expect(args).toContain('--target'); expect(args).toContain('--target-dir')
      const target = args[args.indexOf('--target') + 1]; const file = join(source, 'target', target, 'release', process.platform === 'win32' ? 'bingo.exe' : 'bingo')
      await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, native(process.platform, process.arch), { mode: 0o755 })
    })
    const probe = vi.fn(async () => {})
    const output = await prepareBundle({ projectDir, platform: process.platform, arch: process.arch, env: {}, build, probe })
    expect(build).toHaveBeenCalledOnce(); expect(probe).toHaveBeenCalledOnce()
    expect(await readFile(output)).toEqual(native(process.platform, process.arch))
  })
  it('copies an explicitly supplied Windows runtime to bingo.exe without executing foreign code', async () => {
    const root = await temporary(); const input = join(root, 'custom.exe'); await writeFile(input, native('win32', 'arm64'), { mode: 0o755 })
    const probe = vi.fn(async () => {})
    const output = await prepareBundle({ projectDir: root, platform: 'win32', arch: 'arm64', env: { BINGO_BUNDLE_BINARY: input }, probe })
    expect(output).toBe(join(root, 'out', 'bundled-runtime', 'win-arm64', 'bingo.exe'))
    expect(await readFile(input)).toEqual(await readFile(output))
    expect(probe).toHaveBeenCalledTimes(process.platform === 'win32' && process.arch === 'arm64' ? 1 : 0)
  })
  it('refuses cross-compilation by default and unsupported universal targets', async () => {
    const arch = process.arch === 'arm64' ? 'x64' : 'arm64'
    await expect(prepareBundle({ projectDir: await temporary(), platform: process.platform, arch, env: {} })).rejects.toThrow(/BINGO_BUNDLE_BINARY/)
    expect(() => bundleTarget('darwin', 'universal')).toThrow(/Unsupported/)
  })
  it('fails post-copy verification when the runtime is absent from the artifact', async () => {
    const root = await temporary()
    await expect(validateBundle({ electronPlatformName: process.platform, arch: process.arch, appOutDir: root, packager: { getResourcesDir: () => root } })).rejects.toThrow()
  })
  it('maps builder hook architectures independently of the host', () => {
    expect(bundleTarget('win32', 1)).toMatchObject({ arch: 'x64', filename: 'bingo.exe', triple: 'x86_64-pc-windows-msvc' })
    expect(bundleTarget('darwin', 3)).toMatchObject({ arch: 'arm64', filename: 'bingo', triple: 'aarch64-apple-darwin' })
  })
  it('keeps preparation and verification mandatory on direct builder calls', () => {
    const config = require('../electron-builder.cjs')
    expect(typeof config.beforePack).toBe('function'); expect(typeof config.afterPack).toBe('function')
    expect(typeof config.afterSign).toBe('function')
    expect(config.mac).toMatchObject({ identity: '-', hardenedRuntime: true, notarize: false, strictVerify: true })
    expect(config.extraResources).toEqual([{ from: 'out/bundled-runtime/${os}-${arch}', to: 'bin' }])
  })
})

describe('isolated packaging protocol probe', () => {
  async function host(body: string) { const root = await temporary(); const path = join(root, 'host.cjs'); await writeFile(path, body); return path }
  it('initializes protocol 1, shuts down and uses a private HOME', async () => {
    const path = await host(`const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',l=>{const r=JSON.parse(l);if(r.method==='initialize')console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{name:'bingo',protocol:1,version:process.env.HOME,capabilities:{methods:['shutdown','session/open','session/submit','session/events','session/history','session/list','catalog/read']}}}));else{console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{}}));process.exit(0)}})`)
    const result = await verifyProtocol(process.execPath, { args: [path] })
    expect(result.version).not.toBe(process.env.HOME); expect(result.protocol).toBe(1)
  })
  it.each(['console.log("not json")', 'console.log(JSON.stringify({jsonrpc:"2.0",id:"initialize",result:{protocol:99,name:"bingo"}}))', 'process.exit(3)'])('rejects invalid protocol output or early exits: %s', async body => {
    await expect(verifyProtocol(process.execPath, { args: [await host(body)], timeout: 2000 })).rejects.toThrow()
  })
  it('kills a stalled runtime on timeout and waits for exit', async () => {
    await expect(verifyProtocol(process.execPath, { args: [await host('setInterval(()=>{},1000)')], timeout: 100 })).rejects.toThrow(/timed out/)
  })
})
