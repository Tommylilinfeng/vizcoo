import * as fs from 'node:fs'
import * as path from 'node:path'
import type Database from 'better-sqlite3'
import type { AIProvider } from '../ai/provider.js'
import type { LanguageAnalyzer } from '../plugin-api/analyzer.js'
import { extractJson } from './json-parse.js'

export interface SplitInput {
  db: Database.Database
  root: string
  moduleId: number
  count: number | null
  hint?: string
  analyzers: LanguageAnalyzer[]
  ai: AIProvider
  model?: string
}

export interface SplitResult {
  subModules: Array<{ id: number; name: string; itemCount: number }>
}

interface ChildModuleItem { kind: 'module'; id: number; name: string; displayName: string | null; description: string | null; fileCount: number }
interface FileItem { kind: 'file'; path: string; exports: string[]; externalImports: string[] }
type SplitItem = ChildModuleItem | FileItem

export async function splitModule(input: SplitInput): Promise<SplitResult> {
  const hasHint = !!(input.hint && input.hint.trim().length > 0)
  if (input.count === null && !hasHint) throw new Error('count is required when no hint is provided')
  if (input.count !== null && input.count < 2) throw new Error(`count must be at least 2, got ${input.count}`)
  const target = input.db.prepare('SELECT id, name, display_name, parent_id, tier_id FROM modules WHERE id = ?').get(input.moduleId) as { id: number; name: string; display_name: string | null; parent_id: number | null; tier_id: number | null } | undefined
  if (!target) throw new Error(`module ${input.moduleId} not found`)

  const childModules = (input.db.prepare(
    "SELECT id, name, display_name, description, " +
    "(SELECT COUNT(*) FROM files f WHERE f.module_id = modules.id) AS fileCount " +
    "FROM modules WHERE parent_id = ?",
  ).all(input.moduleId)) as Array<{ id: number; name: string; display_name: string | null; description: string | null; fileCount: number }>

  const childFiles = (input.db.prepare('SELECT path FROM files WHERE module_id = ?').all(input.moduleId) as Array<{ path: string }>).map((r) => r.path)

  const fileSummaries = await Promise.all(childFiles.map((p) => summarizeFile(p, input.root, input.analyzers)))
  const items: SplitItem[] = [
    ...childModules.map((m) => ({ kind: 'module' as const, id: m.id, name: m.name, displayName: m.display_name, description: m.description, fileCount: m.fileCount })),
    ...childFiles.map((p, i) => ({ kind: 'file' as const, path: p, ...fileSummaries[i]! })),
  ]
  if (items.length < 2) throw new Error(`module "${target.display_name ?? target.name}" has only ${items.length} item(s); nothing to split`)
  if (input.count !== null && items.length < input.count) throw new Error(`cannot split ${items.length} items into ${input.count} groups`)

  const prompt = buildPrompt(target.display_name ?? target.name, items, input.count, input.hint)
  const raw = await input.ai.complete(prompt, input.model ? { model: input.model } : undefined)
  const parsed = parseSplit(raw, items, input.count)

  const out: SplitResult['subModules'] = []
  const now = new Date().toISOString()
  const tx = input.db.transaction(() => {
    const insertSibling = input.db.prepare(
      "INSERT INTO modules (parent_id, name, display_name, description, origin, created_at, tier_id) " +
      "VALUES (?, ?, ?, ?, 'split', ?, ?)",
    )
    const reparentModule = input.db.prepare("UPDATE modules SET parent_id = ? WHERE id = ?")
    const reassignFile = input.db.prepare("UPDATE files SET module_id = ? WHERE path = ?")
    const newIds: number[] = []
    for (const group of parsed.groups) {
      const info = insertSibling.run(target.parent_id, group.name, group.name, group.description ?? null, now, target.tier_id)
      const newId = info.lastInsertRowid as number
      newIds.push(newId)
      for (const ref of group.items) {
        if (ref.kind === 'module') reparentModule.run(newId, ref.id)
        else reassignFile.run(newId, ref.path)
      }
      out.push({ id: newId, name: group.name, itemCount: group.items.length })
    }
    input.db.prepare("UPDATE modules SET parent_id = NULL WHERE parent_id = ? AND id NOT IN (" + newIds.map(() => '?').join(',') + ")").run(target.id, ...newIds)
    input.db.prepare("UPDATE files SET module_id = NULL WHERE module_id = ?").run(target.id)
    input.db.prepare("DELETE FROM modules WHERE id = ?").run(target.id)
  })
  tx()
  return { subModules: out }
}

interface ParsedGroup {
  name: string
  description: string | null
  items: Array<{ kind: 'module'; id: number } | { kind: 'file'; path: string }>
}
interface ParsedSplit { groups: ParsedGroup[] }

function buildPrompt(parentName: string, items: SplitItem[], count: number | null, hint?: string): string {
  const lines: string[] = []
  const onlyFiles = items.every((i) => i.kind === 'file')
  const onlyModules = items.every((i) => i.kind === 'module')
  if (count !== null) {
    lines.push(`Group the following ${items.length} items under module "${parentName}" into EXACTLY ${count} cohesive sub-groups.`)
  } else {
    lines.push(`Group the following ${items.length} items under module "${parentName}" into a sensible number of cohesive sub-groups (you decide the count based on the guidance below — typically 2 to ${Math.min(items.length, 8)}).`)
  }
  if (hint && hint.trim().length > 0) {
    lines.push(`The user has provided this guidance — apply it as the primary grouping principle:`)
    lines.push(`  "${hint.trim()}"`)
  } else {
    lines.push(`Choose the most natural grouping axis (by feature, by layer, by concern).`)
  }
  lines.push(`Every item must appear in exactly one group. Give each group a short human-readable name (2-4 words) and a one-line description (<=80 chars).`)
  lines.push('')
  if (onlyModules) {
    lines.push('Items to group (sub-modules — refer to them by id):')
    for (const it of items) {
      if (it.kind !== 'module') continue
      const display = it.displayName ?? it.name
      const desc = it.description ? ` — ${it.description}` : ''
      lines.push(`  id=${it.id}  ${display}  (${it.fileCount} files)${desc}`)
    }
  } else if (onlyFiles) {
    lines.push('Items to group (files — refer to them by path):')
    for (const it of items) {
      if (it.kind !== 'file') continue
      lines.push(`  ${it.path} — exports[${it.exports.join(', ')}] — imports[${it.externalImports.join(', ')}]`)
    }
  } else {
    lines.push('Items to group (mix of sub-modules and files):')
    for (const it of items) {
      if (it.kind === 'module') {
        const display = it.displayName ?? it.name
        lines.push(`  module:${it.id}  ${display}  (${it.fileCount} files)`)
      } else {
        lines.push(`  file:${it.path}  exports[${it.exports.join(', ')}]`)
      }
    }
  }
  lines.push('')
  lines.push('Respond ONLY with this JSON:')
  lines.push('{')
  lines.push('  "groups": [')
  if (onlyModules) {
    lines.push('    { "name": "...", "description": "...", "moduleIds": [1, 2] }')
  } else if (onlyFiles) {
    lines.push('    { "name": "...", "description": "...", "files": ["path/one.ts"] }')
  } else {
    lines.push('    { "name": "...", "description": "...", "moduleIds": [1], "files": ["path/two.ts"] }')
  }
  lines.push('  ]')
  lines.push('}')
  return lines.join('\n')
}

function parseSplit(raw: string, items: SplitItem[], count: number | null): ParsedSplit {
  const json = extractJson(raw)
  const obj = JSON.parse(json) as { groups?: Array<{ name?: string; description?: string; moduleIds?: number[]; files?: string[] }> }
  if (!obj.groups || !Array.isArray(obj.groups)) throw new Error('split response missing groups array')
  if (count !== null && obj.groups.length !== count) throw new Error(`expected ${count} groups, got ${obj.groups.length}`)
  if (count === null && obj.groups.length < 2) throw new Error(`expected at least 2 groups, got ${obj.groups.length}`)
  const knownIds = new Set(items.filter((i) => i.kind === 'module').map((i) => (i as ChildModuleItem).id))
  const knownPaths = new Set(items.filter((i) => i.kind === 'file').map((i) => (i as FileItem).path))
  const seenIds = new Set<number>()
  const seenPaths = new Set<string>()
  const groups: ParsedGroup[] = []
  for (const g of obj.groups) {
    if (typeof g.name !== 'string' || g.name.length === 0) throw new Error('group missing name')
    const refs: ParsedGroup['items'] = []
    for (const id of g.moduleIds ?? []) {
      if (typeof id !== 'number' || !knownIds.has(id)) throw new Error(`unknown module id ${id}`)
      if (seenIds.has(id)) throw new Error(`module id ${id} in multiple groups`)
      seenIds.add(id)
      refs.push({ kind: 'module', id })
    }
    for (const p of g.files ?? []) {
      if (typeof p !== 'string' || !knownPaths.has(p)) throw new Error(`unknown file ${p}`)
      if (seenPaths.has(p)) throw new Error(`file ${p} in multiple groups`)
      seenPaths.add(p)
      refs.push({ kind: 'file', path: p })
    }
    groups.push({ name: g.name.slice(0, 30), description: g.description ? g.description.slice(0, 80) : null, items: refs })
  }
  if (seenIds.size !== knownIds.size) {
    const missing = [...knownIds].filter((id) => !seenIds.has(id))
    throw new Error(`unassigned module ids: ${missing.slice(0, 3).join(', ')}`)
  }
  if (seenPaths.size !== knownPaths.size) {
    const missing = [...knownPaths].filter((p) => !seenPaths.has(p))
    throw new Error(`unassigned files: ${missing.slice(0, 3).join(', ')}`)
  }
  return { groups }
}

async function summarizeFile(relPath: string, root: string, analyzers: LanguageAnalyzer[]): Promise<{ exports: string[]; externalImports: string[] }> {
  const analyzer = analyzers.find((a) => a.canHandle(relPath))
  if (!analyzer) return { exports: [], externalImports: [] }
  let source: string
  try { source = fs.readFileSync(path.join(root, relPath), 'utf8') } catch { return { exports: [], externalImports: [] } }
  const exports = analyzer.extractSymbols(source, relPath).filter((s) => s.exported).map((s) => s.name)
  const imports = await analyzer.extractImports(source, relPath)
  const ext = imports
    .filter((i) => !i.spec.startsWith('.') && !i.spec.startsWith('/'))
    .map((i) => i.spec)
  return { exports, externalImports: [...new Set(ext)] }
}
