import * as fs from 'node:fs'
import * as path from 'node:path'

const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out',
  'coverage', 'vendor', 'target', '__pycache__',
])

export function scanFiles(root: string, extensions: Set<string>): string[] {
  const out: string[] = []
  walk(root, root, extensions, out)
  return out.sort()
}

function walk(rootDir: string, currentDir: string, exts: Set<string>, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue
      walk(rootDir, path.join(currentDir, entry.name), exts, out)
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.')
      if (dot < 0) continue
      const ext = entry.name.slice(dot).toLowerCase()
      if (exts.has(ext)) {
        out.push(path.relative(rootDir, path.join(currentDir, entry.name)))
      }
    }
  }
}
