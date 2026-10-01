import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { Edge } from '../../core/pipeline/types.js'
import { extractRubyImports, type RawRubyImport } from '../../core/cold-start/methods/a0/parse-ruby.js'
import { readRubyConfig, resolveRuby, type RubyConfig } from '../../core/cold-start/methods/a0/resolve-ruby.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.rb'])

let cfgCache: { root: string; value: RubyConfig } | null = null
function getCfg(root: string): RubyConfig {
  if (!cfgCache || cfgCache.root !== root) cfgCache = { root, value: readRubyConfig(root) }
  return cfgCache.value
}

function encode(raw: RawRubyImport): string { return `${raw.kind}\u0000${raw.path}` }
function decode(spec: string): RawRubyImport {
  const idx = spec.indexOf('\u0000')
  if (idx < 0) return { kind: 'require', path: spec }
  return { kind: spec.slice(0, idx) as RawRubyImport['kind'], path: spec.slice(idx + 1) }
}
function rubyResolve(spec: string, fromFile: string, root: string, known: Set<string>): string[] {
  return resolveRuby(decode(spec), fromFile, root, known, getCfg(root))
}

export const rubyAnalyzer: LanguageAnalyzer = {
  id: 'ruby',
  ignorePatterns: ['vendor', '.bundle', 'tmp', 'log'],
  frameworkDetectors: [],
  init: () => Promise.resolve(),

  canHandle(filePath) {
    const dot = filePath.lastIndexOf('.')
    return dot >= 0 && EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root) { return scanFiles(root, EXTS) },

  async extractImports(source) {
    return extractRubyImports(source).map((raw) => ({ spec: encode(raw), isTypeOnly: false }))
  },

  extractSymbols: () => [],

  resolvePrimary: rubyResolve,
  resolveSecondary: rubyResolve,

  applyConventionRules() { return [] },

  fingerprint(root) {
    const h = createHash('sha256')
    for (const rel of ['Gemfile', 'Gemfile.lock', '.ruby-version']) {
      const p = path.join(root, rel)
      try { h.update(rel); h.update(fs.readFileSync(p)) } catch { /* missing */ }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}
