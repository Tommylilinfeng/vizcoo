import type Database from 'better-sqlite3'

export interface TierRow {
  id: number
  name: string | null
  position: number
}

export function listTiers(db: Database.Database): TierRow[] {
  return db.prepare('SELECT id, name, position FROM tiers ORDER BY position').all() as TierRow[]
}

export function getOrCreateTierAtPosition(db: Database.Database, position: number, now: string): number {
  const existing = db.prepare('SELECT id FROM tiers WHERE position = ?').get(position) as { id: number } | undefined
  if (existing) return existing.id
  const info = db.prepare('INSERT INTO tiers (name, position, created_at) VALUES (NULL, ?, ?)').run(position, now)
  return info.lastInsertRowid as number
}

export function insertTier(db: Database.Database, params: { position?: number; name?: string | null }): TierRow {
  const now = new Date().toISOString()
  let position = params.position
  if (position === undefined) {
    const max = (db.prepare('SELECT MAX(position) AS p FROM tiers').get() as { p: number | null }).p
    position = max === null ? 0 : max + 1
  } else {
    db.prepare('UPDATE tiers SET position = position + 1 WHERE position >= ?').run(position)
  }
  const info = db.prepare('INSERT INTO tiers (name, position, created_at) VALUES (?, ?, ?)').run(params.name ?? null, position, now)
  const id = info.lastInsertRowid as number
  return { id, name: params.name ?? null, position }
}

export function patchTier(db: Database.Database, id: number, params: { name?: string | null; position?: number }): void {
  const target = db.prepare('SELECT id, position FROM tiers WHERE id = ?').get(id) as { id: number; position: number } | undefined
  if (!target) throw new Error(`tier ${id} not found`)
  if (params.position !== undefined && params.position !== target.position) {
    const conflict = db.prepare('SELECT id FROM tiers WHERE position = ? AND id != ?').get(params.position, id) as { id: number } | undefined
    if (conflict) {
      const fromPos = target.position
      const toPos = params.position
      db.prepare('UPDATE tiers SET position = -1 WHERE id = ?').run(id)
      if (toPos > fromPos) {
        db.prepare('UPDATE tiers SET position = position - 1 WHERE position > ? AND position <= ?').run(fromPos, toPos)
      } else {
        db.prepare('UPDATE tiers SET position = position + 1 WHERE position >= ? AND position < ?').run(toPos, fromPos)
      }
      db.prepare('UPDATE tiers SET position = ? WHERE id = ?').run(toPos, id)
    } else {
      db.prepare('UPDATE tiers SET position = ? WHERE id = ?').run(params.position, id)
    }
  }
  if (params.name !== undefined) {
    db.prepare('UPDATE tiers SET name = ? WHERE id = ?').run(params.name, id)
  }
}

export function deleteTier(db: Database.Database, id: number): { orphaned: number } {
  const target = db.prepare('SELECT id FROM tiers WHERE id = ?').get(id) as { id: number } | undefined
  if (!target) throw new Error(`tier ${id} not found`)
  const orphans = db.prepare('SELECT COUNT(*) AS n FROM modules WHERE tier_id = ?').get(id) as { n: number }
  const tx = db.transaction(() => {
    db.prepare('UPDATE modules SET tier_id = NULL WHERE tier_id = ?').run(id)
    db.prepare('DELETE FROM tiers WHERE id = ?').run(id)
  })
  tx()
  return { orphaned: orphans.n }
}
