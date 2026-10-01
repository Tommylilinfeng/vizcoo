import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { Edge } from '../../core/pipeline/types.js'
import { extractJavaImports } from '../../core/cold-start/methods/a0/parse-java.js'
import { readJavaConfig, resolveJava, type JavaConfig } from '../../core/cold-start/methods/a0/resolve-java.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.java'])

let javaConfigCache: { root: string; value: JavaConfig } | null = null
function getJavaConfig(root: string): JavaConfig {
  if (!javaConfigCache || javaConfigCache.root !== root) {
    javaConfigCache = { root, value: readJavaConfig(root) }
  }
  return javaConfigCache.value
}

function javaResolve(spec: string, _fromFile: string, root: string, known: Set<string>): string[] {
  const isWildcard = spec.endsWith('.*')
  const qn = isWildcard ? spec.slice(0, -2) : spec
  return resolveJava({ qualifiedName: qn, isWildcard, isStatic: false }, root, known, getJavaConfig(root))
}

export const javaAnalyzer: LanguageAnalyzer = {
  id: 'java',
  ignorePatterns: ['target', 'build', 'out', '.gradle', '.idea'],
  frameworkDetectors: [],
  init: () => Promise.resolve(),

  canHandle(filePath) {
    const dot = filePath.lastIndexOf('.')
    return dot >= 0 && EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root) { return scanFiles(root, EXTS) },

  async extractImports(source) {
    return extractJavaImports(source).map((raw) => ({
      spec: raw.isWildcard ? raw.qualifiedName + '.*' : raw.qualifiedName,
      isTypeOnly: false,
    }))
  },

  extractSymbols: () => [],

  resolvePrimary: javaResolve,
  resolveSecondary: javaResolve,

  applyConventionRules(rules, source, filePath, root, known) {
    const out: Edge[] = []
    for (const rule of rules) {
      if (rule.analyzerId !== 'java' || rule.kind !== 'function_call_as_import') continue
      const fnName = rule.data['function_name']
      if (typeof fnName !== 'string') continue
      const escaped = fnName.replace(/\./g, '\\.').replace(/[$]/g, '\\$')
      const re = new RegExp(`\\b${escaped}\\s*\\(\\s*['"\`]([^'"\`\\n]+?)['"\`]`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(source)) !== null) {
        const arg = m[1]
        if (!arg) continue
        for (const t of javaResolve(arg, filePath, root, known)) out.push({ from: filePath, to: t })
      }
    }
    return out
  },

  fingerprint(root) {
    const h = createHash('sha256')
    for (const rel of ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']) {
      const p = path.join(root, rel)
      try { h.update(rel); h.update(fs.readFileSync(p)) } catch { /* missing */ }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}
