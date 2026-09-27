const { beforePack } = require('./scripts/prepare-bundle.cjs')
const { validateBundle } = require('./scripts/validate-bundle.cjs')
const { afterSign } = require('./scripts/verify-mac-signature.cjs')
module.exports = {
  appId: 'dev.bingo.rei',
  productName: 'Rei',
  directories: { output: 'dist' },
  files: ['out/**/*', '!out/bundled-runtime/**/*', 'package.json'],
  asar: true,
  asarUnpack: ['node_modules/node-pty/**/*'],
  beforePack,
  afterPack: validateBundle,
  afterSign,
  extraResources: [{ from: 'out/bundled-runtime/${os}-${arch}', to: 'bin' }],
  // electron-builder 26.15.3 signs nested Mach-O code with @electron/osx-sign.
  // Its default entitlements retain JIT and allow ad-hoc native libraries to load.
  mac: { target: ['dmg', 'zip'], category: 'public.app-category.developer-tools', identity: '-', hardenedRuntime: true, strictVerify: true, notarize: false },
  win: { target: ['nsis'] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
  linux: { target: ['AppImage', 'deb'], category: 'Development', maintainer: 'bingo' },
  artifactName: 'Rei-${version}-${os}-${arch}.${ext}'
}
