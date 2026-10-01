import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { openDatabase } from '../src/core/storage/db.js'
import { pairFingerprint, canonicalPair } from '../src/core/relations/fingerprint.js'
import { upsertRelation, listRelations, countStale, updateFingerprintCurrent } from '../src/core/relations/store.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vizcoo-rel-test-'))
const db = openDatabase(path.join(tmp, 'graph.db'))

db.exec(`INSERT INTO modules (name, origin, created_at) VALUES ('A', 'heuristic', datetime('now'))`)
db.exec(`INSERT INTO modules (name, origin, created_at) VALUES ('B', 'heuristic', datetime('now'))`)
const ids = db.prepare('SELECT id FROM modules ORDER BY id').all() as Array<{ id: number }>
const a = ids[0]!.id, b = ids[1]!.id

const filesA = ['src/ui/MapView.tsx', 'src/ui/Sidebar.tsx']
const filesB = ['src/core/server/http.ts', 'src/core/server/ws.ts']
const edges = [{ sourceFile: 'src/ui/api.ts', targetFile: 'src/core/server/http.ts', kind: 'import' }]

const fp1 = pairFingerprint(filesA, filesB, edges)
const fp2 = pairFingerprint([...filesA].reverse(), [...filesB].reverse(), edges)
console.log(`[verify] deterministic on input order: ${fp1 === fp2}`)

const fp3 = pairFingerprint(filesA, filesB, [...edges, { sourceFile: 'x', targetFile: 'y', kind: 'call' }])
console.log(`[verify] changes when edges differ: ${fp1 !== fp3}`)

const { a: ca, b: cb } = canonicalPair(b, a)
console.log(`[verify] canonical orders smaller first: ${ca === a && cb === b}`)

const id = upsertRelation(db, {
  moduleAId: ca, moduleBId: cb,
  direction: 'a_to_b', category: 'depends',
  label: 'A renders B output', summary: 'A imports the public API of B and renders it.',
  evidenceFiles: ['src/ui/api.ts'],
  fingerprint: fp1,
})
console.log(`[verify] inserted relation id=${id}`)

console.log(`[verify] stale count after insert: ${countStale(db)} (expect 0)`)

updateFingerprintCurrent(db, id, fp3)
console.log(`[verify] stale count after fingerprint drift: ${countStale(db)} (expect 1)`)

const rows = listRelations(db)
console.log(`[verify] listRelations returns ${rows.length} (expect 1), label="${rows[0]!.label}"`)

db.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log('all phase-1 tests passed')
