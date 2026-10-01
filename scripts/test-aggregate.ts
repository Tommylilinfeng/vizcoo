#!/usr/bin/env tsx
import { openDatabase } from '../src/core/storage/db.js'
import { claudeCliProvider } from '../src/core/ai/claude-cli.js'
import { aggregateModules } from '../src/core/modules/discover-llm.js'
import type { HeuristicModule } from '../src/core/modules/discover-heuristic.js'

const projectRoot = process.argv[2]
if (!projectRoot) { console.error('usage: test-aggregate <project-path>'); process.exit(1) }

const db = openDatabase(`${projectRoot}/.vizcoo/graph.db`)
const rows = db.prepare(`SELECT id, name, key_exports, dir_paths FROM modules WHERE origin = 'heuristic'`).all() as Array<{ id: number; name: string; key_exports: string | null; dir_paths: string | null }>

const modules: HeuristicModule[] = rows.map((r) => {
  const files = (db.prepare('SELECT path FROM files WHERE module_id = ?').all(r.id) as Array<{ path: string }>).map((x) => x.path)
  return {
    name: r.name,
    dirs: r.dir_paths ? JSON.parse(r.dir_paths) : [r.name],
    files,
    keyExports: r.key_exports ? JSON.parse(r.key_exports) : [],
  }
})
modules.sort((a, b) => b.files.length - a.files.length)

console.error(`calling LLM with ${modules.length} modules...`)
const start = Date.now()
const result = await aggregateModules(claudeCliProvider, modules, process.env.VIZCOO_MODEL)
const ms = Date.now() - start
console.error(`done in ${(ms / 1000).toFixed(1)}s`)
console.log(JSON.stringify(result, null, 2))
