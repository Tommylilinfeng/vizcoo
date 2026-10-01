import * as fs from 'node:fs'
import * as path from 'node:path'
import type * as http from 'node:http'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

export function serveStatic(res: http.ServerResponse, staticDir: string, pathname: string): void {
  const safePath = pathname === '/' ? '/index.html' : pathname
  const resolved = path.join(staticDir, safePath)
  if (!resolved.startsWith(staticDir)) return void res.writeHead(403).end()
  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      fs.stat(path.join(staticDir, 'index.html'), (err2, stat2) => {
        if (err2 || !stat2.isFile()) return void res.writeHead(404).end()
        streamFile(res, path.join(staticDir, 'index.html'), stat2.size)
      })
      return
    }
    streamFile(res, resolved, stat.size)
  })
}

function streamFile(res: http.ServerResponse, filePath: string, size: number): void {
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': size,
  })
  fs.createReadStream(filePath).pipe(res)
}
