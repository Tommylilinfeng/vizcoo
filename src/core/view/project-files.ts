import * as fs from 'node:fs'
import * as path from 'node:path'
import type { FileNode } from './types.js'

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.vizcoo', '.ctx', '.turbo'])
const INCLUDE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.css', '.html', '.yml', '.yaml', '.toml', '.sh'])
const MAX_FILES = 500

export function scanProjectFiles(projectRoot: string): FileNode[] {
  const out: FileNode[] = []
  walk(projectRoot, '', out)
  return out.sort((a, b) => (a.folder !== b.folder ? (a.folder < b.folder ? -1 : 1) : (a.basename < b.basename ? -1 : 1)))
}

function walk(absRoot: string, relDir: string, out: FileNode[]): void {
  if (out.length >= MAX_FILES) return
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(path.join(absRoot, relDir), { withFileTypes: true }) }
  catch { return }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return
    if (e.name.startsWith('.') && e.name !== '.gitignore') continue
    if (IGNORE_DIRS.has(e.name)) continue
    const childRel = relDir ? `${relDir}/${e.name}` : e.name
    if (e.isDirectory()) { walk(absRoot, childRel, out); continue }
    if (!e.isFile()) continue
    const ext = path.extname(e.name).toLowerCase()
    if (!INCLUDE_EXT.has(ext)) continue
    out.push({ path: childRel, folder: relDir, basename: e.name })
  }
}
