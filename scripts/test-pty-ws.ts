import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachPtyWebSocket } from '../src/core/server/pty/ws.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const htmlPath = path.join(root, 'dev', 'pty-test.html')

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html' || req.url === '/dev/pty-test.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(fs.readFileSync(htmlPath))
    return
  }
  res.writeHead(404).end()
})

attachPtyWebSocket(server, { path: '/pty/test', cwd: root })

const PORT = Number(process.env.PORT ?? 3722)
server.listen(PORT, '127.0.0.1', () => {
  console.log(`vizcoo PTY test server: http://127.0.0.1:${PORT}/`)
  console.log('open the URL in a browser; xterm should connect automatically.')
  console.log('try: ls, htop (q to quit), top, vim hello.txt, /bin/echo $LANG')
})
