const { execFile } = require('node:child_process')
const { open, readdir } = require('node:fs/promises')
const { basename, join, resolve, sep } = require('node:path')
const { promisify } = require('node:util')

// Verify native resources explicitly: codesign --deep alone does not guarantee
// that loose executables in Resources (bingo and node-pty) are signed.
async function nativeFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await nativeFiles(path))
    else if (entry.isFile()) {
      const file = await open(path, 'r')
      try {
        const bytes = Buffer.alloc(4)
        const { bytesRead } = await file.read(bytes, 0, 4, 0)
        if (bytesRead === 4 && [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(bytes.readUInt32BE())) files.push(path)
      } finally { await file.close() }
    }
  }
  return files
}

async function verifyMacSignature(appPath, run = promisify(execFile)) {
  const files = await nativeFiles(join(appPath, 'Contents'))
  const required = [join('Contents', 'MacOS', 'Rei'), join('Contents', 'Resources', 'bin', 'bingo')]
  for (const relative of required) if (!files.includes(join(appPath, relative))) throw new Error(`Missing native bundle component: ${relative}`)
  for (const name of ['pty.node', 'spawn-helper']) {
    if (!files.some(file => file.includes(`${join('node_modules', 'node-pty')}${sep}`) && basename(file) === name)) throw new Error(`Missing native node-pty component: ${name}`)
  }
  if (!files.some(file => file.includes(`.framework${sep}`)) || !files.some(file => file.includes(` Helper.app${sep}`))) throw new Error('Missing Electron framework/helper components.')
  for (const file of files) {
    await run('/usr/bin/codesign', ['--verify', '--strict', file])
    const signature = await run('/usr/bin/codesign', ['--display', '--verbose=2', file])
    if (!/^Signature=adhoc$/m.test(signature.stderr)) throw new Error(`Preview requires an ad-hoc signature: ${file}`)
  }
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
  const signature = await run('/usr/bin/codesign', ['--display', '--verbose=2', appPath])
  if (!/^Signature=adhoc$/m.test(signature.stderr)) throw new Error('Preview requires an ad-hoc app signature (not Developer ID/notarization).')
  console.log(`Verified ad-hoc Preview: ${files.length} native components and sealed app (--deep --strict). Not notarized.`)
  return files.length
}

async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  await verifyMacSignature(join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`))
}

module.exports = { verifyMacSignature, afterSign }
if (require.main === module) {
  if (process.platform !== 'darwin' || !process.argv[2]) throw new Error('Usage on macOS: node scripts/verify-mac-signature.cjs /path/to/Rei.app')
  verifyMacSignature(resolve(process.argv[2])).catch(error => { console.error(error.message); process.exitCode = 1 })
}
