import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { Edge } from '../../core/pipeline/types.js'
import { extractScalaImports } from '../../core/cold-start/methods/a0/parse-scala.js'
import { readScalaConfig, resolveScala, type ScalaConfig } from '../../core/cold-start/methods/a0/resolve-scala.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.scala', '.sc'])

let cfgCache: { root: string; value: ScalaConfig } | null = null
function getCfg(root: string): ScalaConfig {
  if (!cfgCache || cfgCache.root !== root) cfgCache = { root, value: readScalaConfig(root) }
  return cfgCache.value
}

function scalaResolve(spec: string, _fromFile: string, root: string, known: Set<string>): string[] {
  const isWildcard = spec.endsWith('.*')
  const qn = isWildcard ? spec.slice(0, -2) : spec
  return resolveScala({ qualifiedName: qn, isWildcard }, root, known, getCfg(root))
}

export const scalaAnalyzer: LanguageAnalyzer = {
  id: 'scala',
  ignorePatterns: ['target', 'build', '.bsp', '.metals', 'project/target'],
  frameworkDetectors: [],
  init: () => Promise.resolve(),

  canHandle(filePath) {
    const dot = filePath.lastIndexOf('.')
    return dot >= 0 && EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root) { return scanFiles(root, EXTS) },

  async extractImports(source) {
    return extractScalaImports(source).map((raw) => ({
      spec: raw.isWildcard ? raw.qualifiedName + '.*' : raw.qualifiedName,
      isTypeOnly: false,
    }))
  },

  extractSymbols: () => [],

  resolvePrimary: scalaResolve,
  resolveSecondary: scalaResolve,

  applyConventionRules() { return [] },

  fingerprint(root) {
    const h = createHash('sha256')
    for (const rel of ['build.sbt', 'build.sc', 'project/build.properties', 'pom.xml', 'build.gradle']) {
      const p = path.join(root, rel)
      try { h.update(rel); h.update(fs.readFileSync(p)) } catch { /* missing */ }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}
