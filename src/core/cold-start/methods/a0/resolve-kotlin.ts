import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RawKotlinImport } from './parse-kotlin.js'

export interface KotlinConfig {
  sourceRoots: string[]
}

export function readKotlinConfig(root: string): KotlinConfig {
  const sourceRoots: string[] = []
  for (const layout of [
    ['src', 'main', 'kotlin'],
    ['src', 'test', 'kotlin'],
    ['src', 'main', 'java'],
    ['src', 'test', 'java'],
    ['src'],
  ]) {
    const c = path.join(root, ...layout)
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) sourceRoots.push(c)
  }
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { entries = [] }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    if (e.name === 'node_modules' || e.name === 'target' || e.name === 'build') continue
    for (const layout of [['src', 'main', 'kotlin'], ['src', 'main', 'java']]) {
      const c = path.join(root, e.name, ...layout)
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) sourceRoots.push(c)
    }
  }
  if (sourceRoots.length === 0) sourceRoots.push(root)
  return { sourceRoots }
}

export function resolveKotlin(
  imp: RawKotlinImport,
  root: string,
  knownFiles: Set<string>,
  config: KotlinConfig,
): string[] {
  if (imp.isWildcard) {
    const pkgPath = imp.qualifiedName.replace(/\./g, '/')
    return findKtFilesInDir(pkgPath, root, knownFiles, config)
  }
  const classPath = imp.qualifiedName.replace(/\./g, '/')
  const direct = findExact(classPath + '.kt', root, knownFiles, config)
  if (direct.length > 0) return direct
  // last segment may be class member; try parent path as file
  const idx = classPath.lastIndexOf('/')
  if (idx > 0) {
    const parent = classPath.slice(0, idx)
    const found = findExact(parent + '.kt', root, knownFiles, config)
    if (found.length > 0) return found
  }
  return []
}

function findExact(relPath: string, root: string, knownFiles: Set<string>, config: KotlinConfig): string[] {
  for (const sr of config.sourceRoots) {
    const cand = path.relative(root, path.join(sr, relPath)).split(path.sep).join('/')
    if (!cand.startsWith('..') && knownFiles.has(cand)) return [cand]
  }
  return []
}

function findKtFilesInDir(relDir: string, root: string, knownFiles: Set<string>, config: KotlinConfig): string[] {
  for (const sr of config.sourceRoots) {
    const baseDir = path.relative(root, path.join(sr, relDir)).split(path.sep).join('/')
    if (baseDir.startsWith('..')) continue
    const prefix = baseDir + '/'
    const out: string[] = []
    for (const f of knownFiles) {
      if (!f.endsWith('.kt')) continue
      if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length)
        if (!rest.includes('/')) out.push(f)
      }
    }
    if (out.length > 0) return out
  }
  return []
}
