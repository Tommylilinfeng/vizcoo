import WebSocket from 'ws'

const ws = new WebSocket('ws://127.0.0.1:3721/pty')
let bytes = 0
let firstChunkAt = 0
const start = Date.now()

ws.on('open', () => {
  console.log(`[${Date.now() - start}ms] WS open`)
  ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 30 }))
})
ws.on('message', (d) => {
  if (!firstChunkAt) firstChunkAt = Date.now() - start
  bytes += (d as Buffer).length
  process.stdout.write(d.toString('utf8'))
})
ws.on('close', (code, reason) => {
  console.log(`\n[${Date.now() - start}ms] WS close code=${code} reason=${reason.toString('utf8')} bytes=${bytes} first-chunk=${firstChunkAt}ms`)
})

setTimeout(() => ws.close(), 5000)
