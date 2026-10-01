import type Database from 'better-sqlite3'
import type { AIProvider } from '../../ai/provider.js'
import type { LanguageAnalyzer } from '../../plugin-api/analyzer.js'
import { splitModule, type SplitResult } from '../../modules/split.js'

export interface SplitConfig {
  db: Database.Database
  root: string
  analyzers: LanguageAnalyzer[]
  ai: AIProvider
  model?: string
}

export async function splitEndpoint(body: unknown, cfg: SplitConfig): Promise<SplitResult> {
  if (!body || typeof body !== 'object' || !('moduleId' in body)) throw new Error('moduleId required')
  const b = body as { moduleId: unknown; count?: unknown; hint?: unknown }
  if (typeof b.moduleId !== 'number') throw new Error('moduleId must be a number')
  const count = typeof b.count === 'number' && b.count >= 2 ? b.count : null
  const hint = typeof b.hint === 'string' ? b.hint : undefined
  return splitModule({ ...cfg, moduleId: b.moduleId, count, hint })
}
