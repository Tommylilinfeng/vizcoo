import type Database from 'better-sqlite3'

export interface TurnSummary {
  id: number
  sessionId: string
  turnIndex: number
  moduleId: number
  summary: string
  filePaths: string[]
  finalized: boolean
  createdAt: string
  updatedAt: string
}

interface Row {
  id: number
  session_id: string
  turn_index: number
  module_id: number
  summary: string
  file_paths: string
  finalized: number
  created_at: string
  updated_at: string
}

const fromRow = (r: Row): TurnSummary => ({
  id: r.id,
  sessionId: r.session_id,
  turnIndex: r.turn_index,
  moduleId: r.module_id,
  summary: r.summary,
  filePaths: JSON.parse(r.file_paths) as string[],
  finalized: r.finalized !== 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export interface UpsertInput {
  sessionId: string
  turnIndex: number
  moduleId: number
  summary: string
  filePaths: string[]
  finalized: boolean
}

export function upsertTurnSummary(db: Database.Database, input: UpsertInput): TurnSummary {
  const now = new Date().toISOString()
  const existing = db.prepare(
    'SELECT * FROM module_turn_summary WHERE session_id = ? AND turn_index = ? AND module_id = ?',
  ).get(input.sessionId, input.turnIndex, input.moduleId) as Row | undefined
  if (existing) {
    db.prepare(
      'UPDATE module_turn_summary SET summary = ?, file_paths = ?, finalized = ?, updated_at = ? WHERE id = ?',
    ).run(input.summary, JSON.stringify(input.filePaths), input.finalized ? 1 : 0, now, existing.id)
    return fromRow({ ...existing, summary: input.summary, file_paths: JSON.stringify(input.filePaths), finalized: input.finalized ? 1 : 0, updated_at: now })
  }
  const result = db.prepare(
    'INSERT INTO module_turn_summary (session_id, turn_index, module_id, summary, file_paths, finalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(input.sessionId, input.turnIndex, input.moduleId, input.summary, JSON.stringify(input.filePaths), input.finalized ? 1 : 0, now, now)
  const id = result.lastInsertRowid as number
  return { ...input, id, createdAt: now, updatedAt: now }
}

export function getMostRecentTurnRef(db: Database.Database, sessionId?: string): { sessionId: string; turnIndex: number } | null {
  const row = sessionId
    ? db.prepare(
        'SELECT session_id, turn_index FROM module_turn_summary WHERE session_id = ? ORDER BY id DESC LIMIT 1',
      ).get(sessionId) as { session_id: string; turn_index: number } | undefined
    : db.prepare(
        'SELECT session_id, turn_index FROM module_turn_summary ORDER BY id DESC LIMIT 1',
      ).get() as { session_id: string; turn_index: number } | undefined
  if (!row) return null
  return { sessionId: row.session_id, turnIndex: row.turn_index }
}

export function listSummariesForTurn(db: Database.Database, sessionId: string, turnIndex: number): TurnSummary[] {
  const rows = db.prepare(
    'SELECT * FROM module_turn_summary WHERE session_id = ? AND turn_index = ? ORDER BY module_id',
  ).all(sessionId, turnIndex) as Row[]
  return rows.map(fromRow)
}
