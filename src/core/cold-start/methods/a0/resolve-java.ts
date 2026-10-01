import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RawJavaImport } from './parse-java.js'

export interface JavaConfig {
  sourceRoots: string[]
}

export function readJavaConfig(root: string): JavaConfig {
  const sourceRoots: string[] = []
  for (const layout of [['src', 'main', 'java'], ['src', 'test', 'java'], ['src']]) {
    const c = path.join(root, ...layout)
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) sourceRoots.push(c)
  }
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { entries = [] }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    if (e.name === 'node_modules' || e.name === 'target' || e.name === 'build') continue
    for (const layout of [['src', 'main', 'java'], ['src', 'test', 'java']]) {
      const c = path.join(root, e.name, ...layout)
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) sourceRoots.push(c)
    }
  }
  if (sourceRoots.length === 0) sourceRoots.push(root)
  return { sourceRoots }
}

export function resolveJava(
  imp: RawJavaImport,
  root: string,
  knownFiles: Set<string>,
  config: JavaConfig,
): string[] {
  if (imp.isWildcard) {
    const pkgPath = imp.qualifiedName.replace(/\./g, '/')
    return findJavaFilesInDir(pkgPath, root, knownFiles, config)
  }
  const classPath = imp.qualifiedName.replace(/\./g, '/') + '.java'
  return findExactJavaFile(classPath, root, knownFiles, config)
}

function findExactJavaFile(relPath: string, root: string, knownFiles: Set<string>, config: JavaConfig): string[] {
  for (const sourceRoot of config.sourceRoots) {
    const candidate = path.join(sourceRoot, relPath)
    const rel = path.relative(root, candidate)
    if (!rel.startsWith('..') && knownFiles.has(rel)) return [rel]
  }
  return []
}

function findJavaFilesInDir(relDir: string, root: string, knownFiles: Set<string>, config: JavaConfig): string[] {
  for (const sourceRoot of config.sourceRoots) {
    const candidateDir = path.join(sourceRoot, relDir)
    const relDirFull = path.relative(root, candidateDir)
    if (relDirFull.startsWith('..')) continue
    const prefix = relDirFull + path.sep
    const out: string[] = []
    for (const f of knownFiles) {
      if (!f.endsWith('.java')) continue
      if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length)
        if (!rest.includes('/')) out.push(f)
      }
    }
    if (out.length > 0) return out
  }
  return []
}
