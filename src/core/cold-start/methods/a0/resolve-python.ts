import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RawPythonImport } from './parse-python.js'

export interface PyConfig {
  sourceRoots: string[]
}

export function readPyConfig(root: string): PyConfig {
  const sourceRoots = [root]
  const srcDir = path.join(root, 'src')
  if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
    sourceRoots.push(srcDir)
  }
  return { sourceRoots }
}

export function resolvePython(
  imp: RawPythonImport,
  fromFile: string,
  root: string,
  knownFiles: Set<string>,
  config: PyConfig,
): string[] {
  if (imp.module.startsWith('.')) {
    return resolveRelative(imp, fromFile, root, knownFiles)
  }
  return resolveAbsolute(imp, root, knownFiles, config)
}

function resolveRelative(imp: RawPythonImport, fromFile: string, root: string, knownFiles: Set<string>): string[] {
  const dots = imp.module.match(/^\.+/)?.[0] ?? ''
  const rest = imp.module.slice(dots.length)
  let baseDir = path.dirname(fromFile)
  for (let i = 1; i < dots.length; i++) baseDir = path.dirname(baseDir)
  if (rest) return tryModule(baseDir, rest, root, knownFiles)
  if (imp.names && imp.names.length > 0) {
    const out: string[] = []
    for (const name of imp.names) {
      if (name === '*') {
        const init = absToRel(path.join(baseDir, '__init__.py'), root)
        if (init && knownFiles.has(init)) out.push(init)
      } else {
        out.push(...tryModule(baseDir, name, root, knownFiles))
      }
    }
    return out
  }
  return tryModule(baseDir, '', root, knownFiles)
}

function resolveAbsolute(imp: RawPythonImport, root: string, knownFiles: Set<string>, config: PyConfig): string[] {
  for (const sourceRoot of config.sourceRoots) {
    if (imp.names && imp.names.length > 0) {
      const submoduleTargets: string[] = []
      for (const name of imp.names) {
        if (name === '*') continue
        submoduleTargets.push(...tryModule(sourceRoot, imp.module + '.' + name, root, knownFiles))
      }
      if (submoduleTargets.length > 0) return submoduleTargets
    }
    const found = tryModule(sourceRoot, imp.module, root, knownFiles)
    if (found.length > 0) return found
  }
  return []
}

function tryModule(baseAbsDir: string, dottedName: string, root: string, knownFiles: Set<string>): string[] {
  if (!dottedName) {
    const rel = absToRel(path.join(baseAbsDir, '__init__.py'), root)
    if (rel && knownFiles.has(rel)) return [rel]
    return []
  }
  const parts = dottedName.split('.')
  const asPath = path.join(baseAbsDir, ...parts)
  const relPy = absToRel(asPath + '.py', root)
  if (relPy && knownFiles.has(relPy)) return [relPy]
  const relInit = absToRel(path.join(asPath, '__init__.py'), root)
  if (relInit && knownFiles.has(relInit)) return [relInit]
  return []
}

function absToRel(absPath: string, root: string): string | null {
  const rel = path.relative(root, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel
}
