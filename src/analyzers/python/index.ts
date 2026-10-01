import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { Import, LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { ConventionRule, Edge } from '../../core/pipeline/types.js'
import { extractPythonImports, type RawPythonImport } from '../../core/cold-start/methods/a0/parse-python.js'
import { readPyConfig, resolvePython, type PyConfig } from '../../core/cold-start/methods/a0/resolve-python.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.py'])

let pyConfigCache: { root: string; value: PyConfig } | null = null
function getPyConfig(root: string): PyConfig {
  if (!pyConfigCache || pyConfigCache.root !== root) {
    pyConfigCache = { root, value: readPyConfig(root) }
  }
  return pyConfigCache.value
}

function encode(raw: RawPythonImport): string {
  if (raw.names && raw.names.length > 0) return `${raw.module}\u0000${raw.names.join(',')}`
  return raw.module
}

function decode(spec: string): RawPythonImport {
  const idx = spec.indexOf('\u0000')
  if (idx < 0) return { module: spec, names: null }
  const module = spec.slice(0, idx)
  const namesStr = spec.slice(idx + 1)
  return { module, names: namesStr ? namesStr.split(',') : null }
}

function pyResolve(spec: string, fromFile: string, root: string, known: Set<string>): string[] {
  return resolvePython(decode(spec), path.join(root, fromFile), root, known, getPyConfig(root))
}

export const pythonAnalyzer: LanguageAnalyzer = {
  id: 'python',
  ignorePatterns: ['__pycache__', '.venv', 'venv', 'env', '.tox', '.pytest_cache', 'dist', 'build', '.eggs'],
  frameworkDetectors: [],
  init: () => Promise.resolve(),

  canHandle(filePath) {
    const dot = filePath.lastIndexOf('.')
    return dot >= 0 && EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root) { return scanFiles(root, EXTS) },

  async extractImports(source) {
    return extractPythonImports(source).map((raw) => ({ spec: encode(raw), isTypeOnly: false }))
  },

  extractSymbols: () => [],

  resolvePrimary: pyResolve,
  resolveSecondary: pyResolve,

  applyConventionRules(rules, source, filePath, root, known) {
    const out: Edge[] = []
    for (const rule of rules) {
      if (rule.analyzerId !== 'python' || rule.kind !== 'function_call_as_import') continue
      const fnName = rule.data['function_name']
      if (typeof fnName !== 'string') continue
      const escaped = fnName.replace(/\./g, '\\.').replace(/[$]/g, '\\$')
      const re = new RegExp(`\\b${escaped}\\s*\\(\\s*['"\`]([^'"\`\\n]+?)['"\`]`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(source)) !== null) {
        const arg = m[1]
        if (!arg) continue
        const targets = resolvePython({ module: arg, names: null }, path.join(root, filePath), root, known, getPyConfig(root))
        for (const t of targets) out.push({ from: filePath, to: t })
      }
    }
    return out
  },

  fingerprint(root) {
    const h = createHash('sha256')
    for (const rel of ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile']) {
      const p = path.join(root, rel)
      try { h.update(rel); h.update(fs.readFileSync(p)) } catch { /* missing */ }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}
