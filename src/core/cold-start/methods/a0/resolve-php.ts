import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RawPhpImport } from './parse-php.js'

export interface PhpConfig {
  psr4: Array<{ prefix: string; dirs: string[] }>
}

export function readPhpConfig(root: string): PhpConfig {
  const p = path.join(root, 'composer.json')
  if (!fs.existsSync(p)) return { psr4: [] }
  let parsed: unknown
  try { parsed = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return { psr4: [] } }
  const obj = parsed as Record<string, unknown>
  const psr4: PhpConfig['psr4'] = []
  for (const key of ['autoload', 'autoload-dev']) {
    const a = obj[key] as Record<string, unknown> | undefined
    const map = a?.['psr-4'] as Record<string, unknown> | undefined
    if (!map) continue
    for (const [prefix, value] of Object.entries(map)) {
      const norm = prefix.replace(/\\$/, '')
      const dirs = Array.isArray(value) ? value as string[] : [String(value)]
      psr4.push({ prefix: norm, dirs })
    }
  }
  psr4.sort((a, b) => b.prefix.length - a.prefix.length)
  return { psr4 }
}

export function resolvePhp(
  imp: RawPhpImport,
  fromFile: string,
  root: string,
  knownFiles: Set<string>,
  config: PhpConfig,
): string[] {
  if (imp.kind === 'require') {
    const fromDir = path.dirname(path.join(root, fromFile))
    const stripped = imp.path.replace(/^\/+/, '')
    const candidates = [
      path.resolve(fromDir, stripped),
      path.resolve(root, stripped),
    ]
    for (const c of candidates) {
      const rel = absToRel(c, root)
      if (rel && knownFiles.has(rel)) return [rel]
    }
    return []
  }
  // use: PSR-4
  const qn = imp.path.replace(/^\\/, '').replace(/\\/g, '\\')
  const segs = qn.split('\\').filter((s) => s.length > 0)
  const fqn = segs.join('\\')
  for (const entry of config.psr4) {
    if (entry.prefix === '' || fqn.startsWith(entry.prefix + '\\') || fqn === entry.prefix) {
      const rest = entry.prefix === '' ? fqn : fqn.slice(entry.prefix.length).replace(/^\\/, '')
      const restPath = rest.split('\\').join('/')
      for (const dir of entry.dirs) {
        const cand = path.join(root, dir, restPath + '.php')
        const rel = absToRel(cand, root)
        if (rel && knownFiles.has(rel)) return [rel]
      }
    }
  }
  return []
}

function absToRel(absPath: string, root: string): string | null {
  const rel = path.relative(root, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}
