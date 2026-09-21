const { beforePack } = require('./scripts/prepare-bundle.cjs')
const { validateBundle } = require('./scripts/validate-bundle.cjs')
module.exports = {
  appId: 'dev.bingo.rei',
  productName: 'Rei',
  directories: { output: 'dist' },
  files: ['out/**/*', '!out/bundled-runtime/**/*', 'package.json'],
  asar: true,
  asarUnpack: ['node_modules/node-pty/**/*'],
  beforePack,
  afterPack: validateBundle,
  extraResources: [{ from: 'out/bundled-runtime/${os}-${arch}', to: 'bin' }],
  mac: { target: ['dmg', 'zip'], category: 'public.app-category.developer-tools', hardenedRuntime: true },
  win: { target: ['nsis'] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
  linux: { target: ['AppImage', 'deb'], category: 'Development', maintainer: 'bingo' },
  artifactName: 'Rei-${version}-${os}-${arch}.${ext}'
}
