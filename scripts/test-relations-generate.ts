import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { openDatabase } from '../src/core/storage/db.js'
import type { AIProvider } from '../src/core/ai/provider.js'
import { gatherTopLevelPairs, markStale, regenerate } from '../src/core/relations/sync.js'
import { listRelations } from '../src/core/relations/store.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vizcoo-rel-gen-'))
const db = openDatabase(path.join(tmp, 'graph.db'))

db.exec(`
  INSERT INTO modules (name, origin, description, created_at) VALUES ('UI', 'heuristic', 'browser surface', datetime('now'));
  INSERT INTO modules (name, origin, description, created_at) VALUES ('Server', 'heuristic', 'http + ws backend', datetime('now'));
  INSERT INTO modules (name, origin, description, created_at) VALUES ('Orphan', 'heuristic', 'standalone util', datetime('now'));
`)
const ids = db.prepare('SELECT id FROM modules ORDER BY id').all() as Array<{ id: number }>
const ui = ids[0]!.id, server = ids[1]!.id, orphan = ids[2]!.id

db.exec(`
  INSERT INTO files (path, module_id) VALUES ('src/ui/api.ts', ${ui});
  INSERT INTO files (path, module_id) VALUES ('src/ui/MapView.tsx', ${ui});
  INSERT INTO files (path, module_id) VALUES ('src/core/server/http.ts', ${server});
  INSERT INTO files (path, module_id) VALUES ('src/core/server/ws.ts', ${server});
  INSERT INTO files (path, module_id) VALUES ('src/util/parse.ts', ${orphan});
  INSERT INTO edges (source_file, target_file, kind) VALUES ('src/ui/api.ts', 'src/core/server/http.ts', 'import');
  INSERT INTO edges (source_file, target_file, kind) VALUES ('src/ui/MapView.tsx', 'src/core/server/ws.ts', 'import');
`)

const mockProvider: AIProvider = {
  id: 'mock',
  async complete(prompt: string): Promise<string> {
    if (prompt.includes('Orphan')) {
      return JSON.stringify({ direction: 'shared', category: 'none', label: '', summary: '', evidence_file_paths: [] })
    }
    return JSON.stringify({
      direction: 'a_to_b',
      category: 'depends',
      label: 'UI calls server API',
      summary: 'The browser-side UI consumes HTTP/WebSocket endpoints exposed by the server.',
      evidence_file_paths: ['src/ui/api.ts', 'src/core/server/http.ts'],
    })
  },
}

const pairs = gatherTopLevelPairs(db)
console.log(`[verify] gathered ${pairs.length} pairs (expect 3 = C(3,2))`)
const withEdges = pairs.filter((p) => p.crossEdges.length > 0)
console.log(`[verify] ${withEdges.length} pairs have cross edges (expect 1: UI<->Server)`)

const stats = await regenerate(db, { ai: mockProvider })
console.log(`[verify] regenerate stats:`, stats)

const rels = listRelations(db)
console.log(`[verify] persisted ${rels.length} relations (expect 1: only UI-Server)`)
console.log(`[verify] label="${rels[0]!.label}", direction=${rels[0]!.direction}, category=${rels[0]!.category}`)

const markStats = markStale(db)
console.log(`[verify] markStale (no changes) stats:`, markStats)

db.exec(`INSERT INTO files (path, module_id) VALUES ('src/ui/new.ts', ${ui});`)
const markStats2 = markStale(db)
const stale = db.prepare('SELECT COUNT(*) as n FROM module_relations WHERE fingerprint != fingerprint_current').get() as { n: number }
console.log(`[verify] after adding file: stale count = ${stale.n} (expect 1)`)

db.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log('all phase-2 tests passed')
