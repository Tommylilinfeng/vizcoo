import type Database from 'better-sqlite3'

export interface AggregatedEdge {
  sourceId: number
  targetId: number
  count: number
}

export function moduleEdges(db: Database.Database): AggregatedEdge[] {
  const rows = db.prepare(`
    SELECT sf.module_id AS sourceId, tf.module_id AS targetId, COUNT(*) AS count
    FROM edges e
    JOIN files sf ON sf.path = e.source_file
    JOIN files tf ON tf.path = e.target_file
    WHERE e.kind = 'import'
      AND sf.module_id IS NOT NULL
      AND tf.module_id IS NOT NULL
      AND sf.module_id != tf.module_id
    GROUP BY sf.module_id, tf.module_id
  `).all() as Array<{ sourceId: number; targetId: number; count: number }>
  return rows
}
