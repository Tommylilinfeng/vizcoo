import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { parseTurns } from './turns.js'
import { buildView } from './file-tree.js'
import { scanProjectFiles } from './project-files.js'
import type { FileNode, Turn } from './types.js'

const TITLE_MAX = 60

export interface ConversationSummary {
  id: string
  title: string
  createdAt: number
  lastActivity: number
  turnCount: number
  fileCount: number
}

export interface ConversationDetail extends ConversationSummary {
  files: FileNode[]
  turns: Turn[]
}

export function projectsDirFor(projectRoot: string): string {
  const real = (() => { try { return fs.realpathSync(projectRoot) } catch { return projectRoot } })()
  const dashed = real.split(path.sep).join('-')
  return path.join(os.homedir(), '.claude', 'projects', dashed)
}

const FIXTURE_ID = 'fixture'

export function listConversations(projectRoot: string, fixturePath?: string): ConversationSummary[] {
  // Fixture mode: only show the fixture, hide real project conversations (for reproducible tests)
  if (fixturePath) {
    if (!fs.existsSync(fixturePath)) return []
    const stat = fs.statSync(fixturePath)
    const summary = summarize(fixturePath, FIXTURE_ID, stat.mtimeMs)
    return summary ? [summary] : []
  }
  const dir = projectsDirFor(projectRoot)
  if (!fs.existsSync(dir)) return []
  const out: ConversationSummary[] = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue
    const fullPath = path.join(dir, f)
    const stat = fs.statSync(fullPath)
    if (!stat.isFile() || stat.size === 0) continue
    const id = f.replace(/\.jsonl$/, '')
    const summary = summarize(fullPath, id, stat.mtimeMs)
    if (summary) out.push(summary)
  }
  out.sort((a, b) => b.lastActivity - a.lastActivity)
  return out
}

export function getConversation(projectRoot: string, id: string, fixturePath?: string): ConversationDetail | null {
  // fixture mode → only use JSONL-derived files (the fixture's own universe)
  if (fixturePath && id === FIXTURE_ID) return loadDetail(fixturePath, FIXTURE_ID, /*expandWith*/ null)
  if (fixturePath) return null
  // live mode → cabinet always shows the full project file tree, with conversation's edits overlaid
  const dir = projectsDirFor(projectRoot)
  const fullPath = path.join(dir, `${id}.jsonl`)
  return loadDetail(fullPath, id, projectRoot)
}

function loadDetail(jsonlPath: string, id: string, expandWithProjectRoot: string | null): ConversationDetail | null {
  if (!fs.existsSync(jsonlPath)) return null
  const turns = parseTurns(jsonlPath)
  if (turns.length === 0) return null
  const view = buildView(turns)
  const stat = fs.statSync(jsonlPath)
  const files = expandWithProjectRoot ? mergeWithProjectScan(view.files, expandWithProjectRoot) : view.files
  return {
    id,
    title: makeTitle(view.turns[0]?.userText ?? ''),
    createdAt: view.turns[0]?.timestamp ?? stat.birthtimeMs ?? stat.mtimeMs,
    lastActivity: view.turns[view.turns.length - 1]?.timestamp ?? stat.mtimeMs,
    turnCount: view.turns.length,
    fileCount: files.length,
    files,
    turns: view.turns,
  }
}

function mergeWithProjectScan(fromTurns: FileNode[], projectRoot: string): FileNode[] {
  const seen = new Set(fromTurns.map((f) => f.path))
  const merged: FileNode[] = [...fromTurns]
  for (const f of scanProjectFiles(projectRoot)) {
    if (seen.has(f.path)) continue
    seen.add(f.path)
    merged.push(f)
  }
  return merged.sort((a, b) => (a.folder !== b.folder ? (a.folder < b.folder ? -1 : 1) : (a.basename < b.basename ? -1 : 1)))
}

const WORKFLOW_FIRST_TEXT_MARKERS = [
  '[vizcoo-workflow]',
  "You're a routing agent for the",
  'You are answering a question about the',
]

function isWorkflowSpawnedSession(firstUserText: string | undefined): boolean {
  if (!firstUserText) return false
  const t = firstUserText.trimStart()
  return WORKFLOW_FIRST_TEXT_MARKERS.some((m) => t.startsWith(m))
}

function summarize(jsonlPath: string, id: string, mtimeMs: number): ConversationSummary | null {
  try {
    const turns = parseTurns(jsonlPath)
    if (turns.length === 0) return null
    const view = buildView(turns)
    const first = view.turns[0]
    if (isWorkflowSpawnedSession(first?.userText)) return null
    const last = view.turns[view.turns.length - 1]
    return {
      id,
      title: makeTitle(first?.userText ?? ''),
      createdAt: first?.timestamp ?? mtimeMs,
      lastActivity: last?.timestamp ?? mtimeMs,
      turnCount: view.turns.length,
      fileCount: view.files.length,
    }
  } catch { return null }
}

function makeTitle(userText: string): string {
  const cleaned = userText.replace(/\s+/g, ' ').trim()
  if (!cleaned) return '(untitled)'
  if (cleaned.length <= TITLE_MAX) return cleaned
  return cleaned.slice(0, TITLE_MAX).trimEnd() + '…'
}
