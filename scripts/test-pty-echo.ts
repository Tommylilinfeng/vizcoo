import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from '../src/core/server/pty/session.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const session = spawn({
  command: '/bin/zsh',
  args: [],
  cwd: root,
  cols: 80,
  rows: 24,
  env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME ?? '', TERM: 'xterm-256color' },
})

let buffer = ''
session.onData((data) => {
  buffer += data
  process.stdout.write(data)
})

session.onExit((code) => {
  console.log(`\n[pty exit code=${code}]`)
  const sawLs = /package\.json/.test(buffer)
  console.log(`[verify] saw package.json in output: ${sawLs}`)
  process.exit(sawLs ? 0 : 1)
})

setTimeout(() => session.write('ls\n'), 200)
setTimeout(() => session.write('exit\n'), 800)
