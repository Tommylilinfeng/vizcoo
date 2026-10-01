import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { Edge } from '../../core/pipeline/types.js'
import { extractCIncludes } from '../../core/cold-start/methods/a0/parse-c.js'
import { resolveC } from '../../core/cold-start/methods/a0/resolve-c.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh'])

function cResolve(spec: string, fromFile: string, root: string, known: Set<string>): string[] {
  const target = resolveC({ path: spec, isSystem: false }, path.join(root, fromFile), root, known)
  return target ? [target] : []
}

export const cAnalyzer: LanguageAnalyzer = {
  id: 'c',
  ignorePatterns: ['build', 'out', 'target', 'cmake-build-debug', 'cmake-build-release'],
  frameworkDetectors: [],
  init: () => Promise.resolve(),

  canHandle(filePath) {
    const dot = filePath.lastIndexOf('.')
    return dot >= 0 && EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root) { return scanFiles(root, EXTS) },

  async extractImports(source) {
    return extractCIncludes(source)
      .filter((inc) => !inc.isSystem)
      .map((inc) => ({ spec: inc.path, isTypeOnly: false }))
  },

  extractSymbols: () => [],

  resolvePrimary: cResolve,
  resolveSecondary: cResolve,

  applyConventionRules(rules, source, filePath, root, known) {
    const out: Edge[] = []
    for (const rule of rules) {
      if (rule.analyzerId !== 'c' || rule.kind !== 'function_call_as_import') continue
      const fnName = rule.data['function_name']
      if (typeof fnName !== 'string') continue
      const escaped = fnName.replace(/\./g, '\\.').replace(/[$]/g, '\\$')
      const re = new RegExp(`\\b${escaped}\\s*\\(\\s*['"\`]([^'"\`\\n]+?)['"\`]`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(source)) !== null) {
        const arg = m[1]
        if (!arg) continue
        for (const t of cResolve(arg, filePath, root, known)) out.push({ from: filePath, to: t })
      }
    }
    return out
  },

  fingerprint(root) {
    const h = createHash('sha256')
    for (const rel of ['Makefile', 'makefile', 'CMakeLists.txt', 'configure.ac', 'meson.build']) {
      const p = path.join(root, rel)
      try { h.update(rel); h.update(fs.readFileSync(p)) } catch { /* missing */ }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}
