import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { Edge } from '../../core/pipeline/types.js'
import { extractKotlinImports } from '../../core/cold-start/methods/a0/parse-kotlin.js'
import { readKotlinConfig, resolveKotlin, type KotlinConfig } from '../../core/cold-start/methods/a0/resolve-kotlin.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.kt', '.kts'])

let cfgCache: { root: string; value: KotlinConfig } | null = null
function getCfg(root: string): KotlinConfig {
  if (!cfgCache || cfgCache.root !== root) cfgCache = { root, value: readKotlinConfig(root) }
  return cfgCache.value
}

function ktResolve(spec: string, _fromFile: string, root: string, known: Set<string>): string[] {
  const isWildcard = spec.endsWith('.*')
  const qn = isWildcard ? spec.slice(0, -2) : spec
  return resolveKotlin({ qualifiedName: qn, isWildcard }, root, known, getCfg(root))
}

export const kotlinAnalyzer: LanguageAnalyzer = {
  id: 'kotlin',
  ignorePatterns: ['target', 'build', 'out', '.gradle', '.idea'],
  frameworkDetectors: [],
  init: () => Promise.resolve(),

  canHandle(filePath) {
    const dot = filePath.lastIndexOf('.')
    return dot >= 0 && EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root) { return scanFiles(root, EXTS) },

  async extractImports(source) {
    return extractKotlinImports(source).map((raw) => ({
      spec: raw.isWildcard ? raw.qualifiedName + '.*' : raw.qualifiedName,
      isTypeOnly: false,
    }))
  },

  extractSymbols: () => [],

  resolvePrimary: ktResolve,
  resolveSecondary: ktResolve,

  applyConventionRules() { return [] },

  fingerprint(root) {
    const h = createHash('sha256')
    for (const rel of ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'pom.xml']) {
      const p = path.join(root, rel)
      try { h.update(rel); h.update(fs.readFileSync(p)) } catch { /* missing */ }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}
