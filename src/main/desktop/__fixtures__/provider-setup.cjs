const mode = process.env.REI_SETUP_FIXTURE || 'success'
if (mode === 'hang') { setInterval(() => {}, 1000); return }
let input = ''
process.stdin.on('data', (data) => { input += data })
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  const values = input.split('\n')
  if (JSON.stringify(args) !== JSON.stringify(['provider', 'add', '--cwd', process.cwd()])) process.exit(41)
  if (values.length !== 5 || values[0] !== 'fixture' || values[1] !== 'openai' || values[2] !== 'https://api.example.test/v1' || values[3] !== 'test-credential-only' || values[4] !== '') process.exit(42)
  if (mode === 'overflow') process.stdout.write(values[3].repeat(5000))
  else if (mode === 'failure') { process.stderr.write('Should never surface: ' + values[3]); process.exitCode = 1 }
  else process.stdout.write('Should never surface: ' + values[3])
})
