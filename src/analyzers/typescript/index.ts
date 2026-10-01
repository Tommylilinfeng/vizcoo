import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { Import, LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { ConventionRule, Edge } from '../../core/pipeline/types.js'
import { extractSymbols } from './symbols.js'
import { initParser as initWasmParser } from './parser.js'
import { nextjsDetector } from './frameworks/nextjs.js'
import { expressDetector } from './frameworks/express.js'
import { monorepoDetector } from './frameworks/monorepo.js'
import { extractImportsFromSource } from '../../core/cold-start/methods/a0/parse-typescript.js'
import { readTsConfig, resolveSpecifier, type TsConfigPaths } from '../../core/cold-start/methods/a0/resolve-typescript.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const RESOLUTION_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs']

let tsConfigCache: { root: string; value: TsConfigPaths | null } | null = null
function getTsConfig(root: string): TsConfigPaths | null {
  if (!tsConfigCache || tsConfigCache.root !== root) {
    tsConfigCache = { root, value: readTsConfig(root) }
  }
  return tsConfigCache.value
}

export const typescriptAnalyzer: LanguageAnalyzer = {
  id: 'typescript',
  ignorePatterns: ['node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.turbo', '.vizcoo', '.ctx'],
  frameworkDetectors: [monorepoDetector, nextjsDetector, expressDetector],

  init: initWasmParser,

  canHandle(filePath: string): boolean {
    const dot = filePath.lastIndexOf('.')
    if (dot < 0) return false
    return EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root: string): string[] {
    return scanFiles(root, EXTS)
  },

  async extractImports(source: string, filePath: string): Promise<Import[]> {
    return extractImportsFromSource(source, filePath).map((raw) => ({
      spec: raw.specifier,
      isTypeOnly: raw.isTypeOnly,
    }))
  },

  extractSymbols,

  resolvePrimary(spec, fromFile, root, known) {
    const target = resolveSpecifier(spec, path.join(root, fromFile), root, known, getTsConfig(root))
    return target ? [target] : []
  },

  resolveSecondary(spec, fromFile, root, known) {
    const target = resolveNoTsConfig(spec, path.join(root, fromFile), root, known)
    return target ? [target] : []
  },

  applyConventionRules(rules, source, filePath, root, known) {
    const out: Edge[] = []
    for (const rule of rules) {
      if (rule.analyzerId !== 'typescript') continue
      if (rule.kind !== 'function_call_as_import') continue
      const fnName = rule.data['function_name']
      if (typeof fnName !== 'string') continue
      const escaped = fnName.replace(/\./g, '\\.').replace(/[$]/g, '\\$')
      const re = new RegExp(`\\b${escaped}\\s*\\(\\s*['"\`]([^'"\`\\n]+?)['"\`]`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(source)) !== null) {
        const arg = m[1]
        if (!arg) continue
        const target = resolveSpecifier(arg, path.join(root, filePath), root, known, getTsConfig(root))
        if (target) out.push({ from: filePath, to: target })
      }
    }
    return out
  },

  fingerprint(root: string): string {
    const h = createHash('sha256')
    for (const rel of ['tsconfig.json', 'package.json']) {
      const p = path.join(root, rel)
      try {
        h.update(rel)
        if (rel === 'package.json') {
          const pkg = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>
          const subset = {
            workspaces: (pkg as { workspaces?: unknown }).workspaces ?? null,
            imports: (pkg as { imports?: unknown }).imports ?? null,
            type: (pkg as { type?: unknown }).type ?? null,
          }
          h.update(JSON.stringify(subset))
        } else {
          h.update(fs.readFileSync(p))
        }
      } catch { /* missing — skip */ }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}

function resolveNoTsConfig(spec: string, fromAbs: string, root: string, known: Set<string>): string | null {
  if (!spec.startsWith('.') && !path.isAbsolute(spec)) return null
  const baseDir = path.dirname(fromAbs)
  const absBase = spec.startsWith('.') ? path.resolve(baseDir, spec) : path.resolve(spec)
  const direct = absToRel(absBase, root)
  if (direct && known.has(direct)) return direct
  const stripped = stripExt(absBase)
  for (const ext of RESOLUTION_EXTS) {
    const cand = absToRel(stripped + ext, root)
    if (cand && known.has(cand)) return cand
  }
  for (const ext of RESOLUTION_EXTS) {
    const cand = absToRel(absBase + ext, root)
    if (cand && known.has(cand)) return cand
  }
  for (const ext of RESOLUTION_EXTS) {
    const cand = absToRel(path.join(absBase, 'index' + ext), root)
    if (cand && known.has(cand)) return cand
  }
  return null
}

function absToRel(absPath: string, root: string): string | null {
  const rel = path.relative(root, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

function stripExt(p: string): string {
  for (const ext of RESOLUTION_EXTS) if (p.endsWith(ext)) return p.slice(0, -ext.length)
  return p
}
