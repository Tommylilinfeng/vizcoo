import type Database from 'better-sqlite3'
import type { Recipe } from '../types.js'
import { extractJson } from '../run.js'
import { splitModule } from '../../modules/split.js'

export interface AgentParams {
  moduleId: number
  message: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

interface AgentDecision {
  intent: 'answer' | 'split' | 'clarify'
  text?: string
  count?: number
  hint?: string
  summary?: string
}

export const agentRecipe: Recipe<AgentParams, AgentDecision> = {
  name: 'agent',
  describe: (p) => p.message.slice(0, 80),
  prompt: (p, ctx) => {
    if (ctx.ccSessionId) {
      return `User says: ${p.message}\n\nReply with ONE JSON object as before — {"intent":"answer"|"split"|"clarify",...} — no prose, no fences.`
    }
    const mod = ctx.db.prepare('SELECT id, name, display_name FROM modules WHERE id = ?').get(p.moduleId) as { id: number; name: string; display_name: string | null } | undefined
    if (!mod) throw new Error(`module ${p.moduleId} not found`)
    const moduleName = mod.display_name ?? mod.name
    const ids = collectDescendantModuleIds(ctx.db, mod.id)
    const placeholders = ids.map(() => '?').join(',')
    const filePaths = (ctx.db.prepare(`SELECT path FROM files WHERE module_id IN (${placeholders})`).all(...ids) as Array<{ path: string }>).map((r) => r.path)
    const childCount = (ctx.db.prepare('SELECT COUNT(*) AS n FROM modules WHERE parent_id = ?').get(p.moduleId) as { n: number }).n
    const splittable = childCount > 0 ? childCount : filePaths.length
    const fileBlock = filePaths.length <= 200
      ? filePaths.map((f) => `  ${f}`).join('\n')
      : `${filePaths.slice(0, 200).map((f) => `  ${f}`).join('\n')}\n  ... and ${filePaths.length - 200} more`

    return `You're a routing agent for the "${moduleName}" module of a TypeScript project.

The module has ${splittable} splittable items (${childCount > 0 ? `${childCount} sub-modules` : `${filePaths.length} files`}).

Files:
${fileBlock}

User says: ${p.message}

Decide what they want, using Read/Grep/Glob to investigate as needed. Then output ONE JSON object on stdout, no other text. Schema:

For a question to answer:
{"intent":"answer","text":"<your answer in user's language>"}

For a request to split into N groups (must be 2..${splittable}):
{"intent":"split","count":N,"hint":"<optional grouping hint, or empty>","summary":"<one-sentence description in user's language>"}

For ambiguous requests, respond with a clarification:
{"intent":"clarify","text":"<your clarifying question in user's language>"}

Rules:
- Output ONLY the JSON. No markdown fences. No prose around it.
- For "split", count must be an integer 2..${splittable}.
- Detect the user's language and write text/summary in that language.
- If the user asks a non-mutation question, always pick "answer".
- If splittable < 2, never pick "split"; pick "clarify" explaining there's nothing to split.
- For all subsequent turns in this session, follow the same JSON output schema.`
  },
  cwd: (_p, ctx) => ctx.projectRoot,
  tools: ['Read', 'Grep', 'Glob'],
  parse: (raw) => extractJson<AgentDecision>(raw),
  apply: async (parsed, p, ctx) => {
    if (!parsed) return { reply: '(empty agent output)' }
    if (parsed.intent === 'answer' || parsed.intent === 'clarify') {
      return { reply: parsed.text ?? '(empty)' }
    }
    if (parsed.intent === 'split') {
      const count = typeof parsed.count === 'number' && parsed.count >= 2 ? parsed.count : null
      const hint = parsed.hint && parsed.hint.trim() ? parsed.hint.trim() : undefined
      if (count === null && !hint) return { reply: 'Could not determine split count.' }
      const result = await splitModule({
        db: ctx.db,
        root: ctx.projectRoot,
        analyzers: ctx.analyzers,
        ai: ctx.ai,
        model: ctx.model,
        moduleId: p.moduleId,
        count,
        hint,
      })
      const names = result.subModules.map((s) => s.name).join(', ')
      const desc = parsed.summary && parsed.summary.trim()
        ? `${parsed.summary.trim()} (${result.subModules.length}: ${names})`
        : `Split into ${result.subModules.length} sub-modules: ${names}`
      return {
        mutation: {
          description: desc,
          affectedModuleIds: [p.moduleId, ...result.subModules.map((s) => s.id)],
        },
      }
    }
    return { reply: `Unknown intent: ${(parsed as { intent?: string }).intent ?? '?'}` }
  },
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
