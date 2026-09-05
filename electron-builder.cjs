const path = require('node:path')

// Release builders can supply a matching platform binary; installed runtimes remain supported.
const runtime = process.env.BINGO_BUNDLE_BINARY
module.exports = {
  appId: 'dev.bingo.rei',
  productName: 'Rei',
  directories: { output: 'dist' },
  files: ['out/**/*', 'package.json'],
  asar: true,
  asarUnpack: ['node_modules/node-pty/**/*'],
  ...(runtime ? { extraResources: [{ from: runtime, to: path.join('bin', process.platform === 'win32' ? 'bingo.exe' : 'bingo') }] } : {}),
  mac: { target: ['dmg', 'zip'], category: 'public.app-category.developer-tools', hardenedRuntime: true },
  win: { target: [{ target: 'nsis', arch: ['x64', 'arm64'] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
  linux: { target: ['AppImage', 'deb'], category: 'Development', maintainer: 'bingo' },
  artifactName: 'Rei-${version}-${os}-${arch}.${ext}'
}
