import type Database from 'better-sqlite3'
import type { AIProvider } from '../../ai/provider.js'
import { aggregateAndApply } from '../../modules/aggregate-and-apply.js'
import { listHeuristicModules } from '../../modules/list-for-aggregation.js'

export async function aggregateEndpoint(
  db: Database.Database,
  ai: AIProvider | null,
  body: { force?: boolean },
  model?: string,
): Promise<{ status: string; moduleCount: number }> {
  const modules = listHeuristicModules(db)
  const result = await aggregateAndApply(db, ai, modules, { force: body.force === true, model })
  return { status: result.status, moduleCount: modules.length }
}
