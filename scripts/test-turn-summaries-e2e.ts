import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { openDatabase } from '../src/core/storage/db.js'
import type { AIProvider } from '../src/core/ai/provider.js'
import { TurnSummaryOrchestrator } from '../src/core/turn-summaries/orchestrator.js'
import { listCurrentSummaries, listSummariesForTurn } from '../src/core/turn-summaries/store.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vizcoo-orch-'))
const db = openDatabase(path.join(tmp, 'graph.db'))

db.exec(`
  INSERT INTO modules (name, display_name, origin, description, created_at) VALUES ('UI Surface', 'UI Surface', 'aggregate', 'browser UI', datetime('now'));
  INSERT INTO modules (name, display_name, origin, description, created_at) VALUES ('Server', 'Server', 'aggregate', 'http backend', datetime('now'));
  INSERT INTO modules (name, parent_id, origin, created_at) VALUES ('ui-leaf', 1, 'heuristic', datetime('now'));
  INSERT INTO files (path, module_id) VALUES ('src/ui/MapView.tsx', 3);
  INSERT INTO files (path, module_id) VALUES ('src/ui/Sidebar.tsx', 3);
  INSERT INTO files (path, module_id) VALUES ('src/server/http.ts', 2);
`)

const broadcasts: unknown[] = []
const mock: AIProvider = {
  id: 'mock',
  async complete(prompt: string): Promise<string> {
    if (prompt.includes('模块名: UI Surface')) return '调整 UI 组件渲染'
    if (prompt.includes('模块名: Server')) return '更新 HTTP 路由'
    return ''
  },
}
const orch = new TurnSummaryOrchestrator({ db, ai: mock, broadcast: (m) => { broadcasts.push(m) } })

const SID = 'sess-e2e'
orch.onTurnStart(SID)
orch.onPre(SID, 'Edit')
orch.onPost(SID, { toolUseId: 't1', filePath: 'src/ui/MapView.tsx', kind: 'edit', oldString: 'A', newString: 'B', ts: Date.now() })
orch.onPre(SID, 'Edit')
orch.onPost(SID, { toolUseId: 't2', filePath: 'src/server/http.ts', kind: 'edit', oldString: 'C', newString: 'D', ts: Date.now() })
orch.onStop(SID)

await new Promise((r) => setTimeout(r, 200))

const turn1 = listSummariesForTurn(db, SID, 1)
console.log(`[verify] turn 1 produced ${turn1.length} summaries (expect 2)`)
for (const s of turn1) {
  console.log(`  module ${s.moduleId}: "${s.summary}" finalized=${s.finalized}`)
}

const updateBroadcasts = broadcasts.filter((m: unknown) => (m as { type?: unknown }).type === 'turn-summaries-updated')
console.log(`[verify] broadcast count: ${updateBroadcasts.length} (expect ≥1)`)
console.log(`[verify] last broadcast: ${JSON.stringify(updateBroadcasts[updateBroadcasts.length - 1])}`)

orch.onTurnStart(SID)
orch.onPre(SID, 'Write')
orch.onPost(SID, { toolUseId: 't3', filePath: 'src/ui/Sidebar.tsx', kind: 'write', content: 'new content', ts: Date.now() })
orch.onStop(SID)
await new Promise((r) => setTimeout(r, 200))

const current = listCurrentSummaries(db)
console.log(`[verify] listCurrentSummaries: ${current.length} rows`)
for (const s of current) {
  console.log(`  module ${s.moduleId}: turn=${s.turnIndex} "${s.summary}"`)
}

const externalChange = { toolUseId: 't4', filePath: 'src/unknown-file.ts', kind: 'edit', oldString: 'x', newString: 'y', ts: Date.now() } as const
orch.onTurnStart(SID)
orch.onPre(SID, 'Edit')
orch.onPost(SID, externalChange)
orch.onStop(SID)
await new Promise((r) => setTimeout(r, 200))

const turn3 = listSummariesForTurn(db, SID, 3)
console.log(`[verify] turn 3 (external file only): ${turn3.length} summaries (expect 0 — file not in DB)`)

db.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log('all phase-3 tests passed')
