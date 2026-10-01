import type Database from 'better-sqlite3'
import type { AggregationResult } from './discover-llm.js'
import { writeMeta } from './meta.js'
import { getOrCreateTierAtPosition } from './tier-ops.js'

export function applyAggregation(
  db: Database.Database,
  result: AggregationResult,
  fingerprint: string,
): void {
  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    const existing = db.prepare(
      "SELECT id, name, locked FROM modules WHERE origin = 'aggregate'",
    ).all() as Array<{ id: number; name: string; locked: number }>
    const existingByName = new Map<string, { id: number; locked: number }>()
    for (const row of existing) {
      const prev = existingByName.get(row.name)
      if (!prev || row.locked > prev.locked) existingByName.set(row.name, { id: row.id, locked: row.locked })
    }

    const insertMega = db.prepare(
      "INSERT INTO modules (parent_id, name, display_name, description, origin, created_at, key_exports, dir_paths, tier_id) " +
      "VALUES (NULL, ?, NULL, ?, 'aggregate', ?, NULL, NULL, ?)",
    )
    const updateMega = db.prepare("UPDATE modules SET description = ?, tier_id = ? WHERE id = ?")

    const megaIdByName = new Map<string, number>()
    for (let i = 0; i < result.megaModules.length; i++) {
      const mega = result.megaModules[i]!
      const tierId = getOrCreateTierAtPosition(db, i, now)
      const found = existingByName.get(mega.name)
      if (found !== undefined) {
        if (found.locked === 0) updateMega.run(mega.description, tierId, found.id)
        megaIdByName.set(mega.name, found.id)
      } else {
        const info = insertMega.run(mega.name, mega.description, now, tierId)
        megaIdByName.set(mega.name, info.lastInsertRowid as number)
      }
    }

    const usedIds = new Set(megaIdByName.values())
    for (const row of existing) {
      if (usedIds.has(row.id)) continue
      if (row.locked === 1) continue
      db.prepare("UPDATE modules SET parent_id = NULL WHERE parent_id = ?").run(row.id)
      db.prepare("DELETE FROM modules WHERE id = ?").run(row.id)
    }

    const detailToMega = new Map<string, number | null>()
    for (const mega of result.megaModules) {
      const id = megaIdByName.get(mega.name)!
      for (const c of mega.contains) detailToMega.set(c, id)
    }

    const reparentDetail = db.prepare(
      "UPDATE modules SET parent_id = ? WHERE name = ? AND origin = 'heuristic' AND (parent_id IS NULL OR parent_id IN (SELECT id FROM modules WHERE origin = 'aggregate' AND locked = 0))",
    )
    const renameDetail = db.prepare(
      "UPDATE modules SET display_name = ?, description = ? WHERE name = ? AND origin = 'heuristic' AND locked = 0",
    )
    for (const d of result.modules) {
      const megaId = detailToMega.get(d.heuristicName) ?? null
      reparentDetail.run(megaId, d.heuristicName)
      renameDetail.run(d.name, d.description, d.heuristicName)
    }

    db.exec(
      "DELETE FROM modules WHERE origin IN ('split', 'aggregate') " +
      "AND NOT EXISTS (SELECT 1 FROM modules c WHERE c.parent_id = modules.id) " +
      "AND NOT EXISTS (SELECT 1 FROM files f WHERE f.module_id = modules.id)",
    )

    writeMeta(db, 'aggregation_fingerprint', fingerprint)
    writeMeta(db, 'aggregation_result', JSON.stringify(result))
  })
  tx()
}
