const { chmodSync, existsSync, lstatSync } = require('node:fs')
const { dirname, join } = require('node:path')

// node-pty 1.1.0's npm prebuild may lose the Unix helper's executable bit.
// Keep the fix at install time so development and packaged apps agree.
if (process.platform !== 'win32') {
  const root = dirname(require.resolve('node-pty/package.json'))
  for (const directory of ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`]) {
    const helper = join(root, directory, 'spawn-helper')
    if (!existsSync(helper)) continue
    const file = lstatSync(helper)
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('Unexpected node-pty spawn-helper file type.')
    chmodSync(helper, file.mode | 0o111)
  }
}
