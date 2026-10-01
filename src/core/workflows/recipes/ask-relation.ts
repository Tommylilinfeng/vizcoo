import type Database from 'better-sqlite3'
import type { Recipe } from '../types.js'

export interface AskRelationParams {
  relationId: number
  question: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

interface RelationRow {
  id: number
  module_a_id: number
  module_b_id: number
  direction: string
  category: string
  label: string
  summary: string
  evidence_files: string
}

interface ModRow {
  id: number
  name: string
  display_name: string | null
  description: string | null
}

interface EdgeRow {
  source_file: string
  target_file: string
  kind: string
  cnt: number
}

export const askRelationRecipe: Recipe<AskRelationParams, void> = {
  name: 'ask-relation',
  describe: (p) => p.question.slice(0, 80),
  prompt: (p, ctx) => {
    const rel = ctx.db.prepare('SELECT id, module_a_id, module_b_id, direction, category, label, summary, evidence_files FROM module_relations WHERE id = ?').get(p.relationId) as RelationRow | undefined
    if (!rel) throw new Error(`relation ${p.relationId} not found`)
    const aMod = ctx.db.prepare('SELECT id, name, display_name, description FROM modules WHERE id = ?').get(rel.module_a_id) as ModRow | undefined
    const bMod = ctx.db.prepare('SELECT id, name, display_name, description FROM modules WHERE id = ?').get(rel.module_b_id) as ModRow | undefined
    if (!aMod || !bMod) throw new Error(`modules not found for relation ${p.relationId}`)
    const aName = aMod.display_name ?? aMod.name
    const bName = bMod.display_name ?? bMod.name

    const aIds = collectDescendantModuleIds(ctx.db, aMod.id)
    const bIds = collectDescendantModuleIds(ctx.db, bMod.id)
    const aPh = aIds.map(() => '?').join(',')
    const bPh = bIds.map(() => '?').join(',')
    const aToB = ctx.db.prepare(`SELECT e.source_file, e.target_file, e.kind, COUNT(*) AS cnt FROM edges e WHERE e.source_file IN (SELECT path FROM files WHERE module_id IN (${aPh})) AND e.target_file IN (SELECT path FROM files WHERE module_id IN (${bPh})) GROUP BY e.source_file, e.target_file, e.kind ORDER BY cnt DESC`).all(...aIds, ...bIds) as EdgeRow[]
    const bToA = ctx.db.prepare(`SELECT e.source_file, e.target_file, e.kind, COUNT(*) AS cnt FROM edges e WHERE e.source_file IN (SELECT path FROM files WHERE module_id IN (${bPh})) AND e.target_file IN (SELECT path FROM files WHERE module_id IN (${aPh})) GROUP BY e.source_file, e.target_file, e.kind ORDER BY cnt DESC`).all(...bIds, ...aIds) as EdgeRow[]

    const evidence: string[] = JSON.parse(rel.evidence_files || '[]')
    const fmtEdges = (edges: EdgeRow[]): string => edges.length === 0
      ? '  (none)'
      : edges.slice(0, 30).map((e) => `  ${e.source_file} -> ${e.target_file} (${e.kind}, x${e.cnt})`).join('\n') + (edges.length > 30 ? `\n  ... and ${edges.length - 30} more` : '')

    const history = p.history.length > 0
      ? `Conversation so far:\n${p.history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')}\n\n`
      : ''

    return `You are answering a question about the relationship between two modules of a TypeScript project.

Module A: ${aName}${aMod.description ? ` — ${aMod.description}` : ''}
Module B: ${bName}${bMod.description ? ` — ${bMod.description}` : ''}

Existing relationship summary (auto-generated, may be wrong or stale — verify if relevant):
- Category: ${rel.category}
- Direction: ${rel.direction}
- Label: ${rel.label}
- Summary: ${rel.summary}

Imports A -> B:
${fmtEdges(aToB)}

Imports B -> A:
${fmtEdges(bToA)}

Evidence files (selected by prior analysis):
${evidence.length === 0 ? '  (none)' : evidence.map((f) => `  ${f}`).join('\n')}

Use Read/Grep/Glob on the actual files when needed. Don't read everything — focus on what the question requires. Answer based on the real code, not assumptions.

${history}User question: ${p.question}

Detect the language of the question and answer in the same language. Be concise.`
  },
  cwd: (_p, ctx) => ctx.projectRoot,
  tools: ['Read', 'Grep', 'Glob'],
}

function collectDescendantModuleIds(db: Database.Database, rootId: number): number[] {
  const ids = [rootId]
  const queue = [rootId]
  const childStmt = db.prepare('SELECT id FROM modules WHERE parent_id = ?')
  while (queue.length > 0) {
    const next = queue.shift()!
    const children = childStmt.all(next) as Array<{ id: number }>
    for (const c of children) { ids.push(c.id); queue.push(c.id) }
  }
  return ids
}
