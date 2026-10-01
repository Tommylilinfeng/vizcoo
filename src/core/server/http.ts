import * as http from 'node:http'
import type Database from 'better-sqlite3'
import type { AIProvider } from '../ai/provider.js'
import type { LanguageAnalyzer } from '../plugin-api/analyzer.js'
import { treeEndpoint } from './api/tree.js'
import { graphEndpoint } from './api/graph.js'
import { listTiersEndpoint } from './api/tiers.js'
import { hookStatusEndpoint, hookInstallEndpoint, hookUninstallEndpoint } from './api/hookStatus.js'
import { handlePasteImage } from './api/pty-paste-image.js'
import { getLauncherPrefs, handleSetLauncherPrefs } from './api/launcher-prefs.js'
import { relationsListEndpoint, handleRelationsSync, handleRelationsRegenerate } from './api/relations.js'
import { mostRecentTurnSummariesEndpoint, turnSummariesByTurnEndpoint } from './api/turn-summaries.js'
import { handleWorkflowRun } from './api/workflows.js'
import { projectInfoEndpoint, sessionStorageEndpoint, hooksPreviewEndpoint } from './api/projectInfo.js'
import { conversationsListEndpoint, conversationDetailEndpoint } from './api/conversations.js'
import { listSessions } from '../view/live.js'
import { serveStatic } from './static-files.js'
import {
  sendJson,
  handleHook,
  handleSplit,
  handleAggregate,
  handleReanalyze,
  handleTierCreate,
  handleTierPatch,
  handleTierDelete,
  handleModuleCreate,
  handleModuleMerge,
  handleModuleOp,
  handleModuleDelete,
} from './route-handlers.js'

export interface ServerConfig {
  db: Database.Database
  staticDir: string
  port: number
  root: string
  analyzers: LanguageAnalyzer[]
  ai: AIProvider
  model?: string
  onAfterSplit?: () => void
  fixturesDir?: string
  fixturePath?: string
  broadcast?: (msg: unknown) => void
  vizcooVersion?: string
  summaryOrchestrator?: import('../turn-summaries/orchestrator.js').TurnSummaryOrchestrator
}

export function startServer(cfg: ServerConfig): Promise<http.Server> {
  const server = http.createServer((req, res) => handle(req, res, cfg))
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(cfg.port, '127.0.0.1', () => resolve(server))
  })
}

function handle(req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/api/tree') return sendJson(res, 200, treeEndpoint(cfg.db))
  if (req.method === 'GET' && url.pathname === '/api/graph') return sendJson(res, 200, graphEndpoint(cfg.db))
  if (req.method === 'POST' && url.pathname === '/api/split') return void handleSplit(req, res, cfg)
  if (req.method === 'POST' && url.pathname === '/api/aggregate') return void handleAggregate(req, res, cfg)
  if (req.method === 'POST' && url.pathname === '/api/re-analyze') return void handleReanalyze(req, res, cfg)
  if (req.method === 'POST' && url.pathname === '/api/modules') return void handleModuleCreate(req, res, cfg)
  if (req.method === 'POST' && url.pathname.startsWith('/api/modules/') && url.pathname.endsWith('/merge')) return void handleModuleMerge(req, res, cfg, url.pathname)
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/modules/')) return void handleModuleOp(req, res, cfg, url.pathname)
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/modules/')) return void handleModuleDelete(req, res, cfg, url.pathname)
  if (req.method === 'GET' && url.pathname === '/api/tiers') return sendJson(res, 200, listTiersEndpoint(cfg.db))
  if (req.method === 'POST' && url.pathname === '/api/tiers') return void handleTierCreate(req, res, cfg)
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/tiers/')) return void handleTierPatch(req, res, cfg, url.pathname)
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/tiers/')) return void handleTierDelete(req, res, cfg, url.pathname)
  if (req.method === 'POST' && url.pathname.startsWith('/hook/')) return void handleHook(req, res, cfg, url.pathname.slice('/hook/'.length))
  if (req.method === 'GET' && url.pathname === '/api/conversations') return sendJson(res, 200, conversationsListEndpoint(cfg.root, cfg.fixturePath))
  if (req.method === 'GET' && url.pathname.startsWith('/api/conversations/')) {
    const id = url.pathname.slice('/api/conversations/'.length)
    const detail = conversationDetailEndpoint(cfg.root, id, cfg.fixturePath)
    return sendJson(res, detail ? 200 : 404, detail ?? { error: 'not found' })
  }
  if (req.method === 'GET' && url.pathname === '/api/sessions') return sendJson(res, 200, { sessions: listSessions() })
  if (req.method === 'GET' && url.pathname === '/api/sessions/storage') return sendJson(res, 200, sessionStorageEndpoint(cfg.root))
  if (req.method === 'GET' && url.pathname === '/api/project-info') return sendJson(res, 200, projectInfoEndpoint({ root: cfg.root, port: cfg.port, vizcooVersion: cfg.vizcooVersion ?? '0.0.0' }))
  if (req.method === 'GET' && url.pathname === '/api/hooks/status') return sendJson(res, 200, hookStatusEndpoint(cfg.port))
  if (req.method === 'GET' && url.pathname === '/api/hooks/preview') return sendJson(res, 200, hooksPreviewEndpoint(cfg.port))
  if (req.method === 'POST' && url.pathname === '/api/hooks/install') return sendJson(res, 200, hookInstallEndpoint(cfg.port))
  if (req.method === 'POST' && url.pathname === '/api/pty/paste-image') return handlePasteImage(req, res)
  if (req.method === 'GET' && url.pathname === '/api/launcher/prefs') return sendJson(res, 200, getLauncherPrefs(cfg.root))
  if (req.method === 'POST' && url.pathname === '/api/launcher/prefs') return handleSetLauncherPrefs(req, res, cfg.root)
  if (req.method === 'GET' && url.pathname === '/api/relations') return sendJson(res, 200, relationsListEndpoint(cfg.db))
  if (req.method === 'POST' && url.pathname === '/api/relations/sync') return void handleRelationsSync(req, res, cfg.db)
  if (req.method === 'POST' && url.pathname === '/api/relations/regenerate') return void handleRelationsRegenerate(req, res, cfg.db, cfg.ai, cfg.model)
  if (req.method === 'GET' && url.pathname === '/api/turn-summaries/most-recent') return sendJson(res, 200, mostRecentTurnSummariesEndpoint(cfg.db, url.searchParams))
  if (req.method === 'GET' && url.pathname === '/api/turn-summaries/by-turn') return sendJson(res, 200, turnSummariesByTurnEndpoint(cfg.db, url.searchParams))
  if (req.method === 'POST' && url.pathname === '/api/hooks/uninstall') return sendJson(res, 200, hookUninstallEndpoint())
  if (req.method === 'POST' && url.pathname === '/api/workflows/run') return void handleWorkflowRun(req, res, cfg)
  if (req.method === 'GET') return serveStatic(res, cfg.staticDir, url.pathname)
  res.writeHead(404).end()
}
