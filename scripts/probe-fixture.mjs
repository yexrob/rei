#!/usr/bin/env node

// Test fixture only. It simulates the side-effect-free bingo capability probes used by M0 evidence.
const args = process.argv.slice(2)

if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('bingo 0.3.3\n')
  process.exit(0)
}

if (args.length === 2 && args[0] === '--json-events' && args[1] === '--probe') {
  process.stdout.write(`${JSON.stringify({
    protocolVersion: 1,
    seq: 1,
    sessionId: null,
    type: 'protocol.ready',
    metadata: { bingoVersion: '0.3.3', protocolVersion: 1 }
  })}\n`)
  process.exit(0)
}

process.stderr.write(`probe-fixture: unsupported arguments: ${args.join(' ')}\n`)
process.exit(2)
