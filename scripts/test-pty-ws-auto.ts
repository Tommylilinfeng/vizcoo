import WebSocket from 'ws'

const id = process.argv[2] ?? 'f1ac4233-a185-49b8-b12a-ccb5835b3112'
const ws = new WebSocket(`ws://127.0.0.1:3721/pty?resume=${id}&cols=120&rows=30`)
let bytes = 0
const start = Date.now()

ws.on('open', () => console.log(`[${Date.now() - start}ms] open`))
ws.on('message', (d) => {
  bytes += (d as Buffer).length
  process.stdout.write(d.toString('utf8'))
})
ws.on('close', (code, r) => console.log(`\n[${Date.now() - start}ms] close ${code} ${r.toString('utf8')} bytes=${bytes}`))

setTimeout(() => ws.close(), 6000)
