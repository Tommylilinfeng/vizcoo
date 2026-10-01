import type * as http from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'

export interface Broadcaster {
  broadcast(msg: unknown): void
  close(): void
}

export function attachWebSocket(server: http.Server, path = '/ws'): Broadcaster {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== path) return
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'hello' }))
  })
  return {
    broadcast(msg: unknown): void {
      const payload = JSON.stringify(msg)
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(payload)
      }
    },
    close(): void {
      wss.close()
    },
  }
}
