const { spawn } = require('node:child_process')
const { access, chmod, copyFile, mkdir } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { validateNative, verifyProtocol } = require('./validate-bundle.cjs')

function bundleTarget(platform, architecture) {
  // electron-builder's Arch enum; its hooks receive the numeric form.
  const arch = typeof architecture === 'number' ? ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][architecture] : architecture
  const os = { darwin: 'mac', linux: 'linux', win32: 'win' }[platform]
  const suffix = { darwin: 'apple-darwin', linux: 'unknown-linux-gnu', win32: 'pc-windows-msvc' }[platform]
  if (!os || !['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported runtime bundle target: ${platform}/${arch}. Package x64 and arm64 separately.`)
  return { platform, arch, os, triple: `${arch === 'x64' ? 'x86_64' : 'aarch64'}-${suffix}`, filename: platform === 'win32' ? 'bingo.exe' : 'bingo' }
}

function runBuild(command, args, options) {
  return new Promise((resolveBuild, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit', shell: false, windowsHide: true })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolveBuild() : reject(new Error(`Native runtime build failed (exit ${code}). Install Rust or supply BINGO_BUNDLE_BINARY.`)))
  })
}

async function buildSibling(projectDir, target, env, build) {
  if (target.platform !== process.platform || target.arch !== process.arch) throw new Error('Cross-platform runtime builds are not automatic. Supply a target-matching BINGO_BUNDLE_BINARY and verify it on a native runner.')
  const source = resolve(projectDir, '..', 'bingo-improve')
  const manifest = join(source, 'Cargo.toml')
  try { await access(manifest) } catch { throw new Error(`Cannot build the required bundled runtime: ${manifest} is missing. Check out sibling bingo-improve or supply an absolute BINGO_BUNDLE_BINARY. Packaging without bingo is not supported.`) }
  await build('cargo', ['build', '--release', '--locked', '--manifest-path', manifest, '--package', 'bingo', '--target', target.triple, '--target-dir', join(source, 'target')], { cwd: source, env })
  return join(source, 'target', target.triple, 'release', target.filename)
}

async function prepareBundle({ projectDir, platform, arch, env = process.env, build = runBuild, probe = verifyProtocol }) {
  const target = bundleTarget(platform, arch)
  const input = env.BINGO_BUNDLE_BINARY ?? await buildSibling(projectDir, target, env, build)
  const source = await validateNative(input, target)
  if (platform === process.platform && target.arch === process.arch) await probe(source)
  const destination = join(projectDir, 'out', 'bundled-runtime', `${target.os}-${target.arch}`, target.filename)
  await mkdir(join(destination, '..'), { recursive: true })
  if (source !== destination) await copyFile(source, destination)
  if (platform !== 'win32') await chmod(destination, 0o755)
  console.log(`Prepared required bingo runtime: ${target.platform}/${target.arch} -> ${destination}`)
  return destination
}

async function beforePack(context) {
  await prepareBundle({ projectDir: context.packager.projectDir, platform: context.electronPlatformName, arch: context.arch })
}

module.exports = { bundleTarget, prepareBundle, beforePack }
if (require.main === module) {
  prepareBundle({ projectDir: resolve(__dirname, '..'), platform: process.platform, arch: process.arch }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
