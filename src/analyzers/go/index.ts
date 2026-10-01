import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { LanguageAnalyzer } from '../../core/plugin-api/analyzer.js'
import type { Edge } from '../../core/pipeline/types.js'
import { extractGoImports } from '../../core/cold-start/methods/a0/parse-go.js'
import { readGoMod, resolveGo, type GoConfig } from '../../core/cold-start/methods/a0/resolve-go.js'
import { scanFiles } from '../../core/cold-start/methods/a0/scan.js'

const EXTS = new Set(['.go'])

const GO_OS_LIST = new Set(['aix','android','darwin','dragonfly','freebsd','illumos','ios','js','linux','netbsd','openbsd','plan9','solaris','wasip1','windows'])
const GO_ARCH_LIST = new Set(['386','amd64','arm','arm64','loong64','mips','mips64','mips64le','mipsle','ppc64','ppc64le','riscv64','s390x','wasm'])
const HOST_OS = process.platform === 'darwin' ? 'darwin'
  : process.platform === 'linux' ? 'linux'
  : process.platform === 'win32' ? 'windows'
  : process.platform
const HOST_ARCH = process.arch === 'arm64' ? 'arm64'
  : process.arch === 'x64' ? 'amd64'
  : process.arch

function matchesHostBuildTag(filePath: string): boolean {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1).replace(/\.go$/, '')
  const m = base.match(/_([a-z0-9]+)(?:_([a-z0-9]+))?$/)
  if (!m) return true
  const seg1 = m[1]!
  const seg2 = m[2]
  if (seg2 && GO_OS_LIST.has(seg1) && GO_ARCH_LIST.has(seg2)) {
    return seg1 === HOST_OS && seg2 === HOST_ARCH
  }
  if (GO_OS_LIST.has(seg1)) return seg1 === HOST_OS
  if (GO_ARCH_LIST.has(seg1)) return seg1 === HOST_ARCH
  return true
}

let goConfigCache: { root: string; value: GoConfig } | null = null
function getGoConfig(root: string): GoConfig {
  if (!goConfigCache || goConfigCache.root !== root) {
    goConfigCache = { root, value: readGoMod(root) }
  }
  return goConfigCache.value
}

function goResolve(spec: string, _fromFile: string, root: string, known: Set<string>): string[] {
  return resolveGo(spec, root, known, getGoConfig(root))
}

export const goAnalyzer: LanguageAnalyzer = {
  id: 'go',
  ignorePatterns: ['vendor', 'bin'],
  frameworkDetectors: [],
  init: () => Promise.resolve(),

  canHandle(filePath) {
    const dot = filePath.lastIndexOf('.')
    return dot >= 0 && EXTS.has(filePath.slice(dot).toLowerCase())
  },

  discoverFiles(root) { return scanFiles(root, EXTS).filter(matchesHostBuildTag) },

  async extractImports(source) {
    return extractGoImports(source).map((raw) => ({ spec: raw.path, isTypeOnly: false }))
  },

  extractSymbols: () => [],

  resolvePrimary: goResolve,
  resolveSecondary: goResolve,

  applyConventionRules(rules, source, filePath, root, known) {
    const out: Edge[] = []
    for (const rule of rules) {
      if (rule.analyzerId !== 'go' || rule.kind !== 'function_call_as_import') continue
      const fnName = rule.data['function_name']
      if (typeof fnName !== 'string') continue
      const escaped = fnName.replace(/\./g, '\\.').replace(/[$]/g, '\\$')
      const re = new RegExp(`\\b${escaped}\\s*\\(\\s*['"\`]([^'"\`\\n]+?)['"\`]`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(source)) !== null) {
        const arg = m[1]
        if (!arg) continue
        for (const t of resolveGo(arg, root, known, getGoConfig(root))) out.push({ from: filePath, to: t })
      }
    }
    return out
  },

  fingerprint(root) {
    const h = createHash('sha256')
    for (const rel of ['go.mod', 'go.sum']) {
      const p = path.join(root, rel)
      try { h.update(rel); h.update(fs.readFileSync(p)) } catch { /* missing */ }
    }
    return 'sha256:' + h.digest('hex').slice(0, 16)
  },
}
