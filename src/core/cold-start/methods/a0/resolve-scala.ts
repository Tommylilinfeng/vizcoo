import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RawScalaImport } from './parse-scala.js'

export interface ScalaConfig {
  sourceRoots: string[]
}

export function readScalaConfig(root: string): ScalaConfig {
  const sourceRoots: string[] = []
  for (const layout of [
    ['src', 'main', 'scala'],
    ['src', 'test', 'scala'],
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
    for (const layout of [['src', 'main', 'scala'], ['src', 'test', 'scala']]) {
      const c = path.join(root, e.name, ...layout)
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) sourceRoots.push(c)
    }
  }
  if (sourceRoots.length === 0) sourceRoots.push(root)
  return { sourceRoots }
}

export function resolveScala(
  imp: RawScalaImport,
  root: string,
  knownFiles: Set<string>,
  config: ScalaConfig,
): string[] {
  if (imp.isWildcard) {
    const pkgPath = imp.qualifiedName.replace(/\./g, '/')
    return findFilesInDir(pkgPath, root, knownFiles, config)
  }
  const classPath = imp.qualifiedName.replace(/\./g, '/')
  const direct = findExact(classPath + '.scala', root, knownFiles, config)
  if (direct.length > 0) return direct
  const idx = classPath.lastIndexOf('/')
  if (idx > 0) {
    const parent = classPath.slice(0, idx)
    const found = findExact(parent + '.scala', root, knownFiles, config)
    if (found.length > 0) return found
  }
  return []
}

function findExact(relPath: string, root: string, knownFiles: Set<string>, config: ScalaConfig): string[] {
  for (const sr of config.sourceRoots) {
    const cand = path.relative(root, path.join(sr, relPath)).split(path.sep).join('/')
    if (!cand.startsWith('..') && knownFiles.has(cand)) return [cand]
  }
  return []
}

function findFilesInDir(relDir: string, root: string, knownFiles: Set<string>, config: ScalaConfig): string[] {
  for (const sr of config.sourceRoots) {
    const baseDir = path.relative(root, path.join(sr, relDir)).split(path.sep).join('/')
    if (baseDir.startsWith('..')) continue
    const prefix = baseDir + '/'
    const out: string[] = []
    for (const f of knownFiles) {
      if (!f.endsWith('.scala')) continue
      if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length)
        if (!rest.includes('/')) out.push(f)
      }
    }
    if (out.length > 0) return out
  }
  return []
}
