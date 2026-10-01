import * as path from 'node:path'
import type { FileNode, Turn } from './types.js'

export interface NormalizedView {
  files: FileNode[]
  turns: Turn[]
}

export function buildView(turns: Turn[]): NormalizedView {
  const allPaths = new Set<string>()
  for (const t of turns) for (const c of t.fileChanges) allPaths.add(c.path)
  const root = commonPrefix([...allPaths])

  const files: FileNode[] = [...allPaths].map((abs) => fileNodeFor(abs, root)).sort(byFolderThenBasename)
  const normalizedTurns: Turn[] = turns.map((t) => ({
    ...t,
    fileChanges: t.fileChanges.map((c) => ({ ...c, path: relativize(c.path, root) })),
  }))

  return { files, turns: normalizedTurns }
}

function fileNodeFor(absolute: string, root: string): FileNode {
  const rel = relativize(absolute, root)
  const folder = path.posix.dirname(rel)
  return { path: rel, folder: folder === '.' ? '' : folder, basename: path.posix.basename(rel) }
}

function relativize(absolute: string, root: string): string {
  if (root && absolute.startsWith(root)) return absolute.slice(root.length).replace(/^\/+/, '')
  return absolute.replace(/^\/+/, '')
}

function commonPrefix(paths: string[]): string {
  if (paths.length === 0) return ''
  let prefix = paths[0]!
  for (const p of paths) {
    while (prefix && !p.startsWith(prefix)) {
      const cut = prefix.lastIndexOf('/')
      prefix = cut > 0 ? prefix.slice(0, cut) : ''
    }
    if (!prefix) return ''
  }
  return prefix.endsWith('/') ? prefix : prefix + '/'
}

function byFolderThenBasename(a: FileNode, b: FileNode): number {
  if (a.folder !== b.folder) return a.folder < b.folder ? -1 : 1
  return a.basename < b.basename ? -1 : 1
}
