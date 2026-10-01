import * as fs from 'node:fs'
import * as path from 'node:path'
import { scanFiles } from './scan.js'
import type { RawCsImport } from './parse-csharp.js'

export interface CsConfig {
  namespaceMap: Map<string, string[]>
}

export function readCsConfig(root: string): CsConfig {
  const namespaceMap = new Map<string, string[]>()
  const files = scanFiles(root, new Set(['.cs']))
  for (const rel of files) {
    let src: string
    try { src = fs.readFileSync(path.join(root, rel), 'utf8') } catch { continue }
    const matches = src.matchAll(/^\s*namespace\s+([\w.]+)\s*[;{]/gm)
    for (const m of matches) {
      const ns = m[1]
      if (!ns) continue
      const arr = namespaceMap.get(ns) ?? []
      if (!arr.includes(rel)) arr.push(rel)
      namespaceMap.set(ns, arr)
    }
  }
  return { namespaceMap }
}

export function resolveCs(
  imp: RawCsImport,
  _root: string,
  knownFiles: Set<string>,
  config: CsConfig,
): string[] {
  const targets = config.namespaceMap.get(imp.qualifiedName) ?? []
  return targets.filter((t) => knownFiles.has(t))
}
