import type Database from 'better-sqlite3'
import type { AIProvider } from '../ai/provider.js'
import type { HeuristicModule } from './discover-heuristic.js'
import type { AggregationResult } from './discover-llm.js'
import { aggregateModules } from './discover-llm.js'
import { applyAggregation } from './persist-aggregation.js'
import { applyStaticFallback } from './static-fallback.js'
import { computeFingerprint, readMeta } from './meta.js'

export interface AggregateOptions {
  force?: boolean
  model?: string
}

export type AggregateStatus = 'cached' | 'llm' | 'fallback' | 'noop'

export async function aggregateAndApply(
  db: Database.Database,
  ai: AIProvider | null,
  modules: HeuristicModule[],
  options: AggregateOptions = {},
): Promise<{ status: AggregateStatus }> {
  if (modules.length === 0) return { status: 'noop' }
  const fingerprint = computeFingerprint(modules)

  if (!options.force) {
    const cachedFp = readMeta(db, 'aggregation_fingerprint')
    const cachedResult = readMeta(db, 'aggregation_result')
    if (cachedFp === fingerprint && cachedResult) {
      try {
        const parsed = JSON.parse(cachedResult) as AggregationResult
        applyAggregation(db, parsed, fingerprint)
        return { status: 'cached' }
      } catch (err) {
        console.warn(`vizcoo: cached aggregation replay failed; ${(err as Error).message}`)
      }
    }
  }

  if (ai) {
    try {
      const result = await aggregateModules(ai, modules, options.model)
      applyAggregation(db, result, fingerprint)
      return { status: 'llm' }
    } catch (err) {
      console.warn(`vizcoo: LLM aggregation failed, using static fallback. ${(err as Error).message}`)
    }
  }

  applyStaticFallback(db, modules)
  return { status: 'fallback' }
}
