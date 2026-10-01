import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { openDatabase } from '../src/core/storage/db.js'
import { TurnTracker, type FlushPayload } from '../src/core/turn-summaries/state.js'
import { upsertTurnSummary, listCurrentSummaries, listSummariesForTurn } from '../src/core/turn-summaries/store.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vizcoo-turn-'))
const db = openDatabase(path.join(tmp, 'graph.db'))

db.exec(`
  INSERT INTO modules (name, origin, created_at) VALUES ('UI', 'heuristic', datetime('now'));
  INSERT INTO modules (name, origin, created_at) VALUES ('Server', 'heuristic', datetime('now'));
`)
const modIds = db.prepare('SELECT id FROM modules ORDER BY id').all() as Array<{ id: number }>
const ui = modIds[0]!.id
const server = modIds[1]!.id

const flushes: FlushPayload[] = []
const tracker = new TurnTracker({
  flushDebounceMs: 100,
  onFlush: (p) => { flushes.push(p) },
})

const SID = 'sess-1'

await sleep(10)
tracker.onTurnStart(SID)
tracker.onPreTool(SID, 'Edit')
tracker.onPostTool(SID, { toolUseId: 't1', filePath: '/p/ui1.tsx', kind: 'edit', oldString: 'a', newString: 'b', ts: Date.now() })
await sleep(150)
console.log(`[verify] flush after single tool ended: count=${flushes.length} (expect 1)`)
console.log(`[verify] flush[0].changes=${flushes[0]!.changes.length} finalized=${flushes[0]!.finalized}`)

tracker.onPreTool(SID, 'Edit')
tracker.onPreTool(SID, 'Edit')
tracker.onPostTool(SID, { toolUseId: 't2', filePath: '/p/ui2.tsx', kind: 'edit', ts: Date.now() })
await sleep(50)
console.log(`[verify] no flush while pendingTools>0: count=${flushes.length} (expect still 1)`)
tracker.onPostTool(SID, { toolUseId: 't3', filePath: '/p/srv1.ts', kind: 'edit', ts: Date.now() })
await sleep(150)
console.log(`[verify] flush after both tools done: count=${flushes.length} (expect 2)`)
console.log(`[verify] flush[1].changes=${flushes[1]!.changes.length} (expect 2 — t2 and t3)`)

tracker.onPreTool(SID, 'Write')
tracker.onPostTool(SID, { toolUseId: 't4', filePath: '/p/ui3.tsx', kind: 'write', content: 'x', ts: Date.now() })
tracker.onStop(SID)
console.log(`[verify] Stop forces immediate flush: count=${flushes.length} (expect 3)`)
console.log(`[verify] flush[2].finalized=${flushes[2]!.finalized} (expect true)`)

upsertTurnSummary(db, {
  sessionId: SID, turnIndex: 1, moduleId: ui,
  summary: 'Refactoring UI components',
  filePaths: ['/p/ui1.tsx', '/p/ui2.tsx'],
  finalized: false,
})
upsertTurnSummary(db, {
  sessionId: SID, turnIndex: 1, moduleId: server,
  summary: 'Adding endpoint handler',
  filePaths: ['/p/srv1.ts'],
  finalized: false,
})
const turnRows = listSummariesForTurn(db, SID, 1)
console.log(`[verify] listSummariesForTurn returned ${turnRows.length} (expect 2)`)

upsertTurnSummary(db, {
  sessionId: SID, turnIndex: 1, moduleId: ui,
  summary: 'Refactoring UI components and adding test',
  filePaths: ['/p/ui1.tsx', '/p/ui2.tsx', '/p/ui3.tsx'],
  finalized: true,
})
const updatedTurn = listSummariesForTurn(db, SID, 1)
console.log(`[verify] after upsert: still ${updatedTurn.length} rows (expect 2 — UI updated in place)`)
const ui1 = updatedTurn.find((r) => r.moduleId === ui)!
console.log(`[verify] UI summary updated to: "${ui1.summary}" finalized=${ui1.finalized}`)

upsertTurnSummary(db, {
  sessionId: SID, turnIndex: 2, moduleId: ui,
  summary: 'New turn — different work',
  filePaths: ['/p/ui4.tsx'],
  finalized: true,
})
const current = listCurrentSummaries(db)
console.log(`[verify] listCurrentSummaries returned ${current.length} (expect 2: latest UI + server)`)
const latestUI = current.find((r) => r.moduleId === ui)!
console.log(`[verify] latest UI summary: "${latestUI.summary}" turn=${latestUI.turnIndex} (expect turn 2)`)

db.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log('all phase-1 tests passed')

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}
