const { constants } = require('node:fs')
const { access, mkdtemp, open, realpath, rm, stat } = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { tmpdir } = require('node:os')
const { isAbsolute, join } = require('node:path')

function inspectNative(bytes) {
  const invalid = () => { throw new Error('The bundled runtime must be a supported native executable (64-bit Mach-O, ELF or PE), not a script or library.') }
  if (bytes.length < 64) return invalid()
  if (bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(12) === 2) {
    const arch = { 0x1000007: 'x64', 0x100000c: 'arm64' }[bytes.readUInt32LE(4)]
    if (arch) return { platform: 'darwin', arch }
  }
  if (bytes.subarray(0, 6).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1])) && [2, 3].includes(bytes.readUInt16LE(16))) {
    const arch = { 62: 'x64', 183: 'arm64' }[bytes.readUInt16LE(18)]
    if (arch) return { platform: 'linux', arch }
  }
  if (bytes.toString('ascii', 0, 2) === 'MZ') {
    const offset = bytes.readUInt32LE(60)
    if (offset + 24 <= bytes.length && bytes.toString('ascii', offset, offset + 4) === 'PE\0\0') {
      const flags = bytes.readUInt16LE(offset + 22)
      const arch = { 0x8664: 'x64', 0xaa64: 'arm64' }[bytes.readUInt16LE(offset + 4)]
      if (arch && (flags & 2) && !(flags & 0x2000)) return { platform: 'win32', arch }
    }
  }
  return invalid()
}

async function validateNative(path, target) {
  if (!isAbsolute(path)) throw new Error('BINGO_BUNDLE_BINARY must be an absolute path to a matching native bingo executable.')
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isFile()) throw new Error('The bundled runtime is not a regular file.')
  await access(canonical, target.platform === 'win32' ? constants.F_OK : constants.X_OK)
  const file = await open(canonical, 'r')
  let actual
  try {
    const buffer = Buffer.alloc(4096)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    actual = inspectNative(buffer.subarray(0, bytesRead))
  } finally { await file.close() }
  if (actual.platform !== target.platform || actual.arch !== target.arch) {
    throw new Error(`Bundled runtime is ${actual.platform}/${actual.arch}, but packaging targets ${target.platform}/${target.arch}. Supply a matching BINGO_BUNDLE_BINARY.`)
  }
  return canonical
}

function probeEnvironment(home) {
  const env = { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, BINGO_BROWSER_MODE: 'client' }
  for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TMP', 'TEMP', 'TMPDIR']) if (process.env[key]) env[key] = process.env[key]
  return env
}

function protocolHandshake(binary, home, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, options.args ?? ['serve', '--stdio'], { cwd: home, env: probeEnvironment(home), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let failure = null; let result = null; let output = ''; let shutdown = false
    const fail = (error) => { failure ??= error; child.kill('SIGKILL') }
    const timer = setTimeout(() => fail(new Error('Bundled runtime protocol probe timed out.')), options.timeout ?? 15000)
    const send = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: method, method, params }) + '\n')
    child.on('error', fail)
    child.stdin.on('error', fail)
    child.stderr.on('data', () => {})
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8')
      if (output.length > 1024 * 1024) return fail(new Error('Bundled runtime emitted oversized protocol output.'))
      let end
      while ((end = output.indexOf('\n')) !== -1) {
        const line = output.slice(0, end); output = output.slice(end + 1)
        try {
          const reply = JSON.parse(line)
          if (reply.jsonrpc !== '2.0' || reply.error) throw new Error('Bundled runtime returned an invalid protocol response.')
          if (reply.id === 'initialize') {
            result = reply.result
            const methods = result?.capabilities?.methods
            const required = ['shutdown', 'session/open', 'session/submit', 'session/events', 'session/history', 'session/list', 'catalog/read']
            if (result?.protocol !== 1 || result?.name !== 'bingo' || !Array.isArray(methods) || required.some(method => !methods.includes(method))) throw new Error('Bundled runtime must support bingo RPC protocol 1 and desktop session methods.')
            send('shutdown', {})
          } else if (reply.id === 'shutdown') { shutdown = true; child.stdin.end() }
        } catch (error) { fail(error); return }
      }
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (failure) reject(failure)
      else if (code !== 0 || !result || !shutdown || output.trim()) reject(new Error(`Bundled runtime failed the initialize/shutdown probe (exit ${code}).`))
      else resolve(result)
    })
    send('initialize', { protocol: 1, client: { name: 'Rei packaging verification', surface: 'desktop' } })
  })
}

async function verifyProtocol(binary, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'rei-runtime-probe-'))
  try { return await protocolHandshake(binary, home, options) }
  finally { await rm(home, { recursive: true, force: true }) }
}

async function validateBundle(context) {
  const { bundleTarget } = require('./prepare-bundle.cjs')
  const target = bundleTarget(context.electronPlatformName, context.arch)
  const binary = join(context.packager.getResourcesDir(context.appOutDir), 'bin', target.filename)
  await validateNative(binary, target)
  if (target.platform === process.platform && target.arch === process.arch) {
    const server = await verifyProtocol(binary)
    console.log(`Verified packaged bingo ${server.version}: ${target.platform}/${target.arch}, RPC ${server.protocol}, initialize/shutdown.`)
  } else console.log(`Verified packaged native header: ${target.platform}/${target.arch}. Execute protocol checks on a matching native runner before release.`)
}

module.exports = { inspectNative, validateNative, verifyProtocol, validateBundle }
