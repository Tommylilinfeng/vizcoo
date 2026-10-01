import * as path from 'node:path'
import type { RawLuaImport } from './parse-lua.js'

export interface LuaConfig {
  searchRoots: string[]
}

export function readLuaConfig(_root: string): LuaConfig {
  return { searchRoots: ['.', 'lua', 'src'] }
}

export function resolveLua(
  imp: RawLuaImport,
  fromFile: string,
  root: string,
  knownFiles: Set<string>,
  config: LuaConfig,
): string[] {
  const dotted = imp.path.split('.').filter((s) => s.length > 0)
  if (dotted.length === 0) return []
  const fromDir = path.dirname(fromFile)
  const sub = dotted.join('/')
  const candDirs = [fromDir, ...config.searchRoots]
  for (const dir of candDirs) {
    const base = dir === '.' ? sub : path.join(dir, sub)
    for (const cand of [base + '.lua', path.join(base, 'init.lua')]) {
      const rel = cand.split(path.sep).join('/')
      if (knownFiles.has(rel)) return [rel]
    }
  }
  return []
}
