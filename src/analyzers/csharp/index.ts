import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { Edge } from '../../core/pipeline/types.js'
import { extractCsImports } from '../../core/cold-start/methods/a0/parse-csharp.js'
import { readCsConfig, resolveCs, type CsConfig } from '../../core/cold-start/methods/a0/resolve-csharp.js'
import { getWasmParser } from '../../core/cold-start/methods/a0/wasm-helper.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.cs'])

let cfgCache: { root: string; value: CsConfig } | null = null
function getCfg(root: string): CsConfig {
  if (!cfgCache || cfgCache.root !== root) cfgCache = { root, value: readCsConfig(root) }
  return cfgCache.value
}

function csResolve(spec: string, _fromFile: string, root: string, known: Set<string>): string[] {
  return resolveCs({ qualifiedName: spec }, root, known, getCfg(root))
}

export const csharpAnalyzer: LanguageAnalyzer = {
  id: 'csharp',
  ignorePatterns: ['bin', 'obj', 'packages', '.vs'],
  frameworkDetectors: [],

  async init() { await getWasmParser('c_sharp') },

  canHandle(filePath) {
    const dot = filePath.lastIndexOf('.')
    return dot >= 0 && EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root) { return scanFiles(root, EXTS) },

  async extractImports(source) {
    const raws = await extractCsImports(source)
    return raws.map((raw) => ({ spec: raw.qualifiedName, isTypeOnly: false }))
  },

  extractSymbols: () => [],

  resolvePrimary: csResolve,
  resolveSecondary: csResolve,

  applyConventionRules() { return [] },

  fingerprint(root) {
    const h = createHash('sha256')
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return 'sha256:empty' }
    for (const e of entries) {
      if (e.isFile() && (e.name.endsWith('.csproj') || e.name.endsWith('.sln'))) {
        try { h.update(e.name); h.update(fs.readFileSync(path.join(root, e.name))) } catch { /* skip */ }
      }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}
