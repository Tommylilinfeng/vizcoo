import type Database from 'better-sqlite3'
import type { HeuristicModule } from './discover-heuristic.js'

export function listHeuristicModules(db: Database.Database): HeuristicModule[] {
  const rows = db.prepare(
    "SELECT id, name, key_exports, dir_paths FROM modules WHERE origin = 'heuristic'",
  ).all() as Array<{ id: number; name: string; key_exports: string | null; dir_paths: string | null }>
  const filesByModule = db.prepare('SELECT path FROM files WHERE module_id = ? ORDER BY path')
  const out: HeuristicModule[] = []
  for (const row of rows) {
    const files = (filesByModule.all(row.id) as Array<{ path: string }>).map((r) => r.path)
    out.push({
      name: row.name,
      dirs: row.dir_paths ? (JSON.parse(row.dir_paths) as string[]) : [row.name],
      files,
      keyExports: row.key_exports ? (JSON.parse(row.key_exports) as string[]) : [],
    })
  }
  out.sort((a, b) => b.files.length - a.files.length)
  return out
}
