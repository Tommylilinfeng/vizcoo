import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { Edge } from '../../core/pipeline/types.js'
import { extractRustImports, type RawRustImport } from '../../core/cold-start/methods/a0/parse-rust.js'
import { readRustConfig, resolveRust, type RustConfig } from '../../core/cold-start/methods/a0/resolve-rust.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.rs'])

let cfgCache: { root: string; value: RustConfig } | null = null
function getCfg(root: string): RustConfig {
  if (!cfgCache || cfgCache.root !== root) cfgCache = { root, value: readRustConfig(root) }
  return cfgCache.value
}

function encode(raw: RawRustImport): string {
  return `${raw.kind}\u0000${raw.path}`
}

function decode(spec: string): RawRustImport {
  const idx = spec.indexOf('\u0000')
  if (idx < 0) return { kind: 'use', path: spec }
  return { kind: spec.slice(0, idx) as 'use' | 'mod', path: spec.slice(idx + 1) }
}

function rustResolve(spec: string, fromFile: string, root: string, known: Set<string>): string[] {
  return resolveRust(decode(spec), fromFile, root, known, getCfg(root))
}

export const rustAnalyzer: LanguageAnalyzer = {
  id: 'rust',
  ignorePatterns: ['target', 'Cargo.lock'],
  frameworkDetectors: [],
  init: () => Promise.resolve(),

  canHandle(filePath) {
    const dot = filePath.lastIndexOf('.')
    return dot >= 0 && EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root) { return scanFiles(root, EXTS) },

  async extractImports(source) {
    return extractRustImports(source).map((raw) => ({ spec: encode(raw), isTypeOnly: false }))
  },

  extractSymbols: () => [],

  resolvePrimary: rustResolve,
  resolveSecondary: rustResolve,

  applyConventionRules() { return [] },

  fingerprint(root) {
    const h = createHash('sha256')
    for (const rel of ['Cargo.toml']) {
      const p = path.join(root, rel)
      try { h.update(rel); h.update(fs.readFileSync(p)) } catch { /* missing */ }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}
