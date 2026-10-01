import * as fs from 'node:fs'
import * as path from 'node:path'
import type Database from 'better-sqlite3'
import type { FileChangeKind } from './types.js'
import type { TurnSummaryOrchestrator } from '../turn-summaries/orchestrator.js'

export interface LiveDeps {
  broadcast: (msg: unknown) => void
  projectRoot: string
  db?: Database.Database
  summaryOrchestrator?: TurnSummaryOrchestrator
}

function lookupModuleId(relativePath: string, db: Database.Database | undefined): number | null {
  if (!db || !relativePath) return null
  const row = db.prepare('SELECT module_id FROM files WHERE path = ?').get(relativePath) as { module_id: number | null } | undefined
  return row?.module_id ?? null
}

function relPath(absolute: string, projectRoot: string): string {
  if (!absolute) return absolute
  const rel = path.relative(projectRoot, absolute)
  if (!rel || rel.startsWith('..')) return absolute
  return rel.split(path.sep).join('/')
}

interface PendingChange {
  toolUseId: string
  path: string
  kind: FileChangeKind
  oldString?: string
  newString?: string
  content?: string
  sessionId: string
  ts: number
}

interface ToolInput {
  file_path?: unknown
  old_string?: unknown
  new_string?: unknown
  content?: unknown
  edits?: unknown
}

interface HookBody {
  session_id?: unknown
  hook_event_name?: unknown
  tool_name?: unknown
  tool_use_id?: unknown
  tool_input?: ToolInput
  tool_response?: unknown
  prompt?: unknown
}

const pending = new Map<string, PendingChange>()
const CONTEXT_LINES = 4

interface SessionRecord {
  sessionId: string
  pid: number | null
  startedAt: number
  lastActivity: number
  status: 'alive' | 'dead'
  cwd?: string
  transcriptPath?: string
}

const sessions = new Map<string, SessionRecord>()
let pollerStarted = false

export function startSessionPoller(intervalMs: number, broadcast: (msg: unknown) => void): void {
  if (pollerStarted) return
  pollerStarted = true
  setInterval(() => {
    for (const rec of sessions.values()) {
      if (rec.status === 'dead' || !rec.pid) continue
      if (!isPidAlive(rec.pid)) {
        rec.status = 'dead'
        broadcast({ type: 'session-update', sessionId: rec.sessionId, status: 'dead' })
      }
    }
  }, intervalMs).unref()
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

export function handleHookSessionStart(body: HookBody, claudePid: number | null, deps: LiveDeps): void {
  const sessionId = String(body.session_id ?? '')
  if (!sessionId) return
  const cwd = typeof (body as Record<string, unknown>).cwd === 'string' ? (body as Record<string, string>).cwd : undefined
  const transcriptPath = typeof (body as Record<string, unknown>).transcript_path === 'string' ? (body as Record<string, string>).transcript_path : undefined
  const now = Date.now()
  sessions.set(sessionId, { sessionId, pid: claudePid, startedAt: now, lastActivity: now, status: 'alive', cwd, transcriptPath })
  deps.broadcast({ type: 'session-update', sessionId, status: 'alive', pid: claudePid, cwd, transcriptPath })
}

export function handleHookSessionEnd(body: HookBody, deps: LiveDeps): void {
  const sessionId = String(body.session_id ?? '')
  if (!sessionId) return
  const rec = sessions.get(sessionId)
  if (rec) { rec.status = 'dead'; rec.lastActivity = Date.now() }
  deps.broadcast({ type: 'session-update', sessionId, status: 'dead' })
}

export function listSessions(): SessionRecord[] {
  return [...sessions.values()].sort((a, b) => b.startedAt - a.startedAt)
}

function touchSession(sessionId: string): void {
  const rec = sessions.get(sessionId)
  if (rec) rec.lastActivity = Date.now()
}

export function handleHookPre(body: HookBody, deps: LiveDeps): void {
  const tool = String(body.tool_name ?? '')
  if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') return
  const sessionId = String(body.session_id ?? '')
  const toolUseId = String(body.tool_use_id ?? '')
  const inp = body.tool_input ?? {}
  const filePath = typeof inp.file_path === 'string' ? inp.file_path : ''
  if (!sessionId || !toolUseId || !filePath) return

  const kind: FileChangeKind = tool === 'Write' ? 'write' : 'edit'
  const change: PendingChange = {
    toolUseId,
    path: filePath,
    kind,
    sessionId,
    ts: Date.now(),
    ...(tool === 'Write'
      ? { content: typeof inp.content === 'string' ? inp.content : '' }
      : {
          oldString: typeof inp.old_string === 'string' ? inp.old_string : '',
          newString: typeof inp.new_string === 'string' ? inp.new_string : '',
        }),
  }
  pending.set(toolUseId, change)
  touchSession(sessionId)

  const rel = relPath(filePath, deps.projectRoot)
  deps.broadcast({
    type: 'live-pending',
    sessionId,
    toolUseId,
    path: rel,
    absolutePath: filePath,
    moduleId: lookupModuleId(rel, deps.db),
    kind,
    linesAdded: estimateLinesAdded(change),
    linesRemoved: estimateLinesRemoved(change),
  })
  deps.summaryOrchestrator?.onPre(sessionId, tool)
}

export function handleHookPost(body: HookBody, deps: LiveDeps): void {
  const toolUseId = String(body.tool_use_id ?? '')
  if (!toolUseId) return
  const prev = pending.get(toolUseId)
  pending.delete(toolUseId)

  const tool = String(body.tool_name ?? '')
  const sessionId = String(body.session_id ?? '')
  const inp = body.tool_input ?? {}
  const filePath = typeof inp.file_path === 'string' ? inp.file_path : prev?.path ?? ''
  if (!filePath) return
  const kind: FileChangeKind = prev?.kind ?? (tool === 'Write' ? 'write' : 'edit')

  touchSession(sessionId)
  const ctx = readDiskContext(filePath, prev, inp)
  const oldString = prev?.oldString ?? (typeof inp.old_string === 'string' ? inp.old_string : undefined)
  const newString = prev?.newString ?? (typeof inp.new_string === 'string' ? inp.new_string : undefined)
  const content = prev?.content ?? (typeof inp.content === 'string' ? inp.content : undefined)

  const rel = relPath(filePath, deps.projectRoot)
  deps.broadcast({
    type: 'live-done',
    sessionId,
    toolUseId,
    path: rel,
    absolutePath: filePath,
    moduleId: lookupModuleId(rel, deps.db),
    kind,
    linesAdded: estimateLinesAdded({ kind, oldString, newString, content } as PendingChange),
    linesRemoved: estimateLinesRemoved({ kind, oldString, newString, content } as PendingChange),
    contextStartLine: ctx.startLine,
    contextLines: ctx.lines,
    matched: ctx.matched,
  })
  if (deps.summaryOrchestrator && rel) {
    deps.summaryOrchestrator.onPost(sessionId, {
      toolUseId, filePath: rel, kind,
      oldString, newString, content,
      ts: Date.now(),
    })
  }
}

export function handleHookTurnStart(body: HookBody, deps: LiveDeps): void {
  const sessionId = String(body.session_id ?? '')
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  if (!sessionId) return
  touchSession(sessionId)
  deps.broadcast({ type: 'live-turn-start', sessionId, userText: prompt, ts: Date.now() })
  deps.summaryOrchestrator?.onTurnStart(sessionId, prompt)
}

export function handleHookStop(body: HookBody, deps: LiveDeps): void {
  const sessionId = String(body.session_id ?? '')
  if (!sessionId) return
  touchSession(sessionId)
  deps.broadcast({ type: 'live-turn-end', sessionId, ts: Date.now() })
  deps.summaryOrchestrator?.onStop(sessionId)
}

function estimateLinesAdded(c: { kind: FileChangeKind; newString?: string; content?: string }): number {
  if (c.kind === 'write') return lineCount(c.content ?? '')
  return lineCount(c.newString ?? '')
}
function estimateLinesRemoved(c: { kind: FileChangeKind; oldString?: string }): number {
  if (c.kind === 'write') return 0
  return lineCount(c.oldString ?? '')
}
function lineCount(s: string): number {
  return s ? s.split('\n').length : 0
}

interface DiskContext {
  startLine: number
  lines: Array<{ kind: 'context' | 'add' | 'del'; lineNumber: number | null; text: string }>
  matched: boolean
}

function readDiskContext(filePath: string, prev: PendingChange | undefined, inp: ToolInput): DiskContext {
  const newString = prev?.newString ?? (typeof inp.new_string === 'string' ? inp.new_string : '')
  const oldString = prev?.oldString ?? (typeof inp.old_string === 'string' ? inp.old_string : '')
  const writeContent = prev?.content ?? (typeof inp.content === 'string' ? inp.content : '')
  const kind = prev?.kind ?? (typeof inp.content === 'string' ? 'write' : 'edit')

  if (kind === 'write') {
    const lines = writeContent.split('\n').slice(0, CONTEXT_LINES * 2 + 4)
    return {
      startLine: 1,
      lines: lines.map((text, i) => ({ kind: 'add' as const, lineNumber: i + 1, text })),
      matched: true,
    }
  }

  if (!fs.existsSync(filePath)) return { startLine: 1, lines: rawDiff(oldString, newString), matched: false }
  let disk: string
  try { disk = fs.readFileSync(filePath, 'utf8') } catch { return { startLine: 1, lines: rawDiff(oldString, newString), matched: false } }

  const newIdx = newString ? disk.indexOf(newString) : -1
  if (newIdx < 0) return { startLine: 1, lines: rawDiff(oldString, newString), matched: false }

  const before = disk.slice(0, newIdx)
  const startLine = (before.match(/\n/g) ?? []).length + 1
  const allLines = disk.split('\n')
  const newLines = newString.split('\n')
  const ctxStart = Math.max(0, startLine - 1 - CONTEXT_LINES)
  const ctxEnd = Math.min(allLines.length, startLine - 1 + newLines.length + CONTEXT_LINES)
  const oldLines = oldString.split('\n')

  const out: DiskContext['lines'] = []
  // pre-context
  for (let i = ctxStart; i < startLine - 1; i++) {
    out.push({ kind: 'context', lineNumber: i + 1, text: allLines[i] ?? '' })
  }
  // removed lines (no real line number — show as -)
  for (const t of oldLines) out.push({ kind: 'del', lineNumber: null, text: t })
  // added lines (real line numbers from disk)
  for (let i = 0; i < newLines.length; i++) {
    out.push({ kind: 'add', lineNumber: startLine + i, text: newLines[i] ?? '' })
  }
  // post-context
  for (let i = startLine - 1 + newLines.length; i < ctxEnd; i++) {
    out.push({ kind: 'context', lineNumber: i + 1, text: allLines[i] ?? '' })
  }

  return { startLine: ctxStart + 1, lines: out, matched: true }
}

function rawDiff(oldString: string, newString: string): DiskContext['lines'] {
  const out: DiskContext['lines'] = []
  if (oldString) for (const t of oldString.split('\n').slice(0, 6)) out.push({ kind: 'del', lineNumber: null, text: t })
  if (newString) for (const t of newString.split('\n').slice(0, 6)) out.push({ kind: 'add', lineNumber: null, text: t })
  return out
}
