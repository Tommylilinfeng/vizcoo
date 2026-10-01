import * as path from 'node:path'
import type { RawRubyImport } from './parse-ruby.js'

export interface RubyConfig {
  loadPaths: string[]   // relative to root
}

export function readRubyConfig(_root: string): RubyConfig {
  return { loadPaths: ['lib', 'app', '.'] }
}

export function resolveRuby(
  imp: RawRubyImport,
  fromFile: string,
  root: string,
  knownFiles: Set<string>,
  config: RubyConfig,
): string[] {
  if (imp.kind === 'require_relative') {
    const fromDir = path.dirname(path.join(root, fromFile))
    return tryFile(path.resolve(fromDir, imp.path), root, knownFiles)
  }
  if (imp.kind === 'load') {
    const fromDir = path.dirname(path.join(root, fromFile))
    return tryFile(path.resolve(fromDir, imp.path), root, knownFiles)
  }
  for (const lp of config.loadPaths) {
    const cand = path.join(root, lp, imp.path)
    const found = tryFile(cand, root, knownFiles)
    if (found.length > 0) return found
  }
  return []
}

function tryFile(absPath: string, root: string, knownFiles: Set<string>): string[] {
  for (const ext of ['', '.rb']) {
    const rel = absToRel(absPath + ext, root)
    if (rel && knownFiles.has(rel)) return [rel]
  }
  return []
}

function absToRel(absPath: string, root: string): string | null {
  const rel = path.relative(root, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}
