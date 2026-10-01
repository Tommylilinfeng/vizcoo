import type Database from 'better-sqlite3'

export interface Edge {
  sourceFile: string
  targetFile: string
  kind: 'import'
}

export function replaceEdgesForFile(db: Database.Database, sourceFile: string, edges: Edge[]): void {
  const del = db.prepare('DELETE FROM edges WHERE source_file = ?')
  const ins = db.prepare(
    'INSERT OR IGNORE INTO edges (source_file, target_file, kind) VALUES (?, ?, ?)',
  )
  const tx = db.transaction((file: string, list: Edge[]) => {
    del.run(file)
    for (const e of list) ins.run(e.sourceFile, e.targetFile, e.kind)
  })
  tx(sourceFile, edges)
}
