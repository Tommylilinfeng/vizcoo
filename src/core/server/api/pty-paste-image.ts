import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'

const MAX_BYTES = 20 * 1024 * 1024
const TMP_DIR = path.join(os.homedir(), '.vizcoo', 'tmp')

export function handlePasteImage(req: http.IncomingMessage, res: http.ServerResponse): void {
  const chunks: Buffer[] = []
  let total = 0
  let aborted = false
  req.on('data', (c: Buffer) => {
    total += c.length
    if (total > MAX_BYTES) { aborted = true; res.writeHead(413).end(JSON.stringify({ error: 'too large' })); req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', () => {
    if (aborted) return
    const body = Buffer.concat(chunks)
    if (body.length === 0) { res.writeHead(400).end(JSON.stringify({ error: 'empty' })); return }
    const ct = String(req.headers['content-type'] ?? '')
    const ext = ct.includes('png') ? 'png' : ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : ct.includes('gif') ? 'gif' : ct.includes('webp') ? 'webp' : 'bin'
    fs.mkdirSync(TMP_DIR, { recursive: true })
    const sha = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)
    const file = path.join(TMP_DIR, `paste-${sha}.${ext}`)
    fs.writeFileSync(file, body)
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ path: file }))
  })
}
