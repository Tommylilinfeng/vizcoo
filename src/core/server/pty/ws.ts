import * as http from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { spawn as spawnPty } from './session.js'

export interface PtyWsOptions {
  path?: string
  cwd: string
  command: string | null
  args?: string[]
  env?: NodeJS.ProcessEnv
}

export function attachPtyWebSocket(server: http.Server, opts: PtyWsOptions): void {
  const path = opts.path ?? '/pty'
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== path) return
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })
  wss.on('connection', (ws, req) => {
    if (!opts.command) {
      ws.send('\r\n\x1b[31m[vizcoo] claude binary not found on PATH. Install Claude Code first.\x1b[0m\r\n')
      ws.close(1011, 'binary-not-found')
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const args: string[] = [...(opts.args ?? [])]
    const resume = url.searchParams.get('resume')
    if (resume) args.push('--resume', resume)
    const model = url.searchParams.get('model')
    if (model) args.push('--model', model)
    const effort = url.searchParams.get('effort')
    if (effort && ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) {
      args.push('--effort', effort)
    }
    if (url.searchParams.get('skipPerms') === '1') args.push('--dangerously-skip-permissions')
    if (url.searchParams.get('planMode') === '1') args.push('--permission-mode', 'plan')
    const cols = Math.max(20, Math.min(500, Number(url.searchParams.get('cols')) || 80))
    const rows = Math.max(5, Math.min(200, Number(url.searchParams.get('rows')) || 24))
    const session = spawnPty({
      command: opts.command,
      args,
      cwd: opts.cwd,
      cols,
      rows,
      env: opts.env ?? process.env,
    })
    session.onData((data) => { if (ws.readyState === WebSocket.OPEN) ws.send(data) })
    session.onExit((code) => { if (ws.readyState === WebSocket.OPEN) ws.close(1000, `exit:${code}`) })
    ws.on('message', (raw) => {
      const text = raw.toString('utf8')
      if (text.length > 0 && text.charCodeAt(0) === 0x7b) {
        try {
          const msg: unknown = JSON.parse(text)
          if (typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'resize') {
            const { cols, rows } = msg as { cols: unknown; rows: unknown }
            if (Number.isFinite(cols) && Number.isFinite(rows)) {
              const c = Math.max(20, Math.min(500, Number(cols)))
              const r = Math.max(5, Math.min(200, Number(rows)))
              session.resize(c, r)
            }
            return
          }
        } catch { /* fall through, treat as stdin */ }
      }
      session.write(text)
    })
    ws.on('close', () => session.dispose())
  })
}
