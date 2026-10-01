import { spawn } from '../src/core/server/pty/session.js'
import { findClaude } from '../src/core/server/pty/claude-binary.js'

const bin = findClaude()
if (!bin) { console.error('claude not found'); process.exit(2) }
console.log(`spawning: ${bin}`)

const session = spawn({
  command: bin,
  args: [],
  cwd: process.env.VIZCOO_TEST_PROJECT ?? process.cwd(),
  cols: 120,
  rows: 30,
  env: process.env,
})

let buf = ''
session.onData((d) => { buf += d; process.stdout.write(d) })
session.onExit((code) => {
  console.log(`\n\n[claude exited code=${code}]`)
  console.log(`[bytes captured: ${buf.length}]`)
  process.exit(0)
})

setTimeout(() => session.dispose(), 4000)
