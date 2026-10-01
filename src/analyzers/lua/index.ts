import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { Edge } from '../../core/pipeline/types.js'
import { extractLuaImports } from '../../core/cold-start/methods/a0/parse-lua.js'
import { readLuaConfig, resolveLua, type LuaConfig } from '../../core/cold-start/methods/a0/resolve-lua.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.lua'])

let cfgCache: { root: string; value: LuaConfig } | null = null
function getCfg(root: string): LuaConfig {
  if (!cfgCache || cfgCache.root !== root) cfgCache = { root, value: readLuaConfig(root) }
  return cfgCache.value
}

function luaResolve(spec: string, fromFile: string, root: string, known: Set<string>): string[] {
  return resolveLua({ path: spec }, fromFile, root, known, getCfg(root))
}

export const luaAnalyzer: LanguageAnalyzer = {
  id: 'lua',
  ignorePatterns: ['build', '.luarocks'],
  frameworkDetectors: [],
  init: () => Promise.resolve(),

  canHandle(filePath) {
    const dot = filePath.lastIndexOf('.')
    return dot >= 0 && EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root) { return scanFiles(root, EXTS) },

  async extractImports(source) {
    return extractLuaImports(source).map((raw) => ({ spec: raw.path, isTypeOnly: false }))
  },

  extractSymbols: () => [],

  resolvePrimary: luaResolve,
  resolveSecondary: luaResolve,

  applyConventionRules() { return [] },

  fingerprint(root) {
    const h = createHash('sha256')
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return 'sha256:empty' }
    for (const e of entries) {
      if (e.isFile() && (e.name.endsWith('.rockspec') || e.name === '.luacheckrc')) {
        try { h.update(e.name); h.update(fs.readFileSync(path.join(root, e.name))) } catch { /* skip */ }
      }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}
