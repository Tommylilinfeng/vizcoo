import type Database from 'better-sqlite3'

export type Direction = 'a_to_b' | 'b_to_a' | 'both' | 'shared'
export type Category = 'depends' | 'shares' | 'observes' | 'contracts'

export interface ModuleRelation {
  id: number
  moduleAId: number
  moduleBId: number
  direction: Direction
  category: Category
  label: string
  summary: string
  evidenceFiles: string[]
  fingerprint: string
  fingerprintCurrent: string | null
  manualOverride: boolean
  createdAt: string
  updatedAt: string
}

interface Row {
  id: number
  module_a_id: number
  module_b_id: number
  direction: Direction
  category: Category
  label: string
  summary: string
  evidence_files: string
  fingerprint: string
  fingerprint_current: string | null
  manual_override: number
  created_at: string
  updated_at: string
}

const fromRow = (r: Row): ModuleRelation => ({
  id: r.id,
  moduleAId: r.module_a_id,
  moduleBId: r.module_b_id,
  direction: r.direction,
  category: r.category,
  label: r.label,
  summary: r.summary,
  evidenceFiles: JSON.parse(r.evidence_files) as string[],
  fingerprint: r.fingerprint,
  fingerprintCurrent: r.fingerprint_current,
  manualOverride: r.manual_override !== 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function listRelations(db: Database.Database): ModuleRelation[] {
  return (db.prepare('SELECT * FROM module_relations ORDER BY id').all() as Row[]).map(fromRow)
}

export function getRelation(db: Database.Database, a: number, b: number): ModuleRelation | null {
  const row = db.prepare('SELECT * FROM module_relations WHERE module_a_id = ? AND module_b_id = ?').get(a, b) as Row | undefined
  return row ? fromRow(row) : null
}

export interface UpsertInput {
  moduleAId: number
  moduleBId: number
  direction: Direction
  category: Category
  label: string
  summary: string
  evidenceFiles: string[]
  fingerprint: string
}

export function upsertRelation(db: Database.Database, input: UpsertInput): number {
  const now = new Date().toISOString()
  const existing = getRelation(db, input.moduleAId, input.moduleBId)
  if (existing) {
    db.prepare(`
      UPDATE module_relations
      SET direction = ?, category = ?, label = ?, summary = ?,
          evidence_files = ?, fingerprint = ?, fingerprint_current = ?, updated_at = ?
      WHERE id = ?
    `).run(input.direction, input.category, input.label, input.summary,
      JSON.stringify(input.evidenceFiles), input.fingerprint, input.fingerprint, now, existing.id)
    return existing.id
  }
  const result = db.prepare(`
    INSERT INTO module_relations (module_a_id, module_b_id, direction, category, label, summary, evidence_files, fingerprint, fingerprint_current, manual_override, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(input.moduleAId, input.moduleBId, input.direction, input.category, input.label, input.summary,
    JSON.stringify(input.evidenceFiles), input.fingerprint, input.fingerprint, now, now)
  return result.lastInsertRowid as number
}

export function updateFingerprintCurrent(db: Database.Database, id: number, fingerprint: string): void {
  db.prepare('UPDATE module_relations SET fingerprint_current = ? WHERE id = ?').run(fingerprint, id)
}

export function deleteRelation(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM module_relations WHERE id = ?').run(id)
}

export function countStale(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM module_relations WHERE fingerprint_current IS NULL OR fingerprint_current != fingerprint').get() as { n: number }
  return row.n
}
