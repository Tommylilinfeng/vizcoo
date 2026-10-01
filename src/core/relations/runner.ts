import type Database from 'better-sqlite3'
import type { AIProvider } from '../ai/provider.js'
import { regenerate } from './regenerate.js'

let current: AbortController | null = null
let currentPromise: Promise<void> | null = null

export interface BackgroundDeps {
  db: Database.Database
  ai: AIProvider
  model?: string
  broadcast: (msg: unknown) => void
}

export function startBackgroundRegenerate(deps: BackgroundDeps): void {
  current?.abort()
  const prev = currentPromise
  const ac = new AbortController()
  current = ac
  currentPromise = (async () => {
    if (prev) await prev.catch(() => {})
    if (ac.signal.aborted) {
      deps.broadcast({ type: 'relations-cancelled' })
      return
    }
    await runRegenerate(deps, ac)
  })()
}

// Used by mutation endpoints (split/merge/module-edit) so an in-flight regen
// doesn't try to upsert relations referencing module IDs we're about to delete.
export function cancelBackgroundRegenerate(): void {
  current?.abort()
}

async function runRegenerate(deps: BackgroundDeps, ac: AbortController): Promise<void> {
  try {
    const stats = await regenerate(deps.db, {
      ai: deps.ai, model: deps.model, signal: ac.signal, concurrency: 5,
      onProgress: ({ done, total, generated, failed }) => {
        deps.broadcast({ type: 'relations-progress', done, total, generated, failed })
        deps.broadcast({ type: 'update' })
      },
    })
    if (ac.signal.aborted) deps.broadcast({ type: 'relations-cancelled' })
    else deps.broadcast({ type: 'relations-done', generated: stats.generated, failed: stats.failed })
  } catch (err) {
    if (ac.signal.aborted) deps.broadcast({ type: 'relations-cancelled' })
    else deps.broadcast({ type: 'relations-done', generated: 0, failed: 1, error: (err as Error).message })
  } finally {
    if (current === ac) { current = null; currentPromise = null }
  }
}
