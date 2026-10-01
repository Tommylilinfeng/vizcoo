#!/usr/bin/env tsx
import * as path from 'node:path'
import { parseTurns } from '../src/core/view/turns.js'
import { buildView } from '../src/core/view/file-tree.js'

const arg = process.argv[2]
if (!arg) { console.error('usage: dump-turns.ts <jsonl> [--files]'); process.exit(1) }
const { turns, files } = buildView(parseTurns(path.resolve(arg)))
console.error(`turns: ${turns.length}, unique files: ${files.length}`)

if (process.argv[3] === '--files') {
  for (const f of files) console.log(`${f.folder.padEnd(50)} ${f.basename}`)
} else {
  for (const t of turns.slice(0, 3)) {
    console.log(`--- turn ${t.index} @ ${new Date(t.timestamp).toISOString()} ---`)
    console.log(`USER: ${t.userText.slice(0, 100).replace(/\n/g, ' ')}${t.userText.length > 100 ? '…' : ''}`)
    console.log(`ASSISTANT: ${t.assistantText.slice(0, 100).replace(/\n/g, ' ')}${t.assistantText.length > 100 ? '…' : ''}`)
    console.log(`CHANGES (${t.fileChanges.length}):`)
    for (const c of t.fileChanges.slice(0, 5)) console.log(`  ${c.kind} ${c.path.split('/').pop()}`)
    if (t.fileChanges.length > 5) console.log(`  …+${t.fileChanges.length - 5} more`)
  }
}
