import { useState } from 'react'
import type { ModuleRelation } from '../api.js'
import { regenerateRelations } from '../api.js'

export interface RelationsBannerProps {
  relations: ModuleRelation[]
  loading: boolean
  onUpdated: () => void
}

export function RelationsBanner({ relations, loading, onUpdated }: RelationsBannerProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return null

  const stale = relations.filter((r) => r.fingerprintCurrent !== null && r.fingerprintCurrent !== r.fingerprint)
  const empty = relations.length === 0

  if (!empty && stale.length === 0) return null

  const run = async (pairKeys: string[] | undefined) => {
    setBusy(true); setError(null)
    try {
      await regenerateRelations(pairKeys)
      onUpdated()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  if (empty) {
    return (
      <Strip>
        <span className="text-fg-muted">Module relationships not analyzed yet.</span>
        <button
          disabled={busy}
          onClick={() => void run(undefined)}
          className="rounded-md border border-hairline-strong bg-interactive px-2.5 py-1 text-fg hover:bg-interactive-active disabled:cursor-not-allowed disabled:opacity-50"
        >{busy ? 'analyzing… (1–2 min)' : 'Analyze now'}</button>
        {error && <span className="font-mono text-[10px] text-accent-danger">{error}</span>}
      </Strip>
    )
  }

  return (
    <Strip>
      <span className="text-accent-warn">↻ {stale.length} {stale.length === 1 ? 'relation needs' : 'relations need'} refresh</span>
      <button
        disabled={busy}
        onClick={() => void run(stale.map((r) => `${r.moduleAId}:${r.moduleBId}`))}
        className="rounded-md border border-accent-warn/30 bg-accent-warn/10 px-2.5 py-1 text-accent-warn hover:bg-accent-warn/20 disabled:cursor-not-allowed disabled:opacity-50"
      >{busy ? 'refreshing…' : 'Refresh all'}</button>
      {error && <span className="font-mono text-[10px] text-accent-danger">{error}</span>}
    </Strip>
  )
}

function Strip({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-3 rounded-md border border-hairline-strong bg-surface-2/95 px-3 py-1.5 font-mono text-[11px] text-fg-dim backdrop-blur">
        {children}
      </div>
    </div>
  )
}
