import { listConversations, getConversation, type ConversationSummary, type ConversationDetail } from '../../view/conversations.js'
import { listSessions } from '../../view/live.js'

export interface ConversationsListResponse {
  conversations: Array<ConversationSummary & { status: 'alive' | 'dead' }>
}

export function conversationsListEndpoint(projectRoot: string, fixturePath?: string): ConversationsListResponse {
  const live = listSessions()
  const aliveIds = new Set(live.filter((s) => s.status === 'alive').map((s) => s.sessionId))
  const summaries = listConversations(projectRoot, fixturePath).map((c) => ({
    ...c,
    status: aliveIds.has(c.id) ? ('alive' as const) : ('dead' as const),
  }))
  return { conversations: summaries }
}

export function conversationDetailEndpoint(projectRoot: string, id: string, fixturePath?: string): ConversationDetail | null {
  return getConversation(projectRoot, id, fixturePath)
}
