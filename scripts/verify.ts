import * as path from 'node:path'
import * as fs from 'node:fs'
import { openDatabase } from '../src/core/storage/db.js'
import { indexProject } from '../src/core/index-project.js'
import { typescriptAnalyzer } from '../src/analyzers/typescript/index.js'

const FIXTURE = path.resolve('fixtures/nextjs-minimal')
const DB_PATH = path.join(FIXTURE, '.vizcoo', 'graph.db')

async function main(): Promise<void> {
  if (!fs.existsSync(FIXTURE)) die(`fixture missing: ${FIXTURE}`)
  fs.rmSync(DB_PATH, { force: true })

  const db = openDatabase(DB_PATH)
  const stats = await indexProject(FIXTURE, db, [typescriptAnalyzer])

  expect(stats.files === 4, `expected 4 files, got ${stats.files}`)
  expect(stats.modules === 4, `expected 4 modules, got ${stats.modules}`)
  expect(stats.detector.startsWith('confidence='), `expected framework detector to win, got ${stats.detector}`)

  const moduleNames = (db.prepare('SELECT name FROM modules ORDER BY name').all() as Array<{ name: string }>)
    .map((r) => r.name)
  const expected = ['API Routes', 'Components', 'Lib', 'Pages']
  expect(
    JSON.stringify(moduleNames) === JSON.stringify(expected),
    `expected modules ${JSON.stringify(expected)}, got ${JSON.stringify(moduleNames)}`,
  )

  const edgeCount = (db.prepare('SELECT COUNT(*) AS c FROM edges').get() as { c: number }).c
  expect(edgeCount >= 3, `expected at least 3 edges, got ${edgeCount}`)

  const apiEdgeCount = (db.prepare("SELECT COUNT(*) AS c FROM edges WHERE kind = 'api-call'").get() as { c: number }).c
  expect(apiEdgeCount === 1, `expected 1 api-call edge (Button → /api/hello), got ${apiEdgeCount}`)

  db.close()
  console.log('OK')
}

function expect(cond: boolean, msg: string): void {
  if (!cond) die(msg)
}

function die(msg: string): never {
  console.error(`verify failed: ${msg}`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
