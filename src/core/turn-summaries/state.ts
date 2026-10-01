export type FileChangeKind = 'edit' | 'write' | 'multi'

export interface FileChange {
  toolUseId: string
  filePath: string
  kind: FileChangeKind
  oldString?: string
  newString?: string
  content?: string
  ts: number
}

export interface FlushPayload {
  sessionId: string
  turnIndex: number
  changes: FileChange[]
  finalized: boolean
  userPrompt: string
}

export interface TurnTrackerOptions {
  flushDebounceMs?: number
  onFlush: (payload: FlushPayload) => void | Promise<void>
}

interface SessionState {
  pendingTools: number
  turnIndex: number
  changes: Map<string, FileChange>
  flushTimer: NodeJS.Timeout | null
  currentPrompt: string
}

export class TurnTracker {
  private readonly debounce: number
  private readonly onFlush: TurnTrackerOptions['onFlush']
  private readonly sessions = new Map<string, SessionState>()

  constructor(opts: TurnTrackerOptions) {
    this.debounce = opts.flushDebounceMs ?? 800
    this.onFlush = opts.onFlush
  }

  onTurnStart(sessionId: string, userPrompt = ''): void {
    const s = this.ensure(sessionId)
    if (s.changes.size > 0) this.flush(sessionId, false)
    s.turnIndex += 1
    s.pendingTools = 0
    s.changes.clear()
    s.currentPrompt = userPrompt
    this.cancelTimer(s)
  }

  onPreTool(sessionId: string, toolName: string): void {
    if (!isTrackedTool(toolName)) return
    const s = this.ensure(sessionId)
    s.pendingTools += 1
    this.cancelTimer(s)
  }

  onPostTool(sessionId: string, change: FileChange): void {
    const s = this.ensure(sessionId)
    s.pendingTools = Math.max(0, s.pendingTools - 1)
    s.changes.set(change.toolUseId, change)
    if (s.pendingTools === 0) this.scheduleFlush(sessionId)
  }

  onStop(sessionId: string): void {
    this.flush(sessionId, true)
  }

  private ensure(sessionId: string): SessionState {
    let s = this.sessions.get(sessionId)
    if (!s) {
      s = { pendingTools: 0, turnIndex: 0, changes: new Map(), flushTimer: null, currentPrompt: '' }
      this.sessions.set(sessionId, s)
    }
    return s
  }

  private scheduleFlush(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (!s) return
    this.cancelTimer(s)
    s.flushTimer = setTimeout(() => { this.flush(sessionId, false) }, this.debounce)
  }

  private cancelTimer(s: SessionState): void {
    if (s.flushTimer) { clearTimeout(s.flushTimer); s.flushTimer = null }
  }

  private flush(sessionId: string, finalized: boolean): void {
    const s = this.sessions.get(sessionId)
    if (!s) return
    this.cancelTimer(s)
    if (s.changes.size === 0) return
    const payload: FlushPayload = {
      sessionId,
      turnIndex: s.turnIndex,
      changes: [...s.changes.values()],
      finalized,
      userPrompt: s.currentPrompt,
    }
    if (finalized) s.changes.clear()
    void this.onFlush(payload)
  }
}

export function isTrackedTool(toolName: string): boolean {
  return toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit'
}
