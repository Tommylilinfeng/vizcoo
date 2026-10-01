import { create } from 'zustand'
import type { FileNode, Turn, FileChange, DiffLine } from '../../core/view/types.js'

export type ConversationStatus = 'alive' | 'dead'

export interface ConversationSummary {
  id: string
  title: string
  createdAt: number
  lastActivity: number
  turnCount: number
  fileCount: number
  status: ConversationStatus
}

interface ConversationsResponse { conversations: ConversationSummary[] }
interface ConversationDetailResponse extends ConversationSummary {
  files: FileNode[]
  turns: Turn[]
}

interface LiveTurnStart { type: 'live-turn-start'; sessionId: string; userText: string; ts: number }
interface LivePending { type: 'live-pending'; sessionId: string; toolUseId: string; path: string; moduleId: number | null; kind: 'edit' | 'write'; linesAdded: number; linesRemoved: number }
interface LiveDone { type: 'live-done'; sessionId: string; toolUseId: string; path: string; moduleId: number | null; kind: 'edit' | 'write'; linesAdded: number; linesRemoved: number; contextStartLine: number; contextLines: DiffLine[]; matched: boolean }
interface LiveTurnEnd { type: 'live-turn-end'; sessionId: string; ts: number }
interface SessionUpdate { type: 'session-update'; sessionId: string; status: ConversationStatus }
type WsMessage = LiveTurnStart | LivePending | LiveDone | LiveTurnEnd | SessionUpdate

interface ViewStoreState {
  conversations: ConversationSummary[]
  selectedId: string | null
  files: FileNode[]
  turns: Turn[]
  liveActivePath: string | null
  livePaths: Set<string>
  selectedTurnIndex: number | null
  loading: boolean
  loadingDetail: boolean
  error: string | null

  loadConversations: () => Promise<void>
  selectConversation: (id: string | null) => Promise<void>
  selectTurn: (index: number | null) => void
  handleLive: (raw: unknown) => void
}

export const useViewStore = create<ViewStoreState>((set, get) => ({
  conversations: [],
  selectedId: null,
  files: [],
  turns: [],
  liveActivePath: null,
  livePaths: new Set(),
  selectedTurnIndex: null,
  loading: false,
  loadingDetail: false,
  error: null,

  async loadConversations() {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/conversations').then((r) => r.json() as Promise<ConversationsResponse>)
      set({ conversations: res.conversations, loading: false })
      const { selectedId, conversations } = get()
      if (!selectedId && conversations.length > 0) {
        await get().selectConversation(conversations[0]!.id)
      }
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  async selectConversation(id) {
    if (id === null) {
      set({ selectedId: null, files: [], turns: [], livePaths: new Set(), selectedTurnIndex: null, liveActivePath: null })
      return
    }
    set({ selectedId: id, loadingDetail: true, livePaths: new Set(), selectedTurnIndex: null, liveActivePath: null })
    try {
      const r = await fetch(`/api/conversations/${id}`)
      if (!r.ok) throw new Error(`load ${id}: ${r.status}`)
      const d = await r.json() as ConversationDetailResponse
      set({ files: d.files, turns: d.turns, loadingDetail: false })
    } catch (err) {
      set({ error: (err as Error).message, loadingDetail: false })
    }
  },

  selectTurn(index) {
    set({ selectedTurnIndex: index })
  },

  handleLive(raw) {
    const msg = raw as WsMessage
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return

    if ((msg as { type: string }).type === 'reanalyze-progress') {
      return
    }

    if (msg.type === 'session-update') {
      const conversations = get().conversations.map((c) => c.id === msg.sessionId ? { ...c, status: msg.status } : c)
      set({ conversations })
      return
    }

    if (msg.type === 'live-turn-start') {
      void get().loadConversations()
      const s = get()
      if (s.selectedId !== msg.sessionId) {
        void get().selectConversation(msg.sessionId)
        return
      }
      const userText = msg.userText ?? ''
      if (!userText.startsWith('<system-reminder>') && !userText.startsWith('Caveat:')) {
        const newTurn: Turn = {
          index: s.turns.length,
          timestamp: msg.ts,
          userText,
          assistantText: '',
          fileChanges: [],
        }
        set({ turns: [...s.turns, newTurn] })
      }
      return
    }

    const state = get()
    if (state.selectedId !== msg.sessionId) return

    if (msg.type === 'live-pending') {
      const turn = appendOrEnsureTurn(state.turns)
      const change: FileChange = { path: msg.path, kind: msg.kind, linesAdded: msg.linesAdded, linesRemoved: msg.linesRemoved, status: 'pending', toolUseId: msg.toolUseId }
      const updated: Turn = { ...turn, fileChanges: [...turn.fileChanges, change] }
      const turns = state.turns.length === 0 ? [updated] : state.turns.map((t: Turn, i: number) => i === state.turns.length - 1 ? updated : t)
      const livePaths = new Set(state.livePaths); livePaths.add(msg.path)
      set({ turns, liveActivePath: msg.path, livePaths })
      return
    }

    if (msg.type === 'live-done') {
      const turns = state.turns.map((t: Turn, i: number, arr: Turn[]) => {
        if (i !== arr.length - 1) return t
        return { ...t, fileChanges: t.fileChanges.map((c: FileChange) => c.toolUseId === msg.toolUseId ? { ...c, status: 'done' as const, contextStartLine: msg.contextStartLine, contextLines: msg.contextLines, linesAdded: msg.linesAdded, linesRemoved: msg.linesRemoved } : c) }
      })
      const livePaths = new Set(state.livePaths); livePaths.add(msg.path)
      set({ turns, liveActivePath: null, livePaths })
      return
    }

    if (msg.type === 'live-turn-end') {
      set({ liveActivePath: null })
      return
    }
  },
}))

function appendOrEnsureTurn(turns: Turn[]): Turn {
  const last = turns[turns.length - 1]
  if (last) return last
  return { index: 0, timestamp: Date.now(), userText: '', assistantText: '', fileChanges: [] }
}
