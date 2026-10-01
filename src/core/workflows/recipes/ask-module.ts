import type Database from 'better-sqlite3'
import type { Recipe } from '../types.js'

export interface AskParams {
  moduleId: number
  question: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

export const askModuleRecipe: Recipe<AskParams, void> = {
  name: 'ask-module',
  describe: (p) => p.question.slice(0, 80),
  prompt: (p, ctx) => {
    const mod = ctx.db.prepare('SELECT id, name, display_name FROM modules WHERE id = ?').get(p.moduleId) as { id: number; name: string; display_name: string | null } | undefined
    if (!mod) throw new Error(`module ${p.moduleId} not found`)
    const moduleName = mod.display_name ?? mod.name
    const ids = collectDescendantModuleIds(ctx.db, mod.id)
    const placeholders = ids.map(() => '?').join(',')
    const filePaths = (ctx.db.prepare(`SELECT path FROM files WHERE module_id IN (${placeholders})`).all(...ids) as Array<{ path: string }>).map((r) => r.path)

    const history = p.history.length > 0
      ? `Conversation so far:\n${p.history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')}\n\n`
      : ''

    const fileBlock = filePaths.length <= 200
      ? filePaths.map((f) => `  ${f}`).join('\n')
      : `${filePaths.slice(0, 200).map((f) => `  ${f}`).join('\n')}\n  ... and ${filePaths.length - 200} more`

    return `You are answering a question about the "${moduleName}" module of a TypeScript project.

This module is logically defined as ${filePaths.length} file(s):
${fileBlock}

Use Read/Grep/Glob to investigate. Don't read everything — find what's needed for the question. Answer based on the actual code, don't guess. If something isn't in these files, say so.

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
