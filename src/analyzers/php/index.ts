import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { Edge } from '../../core/pipeline/types.js'
import { extractPhpImports, type RawPhpImport } from '../../core/cold-start/methods/a0/parse-php.js'
import { readPhpConfig, resolvePhp, type PhpConfig } from '../../core/cold-start/methods/a0/resolve-php.js'
import { getWasmParser } from '../../core/cold-start/methods/a0/wasm-helper.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.php'])

let cfgCache: { root: string; value: PhpConfig } | null = null
function getCfg(root: string): PhpConfig {
  if (!cfgCache || cfgCache.root !== root) cfgCache = { root, value: readPhpConfig(root) }
  return cfgCache.value
}

function encode(raw: RawPhpImport): string { return `${raw.kind}\u0000${raw.path}` }
function decode(spec: string): RawPhpImport {
  const idx = spec.indexOf('\u0000')
  if (idx < 0) return { kind: 'use', path: spec }
  return { kind: spec.slice(0, idx) as 'use' | 'require', path: spec.slice(idx + 1) }
}

function phpResolve(spec: string, fromFile: string, root: string, known: Set<string>): string[] {
  return resolvePhp(decode(spec), fromFile, root, known, getCfg(root))
}

export const phpAnalyzer: LanguageAnalyzer = {
  id: 'php',
  ignorePatterns: ['vendor', 'cache', 'storage'],
  frameworkDetectors: [],

  async init() { await getWasmParser('php') },

  canHandle(filePath) {
    const dot = filePath.lastIndexOf('.')
    return dot >= 0 && EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root) { return scanFiles(root, EXTS) },

  async extractImports(source) {
    const raws = await extractPhpImports(source)
    return raws.map((raw) => ({ spec: encode(raw), isTypeOnly: false }))
  },

  extractSymbols: () => [],

  resolvePrimary: phpResolve,
  resolveSecondary: phpResolve,

  applyConventionRules() { return [] },

  fingerprint(root) {
    const h = createHash('sha256')
    for (const rel of ['composer.json', 'composer.lock']) {
      const p = path.join(root, rel)
      try { h.update(rel); h.update(fs.readFileSync(p)) } catch { /* missing */ }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}
