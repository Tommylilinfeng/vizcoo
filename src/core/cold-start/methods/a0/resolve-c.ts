import * as path from 'node:path'
import type { RawCInclude } from './parse-c.js'

const COMMON_INCLUDE_DIRS = ['include', 'src', 'src/include']

export function resolveC(
  inc: RawCInclude,
  fromFile: string,
  root: string,
  knownFiles: Set<string>,
): string | null {
  if (inc.isSystem) return null
  const baseDir = path.dirname(fromFile)
  const tryRel = absToRel(path.resolve(baseDir, inc.path), root)
  if (tryRel && knownFiles.has(tryRel)) return tryRel
  const fromRoot = absToRel(path.resolve(root, inc.path), root)
  if (fromRoot && knownFiles.has(fromRoot)) return fromRoot
  for (const dir of COMMON_INCLUDE_DIRS) {
    const cand = absToRel(path.resolve(root, dir, inc.path), root)
    if (cand && knownFiles.has(cand)) return cand
  }
  return null
}

function absToRel(absPath: string, root: string): string | null {
  const rel = path.relative(root, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel
}
