import type Database from 'better-sqlite3'
import type { AIProvider } from '../ai/provider.js'
import { generateRelation } from './generate.js'
import type { CrossEdgeSnippet } from './prompt.js'
import { deleteRelation, getRelation, upsertRelation } from './store.js'
import { gatherTopLevelPairs, type PairContext, type SyncStats } from './sync.js'

export interface ProgressState {
  done: number
  total: number
  generated: number
  failed: number
}

export interface RegenerateOptions {
  ai: AIProvider
  model?: string
  pairKeys?: string[]
  signal?: AbortSignal
  concurrency?: number
  onProgress?: (state: ProgressState) => void
}

export async function regenerate(db: Database.Database, opts: RegenerateOptions): Promise<SyncStats> {
  const pairs = gatherTopLevelPairs(db)
  const targets = opts.pairKeys
    ? pairs.filter((p) => opts.pairKeys!.includes(`${p.a.id}:${p.b.id}`))
    : pairs.filter((p) => p.crossEdges.length > 0)

  const total = targets.length
  let done = 0, generated = 0, noRelation = 0, failed = 0
  const queue = [...targets]
  const workerCount = Math.min(Math.max(1, opts.concurrency ?? 1), Math.max(1, queue.length))

  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      if (opts.signal?.aborted) return
      const p = queue.shift()
      if (!p) return
      try {
        const outcome = await processPair(db, p, opts)
        if (outcome === 'generated') generated++
        else noRelation++
      } catch (err) {
        if (opts.signal?.aborted) return
        failed++
        console.warn(`vizcoo: regenerate ${p.a.id}↔${p.b.id} failed: ${(err as Error).message}`)
      } finally {
        done++
        opts.onProgress?.({ done, total, generated, failed })
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker))
  return { pairs: pairs.length, pairsWithEdges: targets.length, generated, unchanged: 0, removed: 0, noRelation, failed }
}

async function processPair(db: Database.Database, p: PairContext, opts: RegenerateOptions): Promise<'generated' | 'noRelation'> {
  const edgeCounts = new Map<string, CrossEdgeSnippet>()
  for (const e of p.crossEdges) {
    const key = `${e.sourceFile}|${e.targetFile}|${e.kind}`
    const cur = edgeCounts.get(key)
    if (cur) cur.count++
    else edgeCounts.set(key, { fromFile: e.sourceFile, toFile: e.targetFile, kind: e.kind, count: 1 })
  }
  const ranked = [...edgeCounts.values()].sort((x, y) => y.count - x.count)
  const result = await generateRelation(opts.ai, { a: p.a, b: p.b, crossEdges: ranked }, { model: opts.model, signal: opts.signal })
  if (result.category === 'none') {
    const existing = getRelation(db, p.a.id, p.b.id)
    if (existing) deleteRelation(db, existing.id)
    return 'noRelation'
  }
  upsertRelation(db, {
    moduleAId: p.a.id, moduleBId: p.b.id,
    direction: result.direction, category: result.category,
    label: result.label, summary: result.summary,
    evidenceFiles: result.evidenceFilePaths,
    fingerprint: p.fingerprint,
  })
  return 'generated'
}
