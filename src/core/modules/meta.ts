import * as crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type { HeuristicModule } from './discover-heuristic.js'

export function computeFingerprint(modules: HeuristicModule[]): string {
  const lines = modules.map((m) => m.name).sort()
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 32)
}

export function readMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function writeMeta(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
