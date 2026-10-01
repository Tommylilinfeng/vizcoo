import type Database from 'better-sqlite3'
import { listTiers, insertTier, patchTier, deleteTier, type TierRow } from '../../modules/tier-ops.js'

export function listTiersEndpoint(db: Database.Database): { tiers: TierRow[] } {
  return { tiers: listTiers(db) }
}

export function createTierEndpoint(db: Database.Database, body: unknown): TierRow {
  const b = (body && typeof body === 'object') ? (body as { position?: unknown; name?: unknown }) : {}
  const position = typeof b.position === 'number' ? b.position : undefined
  const name = typeof b.name === 'string' ? b.name : null
  return insertTier(db, { position, name })
}

export function patchTierEndpoint(db: Database.Database, id: number, body: unknown): { ok: true } {
  const b = (body && typeof body === 'object') ? (body as { position?: unknown; name?: unknown }) : {}
  const params: { position?: number; name?: string | null } = {}
  if (typeof b.position === 'number') params.position = b.position
  if (b.name === null || typeof b.name === 'string') params.name = b.name
  patchTier(db, id, params)
  return { ok: true }
}

export function deleteTierEndpoint(db: Database.Database, id: number): { orphaned: number } {
  return deleteTier(db, id)
}
