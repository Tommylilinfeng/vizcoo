import * as fs from 'node:fs'
import * as path from 'node:path'
import type Database from 'better-sqlite3'
import type { LanguageAnalyzer } from './plugin-api/analyzer.js'
import type { AIProvider } from './ai/provider.js'
import { runPipeline, pickAnalyzer } from './pipeline/run.js'
import { readConventionsCache } from './pipeline/conventions.js'
import { dedupeEdges } from './pipeline/diff.js'
import { replaceEdgesForFile } from './graph/edges.js'
import { classifyProject } from './modules/classify.js'
import { aggregateAndApply, type AggregateStatus } from './modules/aggregate-and-apply.js'
import { findOrCreateModule, diffWithHeuristic } from './modules/module-sync.js'

export interface IndexStats {
  files: number
  edges: number
  modules: number
  detector: string
  aggregation: AggregateStatus | 'skipped'
  firstRun: boolean
  conventionsSource: string
  disagreementSize: number
  rulesApplied: number
}

export type IndexProgress = 'scan' | 'discover' | 'aggregate'

export interface IndexOptions {
  ai?: AIProvider | null
  model?: string
  decisionModel?: string
  onProgress?: (step: IndexProgress) => void
}

export async function indexProject(
  root: string,
  db: Database.Database,
  analyzers: LanguageAnalyzer[],
  options: IndexOptions = {},
): Promise<IndexStats> {
  const firstRun = (db.prepare('SELECT COUNT(*) AS n FROM modules').get() as { n: number }).n === 0

  options.onProgress?.('scan')
  const result = await runPipeline(root, analyzers, { decisionModel: options.decisionModel })

  pruneStaleFiles(db, result.files)
  writeFilesAndEdges(db, result.files, result.edges)

  options.onProgress?.('discover')
  const allDetectors = analyzers.flatMap((a) => a.frameworkDetectors)
  const { detectorResult, heuristicModules } = classifyProject(root, result.files, allDetectors)

  const heuristicForDiff = heuristicModules ?? detectorResult.modules.map((m) => ({
    name: m.name, files: m.files, dirs: m.dirs ?? [m.name], keyExports: m.keyExports ?? [],
  }))
  diffWithHeuristic(db, heuristicForDiff)

  const detector = detectorResult.confidence === 0 ? 'heuristic' : `confidence=${detectorResult.confidence}`
  let aggregation: IndexStats['aggregation'] = 'skipped'
  if (heuristicModules) {
    options.onProgress?.('aggregate')
    const out = await aggregateAndApply(db, options.ai ?? null, heuristicModules, { model: options.model })
    aggregation = out.status
  }
  const moduleCount = (db.prepare('SELECT COUNT(*) AS n FROM modules').get() as { n: number }).n

  return {
    files: result.files.length,
    edges: result.edges.length,
    modules: moduleCount,
    detector,
    aggregation,
    firstRun,
    conventionsSource: result.conventionsSource,
    disagreementSize: result.disagreementSize,
    rulesApplied: result.rulesApplied,
  }
}

export async function processFile(
  db: Database.Database,
  root: string,
  relPath: string,
  analyzers: LanguageAnalyzer[],
): Promise<number> {
  const analyzer = pickAnalyzer(analyzers, relPath)
  if (!analyzer) return 0
  const absPath = path.join(root, relPath)
  if (!fs.existsSync(absPath)) {
    deleteFile(db, relPath)
    return 0
  }
  const source = fs.readFileSync(absPath, 'utf8')
  const moduleId = findOrCreateModule(db, relPath)
  db.prepare(
    'INSERT INTO files (path, module_id) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET module_id = COALESCE(files.module_id, excluded.module_id)',
  ).run(relPath, moduleId)

  const known = new Set(
    (db.prepare('SELECT path FROM files').all() as Array<{ path: string }>).map((r) => r.path),
  )
  const rules = readConventionsCache(root)?.rules ?? []

  const imports = await analyzer.extractImports(source, relPath)
  const primary = imports
    .filter((i) => !i.isTypeOnly)
    .flatMap((i) => analyzer.resolvePrimary(i.spec, relPath, root, known).map((to) => ({ from: relPath, to })))
  const conventionEdges = analyzer.applyConventionRules(rules, source, relPath, root, known)
  const edges = dedupeEdges([...primary, ...conventionEdges])

  replaceEdgesForFile(db, relPath, edges.map((e) => ({ sourceFile: e.from, targetFile: e.to, kind: 'import' as const })))
  return edges.length
}

function writeFilesAndEdges(db: Database.Database, files: string[], edges: Array<{ from: string; to: string }>): void {
  const insertFile = db.prepare(
    'INSERT INTO files (path, module_id) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET module_id = COALESCE(files.module_id, excluded.module_id)',
  )
  const clearEdges = db.prepare('DELETE FROM edges')
  const insertEdge = db.prepare('INSERT OR IGNORE INTO edges (source_file, target_file, kind) VALUES (?, ?, ?)')
  const tx = db.transaction(() => {
    for (const f of files) {
      const moduleId = findOrCreateModule(db, f)
      insertFile.run(f, moduleId)
    }
    clearEdges.run()
    for (const e of edges) insertEdge.run(e.from, e.to, 'import')
  })
  tx()
}

function pruneStaleFiles(db: Database.Database, scanned: string[]): void {
  const known = new Set(scanned)
  const all = (db.prepare('SELECT path FROM files').all() as Array<{ path: string }>).map((r) => r.path)
  const stale = all.filter((p) => !known.has(p))
  if (stale.length === 0) return
  const tx = db.transaction(() => {
    for (const p of stale) {
      db.prepare('DELETE FROM edges WHERE source_file = ? OR target_file = ?').run(p, p)
      db.prepare('DELETE FROM files WHERE path = ?').run(p)
    }
  })
  tx()
}

export function deleteFile(db: Database.Database, relPath: string): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM edges WHERE source_file = ?').run(relPath)
    db.prepare('DELETE FROM files WHERE path = ?').run(relPath)
  })
  tx()
}
