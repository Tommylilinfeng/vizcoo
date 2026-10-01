import type Database from 'better-sqlite3'
import type { HeuristicModule } from './discover-heuristic.js'
import { getOrCreateTierAtPosition } from './tier-ops.js'

export function applyStaticFallback(db: Database.Database, modules: HeuristicModule[]): void {
  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    const existing = db.prepare(
      "SELECT id, name FROM modules WHERE origin = 'aggregate' AND locked = 0",
    ).all() as Array<{ id: number; name: string }>
    const existingByName = new Map(existing.map((r) => [r.name, r.id]))

    const wantedNames = new Set<string>()
    const insertMega = db.prepare(
      "INSERT INTO modules (parent_id, name, display_name, description, origin, created_at, key_exports, dir_paths, tier_id) " +
      "VALUES (NULL, ?, NULL, NULL, 'aggregate', ?, NULL, NULL, ?)",
    )
    const updateDetail = db.prepare(
      "UPDATE modules SET parent_id = ? WHERE name = ? AND origin = 'heuristic' AND locked = 0",
    )

    const idBySeg = new Map<string, number>()
    let tierIdx = 0
    for (const mod of modules) {
      const seg = firstSegment(mod.name)
      const cap = seg === '.' ? 'Root' : seg.charAt(0).toUpperCase() + seg.slice(1)
      wantedNames.add(cap)
      let megaId = idBySeg.get(seg)
      if (megaId === undefined) {
        const found = existingByName.get(cap)
        if (found !== undefined) {
          megaId = found
        } else {
          const tierId = getOrCreateTierAtPosition(db, tierIdx, now)
          const info = insertMega.run(cap, now, tierId)
          megaId = info.lastInsertRowid as number
        }
        idBySeg.set(seg, megaId)
        tierIdx++
      }
      updateDetail.run(megaId, mod.name)
    }

    for (const row of existing) {
      if (wantedNames.has(row.name)) continue
      db.prepare("UPDATE modules SET parent_id = NULL WHERE parent_id = ?").run(row.id)
      db.prepare("DELETE FROM modules WHERE id = ?").run(row.id)
    }
  })
  tx()
}

function firstSegment(name: string): string {
  const slash = name.indexOf('/')
  return slash < 0 ? name : name.slice(0, slash)
}
