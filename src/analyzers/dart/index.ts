import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { Edge } from '../../core/pipeline/types.js'
import { extractDartImports } from '../../core/cold-start/methods/a0/parse-dart.js'
import { readDartConfig, resolveDart, type DartConfig } from '../../core/cold-start/methods/a0/resolve-dart.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.dart'])

let cfgCache: { root: string; value: DartConfig } | null = null
function getCfg(root: string): DartConfig {
  if (!cfgCache || cfgCache.root !== root) cfgCache = { root, value: readDartConfig(root) }
  return cfgCache.value
}

function dartResolve(spec: string, fromFile: string, root: string, known: Set<string>): string[] {
  const isPackage = spec.startsWith('package:')
  return resolveDart({ path: spec, isPackage }, fromFile, root, known, getCfg(root))
}

export const dartAnalyzer: LanguageAnalyzer = {
  id: 'dart',
  ignorePatterns: ['.dart_tool', 'build', '.pub-cache', '.pub'],
  frameworkDetectors: [],
  init: () => Promise.resolve(),

  canHandle(filePath) {
    const dot = filePath.lastIndexOf('.')
    return dot >= 0 && EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root) { return scanFiles(root, EXTS) },

  async extractImports(source) {
    return extractDartImports(source).map((raw) => ({ spec: raw.path, isTypeOnly: false }))
  },

  extractSymbols: () => [],

  resolvePrimary: dartResolve,
  resolveSecondary: dartResolve,

  applyConventionRules() { return [] },

  fingerprint(root) {
    const h = createHash('sha256')
    for (const rel of ['pubspec.yaml', 'pubspec.lock']) {
      const p = path.join(root, rel)
      try { h.update(rel); h.update(fs.readFileSync(p)) } catch { /* missing */ }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}
