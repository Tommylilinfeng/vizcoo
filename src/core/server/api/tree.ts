import type Database from 'better-sqlite3'
import { listTiers, type TierRow } from '../../modules/tier-ops.js'

interface ModuleRow {
  id: number
  parentId: number | null
  name: string
  displayName: string | null
  description: string | null
  origin: string
  tierId: number | null
  fileCount: number
  keyExports: string[] | null
  locked: number
}

export function treeEndpoint(db: Database.Database): { modules: ModuleRow[]; tiers: TierRow[] } {
  const rows = db.prepare(`
    SELECT m.id,
           m.parent_id AS parentId,
           m.name,
           m.display_name AS displayName,
           m.description,
           m.origin,
           m.tier_id AS tierId,
           m.locked,
           m.key_exports AS keyExportsRaw,
           (SELECT COUNT(*) FROM files f WHERE f.module_id = m.id) AS fileCount
    FROM modules m
    ORDER BY (m.parent_id IS NULL) DESC, m.tier_id, m.id
  `).all() as Array<Omit<ModuleRow, 'keyExports'> & { keyExportsRaw: string | null }>
  const modules = rows.map(({ keyExportsRaw, ...rest }) => ({
    ...rest,
    keyExports: keyExportsRaw ? (JSON.parse(keyExportsRaw) as string[]) : null,
  }))
  return { modules, tiers: listTiers(db) }
}
