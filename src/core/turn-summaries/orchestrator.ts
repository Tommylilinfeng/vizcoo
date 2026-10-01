import type Database from 'better-sqlite3'
import type { AIProvider } from '../ai/provider.js'
import { TurnTracker, type FileChange, type FlushPayload } from './state.js'
import { generateSummariesForModules, type ModuleSlice } from './summarize.js'
import { upsertTurnSummary } from './store.js'

interface ModuleRow {
  id: number
  name: string
  display_name: string | null
  description: string | null
  parent_id: number | null
}

export interface OrchestratorOptions {
  db: Database.Database
  ai: AIProvider
  model?: string
  broadcast: (msg: unknown) => void
}

export class TurnSummaryOrchestrator {
  private readonly tracker: TurnTracker
  private readonly db: Database.Database
  private readonly ai: AIProvider
  private readonly model?: string
  private readonly broadcast: (msg: unknown) => void

  constructor(opts: OrchestratorOptions) {
    this.db = opts.db
    this.ai = opts.ai
    this.model = opts.model
    this.broadcast = opts.broadcast
    this.tracker = new TurnTracker({ onFlush: (p) => this.handleFlush(p) })
  }

  onTurnStart(sessionId: string, userPrompt = ''): void { this.tracker.onTurnStart(sessionId, userPrompt) }
  onPre(sessionId: string, toolName: string): void { this.tracker.onPreTool(sessionId, toolName) }
  onPost(sessionId: string, change: FileChange): void { this.tracker.onPostTool(sessionId, change) }
  onStop(sessionId: string): void { this.tracker.onStop(sessionId) }

  private async handleFlush(payload: FlushPayload): Promise<void> {
    const groups = new Map<number, { module: ModuleRow; changes: FileChange[] }>()
    for (const change of payload.changes) {
      const top = topLevelModuleForPath(this.db, change.filePath)
      if (!top) continue
      let g = groups.get(top.id)
      if (!g) { g = { module: top, changes: [] }; groups.set(top.id, g) }
      g.changes.push(change)
    }
    if (groups.size === 0) return

    const allNames = [...groups.values()].map((g) => displayOf(g.module))
    const slices: ModuleSlice[] = [...groups.values()].map((g) => ({
      moduleId: g.module.id,
      moduleName: displayOf(g.module),
      moduleDescription: g.module.description,
      filesInThisModule: g.changes,
      coTouchedModuleNames: allNames.filter((n) => n !== displayOf(g.module)),
      userPrompt: payload.userPrompt,
    }))

    const results = await generateSummariesForModules({ ai: this.ai, model: this.model, modules: slices })

    for (const slice of slices) {
      const r = results.get(slice.moduleId)
      if (!r) continue
      upsertTurnSummary(this.db, {
        sessionId: payload.sessionId,
        turnIndex: payload.turnIndex,
        moduleId: slice.moduleId,
        summary: r.summary,
        filePaths: slice.filesInThisModule.map((c) => c.filePath),
        finalized: payload.finalized,
      })
    }
    this.broadcast({ type: 'turn-summaries-updated', sessionId: payload.sessionId, turnIndex: payload.turnIndex, finalized: payload.finalized })
  }
}

function displayOf(m: ModuleRow): string {
  return m.display_name ?? m.name
}

function topLevelModuleForPath(db: Database.Database, relativePath: string): ModuleRow | null {
  const leaf = db.prepare(`
    SELECT m.id, m.name, m.display_name, m.description, m.parent_id
    FROM files f JOIN modules m ON m.id = f.module_id
    WHERE f.path = ?
  `).get(relativePath) as ModuleRow | undefined
  if (!leaf) return null
  let cur: ModuleRow = leaf
  let guard = 16
  while (cur.parent_id !== null && guard-- > 0) {
    const next = db.prepare('SELECT id, name, display_name, description, parent_id FROM modules WHERE id = ?').get(cur.parent_id) as ModuleRow | undefined
    if (!next) break
    cur = next
  }
  return cur
}
