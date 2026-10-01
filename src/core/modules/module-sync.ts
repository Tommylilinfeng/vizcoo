import type Database from 'better-sqlite3'
import type { HeuristicModule } from './discover-heuristic.js'

export function findOrCreateModule(db: Database.Database, relPath: string): number {
  const twoL = twoLevelDir(relPath)
  const oneL = oneLevelDir(relPath)
  const find = db.prepare("SELECT id FROM modules WHERE name = ? AND origin = 'heuristic'")
  const hitTwo = find.get(twoL) as { id: number } | undefined
  if (hitTwo) return hitTwo.id
  if (oneL !== twoL) {
    const hitOne = find.get(oneL) as { id: number } | undefined
    if (hitOne) return hitOne.id
  }
  const now = new Date().toISOString()
  const info = db.prepare(
    "INSERT INTO modules (parent_id, name, origin, created_at) VALUES (NULL, ?, 'heuristic', ?)",
  ).run(twoL, now)
  return info.lastInsertRowid as number
}

export interface DiffResult {
  added: string[]
  removed: string[]
  kept: string[]
}

export function diffWithHeuristic(db: Database.Database, heuristic: HeuristicModule[]): DiffResult {
  const wantedNames = new Set(heuristic.map((m) => m.name))
  const wantedByName = new Map(heuristic.map((m) => [m.name, m]))
  const existing = db.prepare(
    "SELECT id, name, display_name, description, origin, locked FROM modules WHERE origin = 'heuristic'",
  ).all() as Array<{ id: number; name: string; display_name: string | null; description: string | null; origin: string; locked: number }>
  const existingByName = new Map(existing.map((r) => [r.name, r]))

  const added: string[] = []
  const removed: string[] = []
  const kept: string[] = []

  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    for (const m of heuristic) {
      const found = existingByName.get(m.name)
      if (found) {
        db.prepare(
          "UPDATE modules SET key_exports = ?, dir_paths = ? WHERE id = ?",
        ).run(
          m.keyExports.length > 0 ? JSON.stringify(m.keyExports) : null,
          m.dirs.length > 0 ? JSON.stringify(m.dirs) : null,
          found.id,
        )
        kept.push(m.name)
      } else {
        const info = db.prepare(
          "INSERT INTO modules (parent_id, name, origin, created_at, key_exports, dir_paths) VALUES (NULL, ?, 'heuristic', ?, ?, ?)",
        ).run(
          m.name,
          now,
          m.keyExports.length > 0 ? JSON.stringify(m.keyExports) : null,
          m.dirs.length > 0 ? JSON.stringify(m.dirs) : null,
        )
        const id = info.lastInsertRowid as number
        for (const f of m.files) db.prepare("UPDATE files SET module_id = ? WHERE path = ?").run(id, f)
        added.push(m.name)
      }
    }
    for (const row of existing) {
      if (wantedNames.has(row.name)) continue
      if (row.locked === 1) continue
      const protectedRow = (row.display_name && row.display_name.length > 0) || (row.description && row.description.length > 0)
      if (protectedRow) continue
      db.prepare("UPDATE files SET module_id = NULL WHERE module_id = ?").run(row.id)
      db.prepare("DELETE FROM modules WHERE id = ?").run(row.id)
      removed.push(row.name)
    }
    for (const m of heuristic) {
      const target = existingByName.get(m.name) ?? wantedByName.get(m.name)
      if (!target) continue
      const targetId = 'id' in (target as object) ? (target as { id: number }).id : null
      if (targetId === null) continue
      for (const f of m.files) {
        db.prepare(
          "UPDATE files SET module_id = ? WHERE path = ? AND (module_id IS NULL OR module_id IN (SELECT id FROM modules WHERE origin = 'heuristic' AND locked = 0))",
        ).run(targetId, f)
      }
    }
  })
  tx()

  return { added, removed, kept }
}

function twoLevelDir(rel: string): string {
  const parts = rel.split('/')
  if (parts.length >= 3) return parts[0]! + '/' + parts[1]!
  if (parts.length >= 2) return parts[0]!
  return '.'
}

function oneLevelDir(rel: string): string {
  const slash = rel.indexOf('/')
  return slash < 0 ? '.' : rel.slice(0, slash)
}
