#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { openDatabase } from '../src/core/storage/db.js'
import { indexProject } from '../src/core/index-project.js'
import { startServer } from '../src/core/server/http.js'
import { attachWebSocket } from '../src/core/server/ws.js'
import { attachPtyWebSocket } from '../src/core/server/pty/ws.js'
import { findClaude } from '../src/core/server/pty/claude-binary.js'
import { markStale as markRelationsStale } from '../src/core/relations/sync.js'
import { cancelBackgroundRegenerate } from '../src/core/relations/runner.js'
import { TurnSummaryOrchestrator } from '../src/core/turn-summaries/orchestrator.js'
import { watchProject } from '../src/core/project/watch.js'
import { typescriptAnalyzer } from '../src/analyzers/typescript/index.js'
import { pythonAnalyzer } from '../src/analyzers/python/index.js'
import { goAnalyzer } from '../src/analyzers/go/index.js'
import { javaAnalyzer } from '../src/analyzers/java/index.js'
import { cAnalyzer } from '../src/analyzers/c/index.js'
import { rustAnalyzer } from '../src/analyzers/rust/index.js'
import { rubyAnalyzer } from '../src/analyzers/ruby/index.js'
import { kotlinAnalyzer } from '../src/analyzers/kotlin/index.js'
import { scalaAnalyzer } from '../src/analyzers/scala/index.js'
import { phpAnalyzer } from '../src/analyzers/php/index.js'
import { csharpAnalyzer } from '../src/analyzers/csharp/index.js'
import { luaAnalyzer } from '../src/analyzers/lua/index.js'
import { dartAnalyzer } from '../src/analyzers/dart/index.js'
import { claudeCliProvider } from '../src/core/ai/claude-cli.js'
import * as readline from 'node:readline/promises'
import { status as hooksStatus, install as installHooks } from '../src/core/hooks/install.js'
import { startSessionPoller } from '../src/core/view/live.js'

const DEFAULT_PORT = 3721

async function main(): Promise<void> {
  const arg = process.argv[2]
  if (arg === 'install-hooks') {
    const port = Number(process.env.VIZCOO_PORT ?? DEFAULT_PORT)
    installHooks(port)
    console.log(`vizcoo: installed hooks into ~/.claude/settings.json (port ${port})`)
    process.exit(0)
  }
  if (!arg) {
    console.error('usage: vizcoo <project-path>  |  vizcoo install-hooks')
    process.exit(1)
  }
  const root = path.resolve(arg)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`vizcoo: not a directory: ${root}`)
    process.exit(1)
  }
  const dbPath = path.join(root, '.vizcoo', 'graph.db')
  const db = openDatabase(dbPath)
  const started = Date.now()
  const analyzers = [
    typescriptAnalyzer, pythonAnalyzer, goAnalyzer, javaAnalyzer, cAnalyzer,
    rustAnalyzer, rubyAnalyzer, kotlinAnalyzer, scalaAnalyzer,
    phpAnalyzer, csharpAnalyzer, luaAnalyzer, dartAnalyzer,
  ]
  const model = process.env.VIZCOO_MODEL
  const stats = await indexProject(root, db, analyzers, { ai: claudeCliProvider, model })
  const ms = Date.now() - started
  console.log(`vizcoo indexed ${stats.files} files, ${stats.edges} edges, ${stats.modules} modules in ${ms}ms (aggregation: ${stats.aggregation})`)

  const binDir = path.dirname(fileURLToPath(import.meta.url))
  const staticDir = path.resolve(binDir, '..', 'dist/ui')
  const fixturesDir = path.resolve(binDir, '..', 'fixtures/session-replay')
  const vizcooVersion = (() => {
    try { return JSON.parse(fs.readFileSync(path.resolve(binDir, '..', 'package.json'), 'utf8')).version as string }
    catch { return '0.0.0' }
  })()
  const port = Number(process.env.VIZCOO_PORT ?? DEFAULT_PORT)
  const summaryOrchestrator = new TurnSummaryOrchestrator({
    db, ai: claudeCliProvider, model,
    broadcast: (msg) => ws.broadcast(msg),
  })
  const server = await startServer({
    db,
    staticDir,
    port,
    root,
    analyzers,
    ai: claudeCliProvider,
    model,
    fixturesDir,
    fixturePath: process.env.VIZCOO_FIXTURE_PATH,
    onAfterSplit: () => {
      cancelBackgroundRegenerate()
      try { markRelationsStale(db) } catch (err) { console.warn('markStale failed:', (err as Error).message) }
      ws.broadcast({ type: 'update' })
    },
    broadcast: (msg) => ws.broadcast(msg),
    vizcooVersion,
    summaryOrchestrator,
  })
  const ws = attachWebSocket(server)
  const claudeBin = findClaude()
  if (!claudeBin) console.warn('vizcoo: claude binary not found on PATH; terminal panel will show install prompt.')
  attachPtyWebSocket(server, { path: '/pty', cwd: root, command: claudeBin })
  startSessionPoller(1000, (msg) => ws.broadcast(msg))
  const watcher = watchProject(root, db, analyzers, {
    onChange: () => ws.broadcast({ type: 'update' }),
  })
  process.on('SIGINT', () => {
    watcher.close()
    ws.close()
    server.close()
    db.close()
    process.exit(0)
  })
  const url = `http://localhost:${port}`
  console.log(`vizcoo serving ${url}`)
  await maybePromptInstallHooks(port)
  openBrowser(url)
}

async function maybePromptInstallHooks(port: number): Promise<void> {
  const s = hooksStatus()
  if (s.installed && s.port === port) return
  if (!process.stdin.isTTY) {
    console.log('vizcoo: hooks not installed; live updates disabled. Run `vizcoo install-hooks` or click the banner in the dashboard.')
    return
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ans = (await rl.question(`vizcoo wants to install 4 hooks into ${s.settingsPath} so it can show Claude Code activity live. Install? [Y/n] `)).trim().toLowerCase()
  rl.close()
  if (ans === '' || ans === 'y' || ans === 'yes') {
    installHooks(port)
    console.log(`vizcoo: hooks installed (port ${port}).`)
  } else {
    console.log('vizcoo: skipped. Live updates disabled until you install. Click the banner in the dashboard or run `vizcoo install-hooks`.')
  }
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' :
    'xdg-open'
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
