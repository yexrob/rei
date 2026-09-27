// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { verifyMacSignature, afterSign } = require('./verify-mac-signature.cjs')
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rei-signature-')); roots.push(root)
  const app = join(root, 'Rei.app')
  const files = ['Contents/MacOS/Rei', 'Contents/Resources/bin/bingo', 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node', 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper', 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework', 'Contents/Frameworks/Rei Helper.app/Contents/MacOS/Rei Helper']
  for (const name of files) {
    const file = join(app, name); await mkdir(join(file, '..'), { recursive: true })
    const bytes = Buffer.alloc(64); bytes.writeUInt32LE(0xfeedfacf); await writeFile(file, bytes)
  }
  await writeFile(join(app, 'Contents/Resources/app.asar'), 'not native')
  return { root, app, files }
}
it('verifies every Mach-O and the complete sealed app, including runtime and node-pty', async () => {
  const { app, files } = await fixture()
  const run = vi.fn(async () => ({ stdout: '', stderr: 'Signature=adhoc\n' }))
  const count = await verifyMacSignature(app, run)
  expect(count).toBe(files.length)
  for (const file of files) expect(run).toHaveBeenCalledWith('/usr/bin/codesign', ['--verify', '--strict', join(app, file)])
  expect(run).toHaveBeenCalledWith('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
})
it('fails closed on an unsigned nested native component', async () => {
  const { app } = await fixture()
  const run = vi.fn(async (_command: string, args: string[]) => {
    if (args[0] === '--verify' && args.at(-1)!.endsWith('pty.node')) throw new Error('code object is not signed at all')
    return { stdout: '', stderr: 'Signature=adhoc\n' }
  })
  await expect(verifyMacSignature(app, run)).rejects.toThrow('not signed')
})
it('refuses a non-ad-hoc outer signature rather than claiming this Preview policy', async () => {
  const { app } = await fixture()
  await expect(verifyMacSignature(app, async () => ({ stdout: '', stderr: 'Authority=Developer ID Application\n' }))).rejects.toThrow('ad-hoc')
})
it('does not follow symlinks out of the bundle during native verification', async () => {
  const { root, app } = await fixture()
  await symlink(root, join(app, 'Contents/Resources/cycle'))
  await expect(verifyMacSignature(app, async () => ({ stdout: '', stderr: 'Signature=adhoc\n' }))).resolves.toBe(6)
})
it('does not invoke macOS tools for Windows or Linux builder hooks', async () => {
  await expect(afterSign({ electronPlatformName: 'win32' })).resolves.toBeUndefined()
  await expect(afterSign({ electronPlatformName: 'linux' })).resolves.toBeUndefined()
})
