import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RawDartImport } from './parse-dart.js'

export interface DartConfig {
  packageName: string | null
}

export function readDartConfig(root: string): DartConfig {
  const p = path.join(root, 'pubspec.yaml')
  if (!fs.existsSync(p)) return { packageName: null }
  let text: string
  try { text = fs.readFileSync(p, 'utf8') } catch { return { packageName: null } }
  const m = text.match(/^name:\s*(\S+)/m)
  return { packageName: m?.[1] ?? null }
}

export function resolveDart(
  imp: RawDartImport,
  fromFile: string,
  root: string,
  knownFiles: Set<string>,
  config: DartConfig,
): string[] {
  if (imp.isPackage) {
    const m = imp.path.match(/^package:([^/]+)\/(.+)$/)
    if (!m) return []
    const [, pkg, rest] = m
    if (config.packageName && pkg === config.packageName) {
      const cand = `lib/${rest}`
      if (knownFiles.has(cand)) return [cand]
    }
    return []
  }
  const fromDir = path.dirname(fromFile)
  const cand = path.join(fromDir, imp.path).split(path.sep).join('/')
  if (knownFiles.has(cand)) return [cand]
  return []
}
