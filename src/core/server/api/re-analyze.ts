import type Database from 'better-sqlite3'
import type { AIProvider } from '../../ai/provider.js'
import type { LanguageAnalyzer } from '../../plugin-api/analyzer.js'
import { indexProject } from '../../index-project.js'
import { startBackgroundRegenerate } from '../../relations/runner.js'

export type ReanalyzeStep = 'wipe' | 'scan' | 'discover' | 'aggregate' | 'done'
export type ReanalyzeBroadcast = (msg: unknown) => void

export interface ReanalyzeResult {
  status: 'ok'
  mode: 'refresh' | 'reset'
  files: number
  edges: number
  modules: number
  aggregation: string
  relationsBackground: boolean
}

export async function reanalyzeEndpoint(deps: {
  db: Database.Database
  root: string
  analyzers: LanguageAnalyzer[]
  ai: AIProvider | null
  model?: string
  reset?: boolean
  broadcast?: ReanalyzeBroadcast
}): Promise<ReanalyzeResult> {
  const mode: 'refresh' | 'reset' = deps.reset ? 'reset' : 'refresh'
  const emit = (step: ReanalyzeStep) => deps.broadcast?.({ type: 'reanalyze-progress', step, mode })
  if (deps.reset) { emit('wipe'); wipeAllStructure(deps.db) }
  const stats = await indexProject(deps.root, deps.db, deps.analyzers, {
    ai: deps.ai, model: deps.model, onProgress: emit,
  })
  emit('done')
  deps.broadcast?.({ type: 'update' })
  const bg = !!(deps.ai && deps.broadcast)
  if (deps.ai && deps.broadcast) {
    startBackgroundRegenerate({ db: deps.db, ai: deps.ai, model: deps.model, broadcast: deps.broadcast })
  }
  return {
    status: 'ok', mode,
    files: stats.files, edges: stats.edges, modules: stats.modules,
    aggregation: stats.aggregation, relationsBackground: bg,
  }
}

function wipeAllStructure(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.prepare('UPDATE files SET module_id = NULL').run()
    db.prepare('UPDATE modules SET parent_id = NULL, tier_id = NULL').run()
    db.prepare('DELETE FROM modules').run()
    db.prepare('DELETE FROM tiers').run()
    db.prepare("DELETE FROM meta WHERE key IN ('aggregation_fingerprint', 'aggregation_result')").run()
  })
  tx()
}
