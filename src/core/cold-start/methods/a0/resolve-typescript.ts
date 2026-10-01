import * as fs from 'node:fs'
import * as path from 'node:path'

export interface TsConfigPaths {
  baseUrl: string
  paths: Record<string, string[]>
}

const TS_RESOLUTION_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs']

export function readTsConfig(root: string): TsConfigPaths | null {
  const configPath = path.join(root, 'tsconfig.json')
  if (!fs.existsSync(configPath)) return null
  let text: string
  try {
    text = fs.readFileSync(configPath, 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonComments(text))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const co = (parsed as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {}
  const baseUrl = path.resolve(root, typeof co.baseUrl === 'string' ? co.baseUrl : '.')
  const rawPaths = co.paths
  const paths: Record<string, string[]> = {}
  if (rawPaths && typeof rawPaths === 'object') {
    for (const [k, v] of Object.entries(rawPaths as Record<string, unknown>)) {
      if (Array.isArray(v) && v.every((t) => typeof t === 'string')) {
        paths[k] = v as string[]
      }
    }
  }
  return { baseUrl, paths }
}

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/,(\s*[}\]])/g, '$1')
}

export interface WorkspaceEntry {
  name: string
  packageDir: string
  entryFile: string
}

const workspaceCache = new Map<string, WorkspaceEntry[]>()

export function readWorkspaces(root: string, knownFiles: Set<string>): WorkspaceEntry[] {
  const cached = workspaceCache.get(root)
  if (cached) return cached
  const out: WorkspaceEntry[] = []
  const pkgPaths = walkForPackageJson(root)
  for (const pkgPath of pkgPaths) {
    let pkg: Record<string, unknown>
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown> } catch { continue }
    const name = pkg['name']
    if (typeof name !== 'string') continue
    const dir = path.dirname(pkgPath)
    const entryFile = resolveEntryFile(pkg, dir, root, knownFiles)
    if (entryFile) {
      const packageDir = path.relative(root, dir).split(path.sep).join('/')
      out.push({ name, packageDir, entryFile })
    }
  }
  workspaceCache.set(root, out)
  return out
}

function walkForPackageJson(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage', '.vizcoo'])
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      if (IGNORE.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile() && e.name === 'package.json') out.push(full)
    }
  }
  return out
}

function resolveEntryFile(pkg: Record<string, unknown>, dir: string, root: string, knownFiles: Set<string>): string | null {
  const candidates: string[] = []
  if (typeof pkg['main'] === 'string') candidates.push(pkg['main'] as string)
  if (typeof pkg['module'] === 'string') candidates.push(pkg['module'] as string)
  if (typeof pkg['types'] === 'string') candidates.push(pkg['types'] as string)
  const exports = pkg['exports']
  if (exports && typeof exports === 'object' && !Array.isArray(exports)) {
    const dot = (exports as Record<string, unknown>)['.']
    if (typeof dot === 'string') candidates.push(dot)
    else if (dot && typeof dot === 'object' && !Array.isArray(dot)) {
      for (const v of Object.values(dot as Record<string, unknown>)) {
        if (typeof v === 'string') candidates.push(v)
      }
    }
  }
  candidates.push('src/index.ts', 'src/index.tsx', 'src/index.js', 'index.ts', 'index.tsx', 'index.js', 'lib/index.ts', 'lib/index.js')
  for (const c of candidates) {
    const result = resolveAbsolute(path.resolve(dir, c), root, knownFiles)
    if (result) return result
  }
  return null
}

export function resolveSpecifier(
  specifier: string,
  fromFile: string,
  root: string,
  knownFiles: Set<string>,
  tsConfig: TsConfigPaths | null,
): string | null {
  if (specifier.startsWith('.')) {
    const baseDir = path.dirname(fromFile)
    return resolveAbsolute(path.resolve(baseDir, specifier), root, knownFiles)
  }
  if (path.isAbsolute(specifier)) {
    return resolveAbsolute(specifier, root, knownFiles)
  }
  const workspaces = readWorkspaces(root, knownFiles)
  for (const ws of workspaces) {
    if (specifier === ws.name) return ws.entryFile
    if (specifier.startsWith(ws.name + '/')) {
      const rest = specifier.slice(ws.name.length + 1)
      const cand = ws.packageDir === '' ? rest : path.posix.join(ws.packageDir, rest)
      const result = resolveAbsolute(path.resolve(root, cand), root, knownFiles)
      if (result) return result
    }
  }
  if (tsConfig) {
    for (const [pattern, targets] of Object.entries(tsConfig.paths)) {
      const candidates = applyPathPattern(pattern, targets, specifier, tsConfig.baseUrl)
      for (const cand of candidates) {
        const result = resolveAbsolute(cand, root, knownFiles)
        if (result) return result
      }
    }
  }
  return null
}

function applyPathPattern(pattern: string, targets: string[], specifier: string, baseUrl: string): string[] {
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1)
    if (specifier.startsWith(prefix)) {
      const rest = specifier.slice(prefix.length)
      return targets.map((t) => path.resolve(baseUrl, t.replace(/\*$/, rest)))
    }
  } else if (pattern === specifier) {
    return targets.map((t) => path.resolve(baseUrl, t))
  }
  return []
}

function resolveAbsolute(absSpecifier: string, root: string, knownFiles: Set<string>): string | null {
  const direct = absToRel(absSpecifier, root)
  if (direct && knownFiles.has(direct)) return direct
  const stripped = stripKnownExt(absSpecifier)
  if (stripped !== absSpecifier) {
    for (const ext of TS_RESOLUTION_EXTS) {
      const swap = absToRel(stripped + ext, root)
      if (swap && knownFiles.has(swap)) return swap
    }
  }
  for (const ext of TS_RESOLUTION_EXTS) {
    const withExt = absToRel(absSpecifier + ext, root)
    if (withExt && knownFiles.has(withExt)) return withExt
  }
  for (const ext of TS_RESOLUTION_EXTS) {
    const indexPath = absToRel(path.join(absSpecifier, 'index' + ext), root)
    if (indexPath && knownFiles.has(indexPath)) return indexPath
  }
  return null
}

const KNOWN_EXTS_FOR_STRIP = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']
function stripKnownExt(p: string): string {
  for (const ext of KNOWN_EXTS_FOR_STRIP) {
    if (p.endsWith(ext)) return p.slice(0, -ext.length)
  }
  return p
}

function absToRel(absPath: string, root: string): string | null {
  const rel = path.relative(root, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel
}
