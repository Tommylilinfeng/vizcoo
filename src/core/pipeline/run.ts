import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { LanguageAnalyzer } from '../plugin-api/analyzer.js'
import type { Edge, PipelineResult } from './types.js'
import { dedupeEdges, diffEdges } from './diff.js'
import { computeSignals, learnConventions, readConventionsCache, writeConventionsCache } from './conventions.js'

export interface PipelineOptions {
  decisionModel?: string
  forceFresh?: boolean
}

export async function runPipeline(
  root: string,
  analyzers: LanguageAnalyzer[],
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  for (const a of analyzers) await a.init()

  const fileSet = new Set<string>()
  for (const a of analyzers) for (const f of a.discoverFiles(root)) fileSet.add(f)
  const files = [...fileSet].sort()
  const known = new Set(files)

  const perFile: Array<{ file: string; analyzer: LanguageAnalyzer; source: string }> = []
  for (const f of files) {
    const a = pickAnalyzer(analyzers, f)
    if (!a) continue
    const source = readSafe(path.join(root, f))
    if (source === null) continue
    perFile.push({ file: f, analyzer: a, source })
  }

  const primary: Edge[] = []
  const secondary: Edge[] = []
  for (const { file, analyzer, source } of perFile) {
    const imports = await analyzer.extractImports(source, file)
    for (const imp of imports) {
      if (imp.isTypeOnly) continue
      for (const t of analyzer.resolvePrimary(imp.spec, file, root, known)) primary.push({ from: file, to: t })
      for (const t of analyzer.resolveSecondary(imp.spec, file, root, known)) secondary.push({ from: file, to: t })
    }
  }

  const disagreement = diffEdges(primary, secondary)
  const fingerprint = combineFingerprints(analyzers, root)

  const cached = options.forceFresh ? null : readConventionsCache(root)
  let rules = cached?.rules ?? []
  let conventionsSource: PipelineResult['conventionsSource'] = 'cache-hit'
  let learnUsage: PipelineResult['learnUsage']

  if (!cached || cached.fingerprint !== fingerprint) {
    if (disagreement.onlyPrimary.length === 0 && disagreement.onlySecondary.length === 0) {
      rules = []
      conventionsSource = 'cache-miss-no-disagreement'
    } else {
      const signals = computeSignals(root, files)
      const learn = await learnConventions({ root, disagreement, signals, model: options.decisionModel })
      rules = learn.rules
      learnUsage = learn.usage
      conventionsSource = 'cache-miss-learn'
    }
    writeConventionsCache(root, {
      version: '1.0',
      fingerprint,
      rules,
      learnedAt: new Date().toISOString(),
    })
  }

  const conventionEdges: Edge[] = []
  for (const { file, analyzer, source } of perFile) {
    conventionEdges.push(...analyzer.applyConventionRules(rules, source, file, root, known))
  }

  const finalEdges = dedupeEdges([...primary, ...conventionEdges])
  return {
    files,
    edges: finalEdges,
    disagreementSize: disagreement.onlyPrimary.length + disagreement.onlySecondary.length,
    fingerprint,
    conventionsSource,
    rulesApplied: rules.length,
    ...(learnUsage ? { learnUsage } : {}),
  }
}

export function pickAnalyzer(analyzers: LanguageAnalyzer[], filePath: string): LanguageAnalyzer | null {
  return analyzers.find((a) => a.canHandle(filePath)) ?? null
}

function combineFingerprints(analyzers: LanguageAnalyzer[], root: string): string {
  const h = createHash('sha256')
  for (const a of [...analyzers].sort((x, y) => x.id.localeCompare(y.id))) {
    h.update(a.id)
    h.update('\0')
    h.update(a.fingerprint(root))
    h.update('\n')
  }
  return 'sha256:' + h.digest('hex').slice(0, 16)
}

function readSafe(absPath: string): string | null {
  try { return fs.readFileSync(absPath, 'utf8') } catch { return null }
}
