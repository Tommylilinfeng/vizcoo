import { handleHookPre, handleHookPost, handleHookTurnStart, handleHookStop, handleHookSessionStart, handleHookSessionEnd, type LiveDeps } from '../../view/live.js'

type Handler = (body: unknown, deps: LiveDeps, query: URLSearchParams) => void

const ROUTES: Record<string, Handler> = {
  pre: (b, d) => handleHookPre(asBody(b), d),
  post: (b, d) => handleHookPost(asBody(b), d),
  'turn-start': (b, d) => handleHookTurnStart(asBody(b), d),
  stop: (b, d) => handleHookStop(asBody(b), d),
  'session-start': (b, d, q) => {
    const raw = q.get('claude_pid')
    const pid = raw && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null
    handleHookSessionStart(asBody(b), pid, d)
  },
  'session-end': (b, d) => handleHookSessionEnd(asBody(b), d),
}

export function dispatchHook(path: string, body: unknown, deps: LiveDeps, query: URLSearchParams): { ok: true } {
  const handler = ROUTES[path]
  if (!handler) throw new Error(`unknown hook route: ${path}`)
  handler(body, deps, query)
  return { ok: true }
}

function asBody(v: unknown): Parameters<typeof handleHookPre>[0] {
  return (v && typeof v === 'object' ? v : {}) as Parameters<typeof handleHookPre>[0]
}
