import type Database from 'better-sqlite3'
import { listSummariesForTurn, getMostRecentTurnRef } from '../../turn-summaries/store.js'

export function mostRecentTurnSummariesEndpoint(db: Database.Database, query?: URLSearchParams): unknown {
  const sessionId = query?.get('session_id') ?? undefined
  const ref = getMostRecentTurnRef(db, sessionId)
  if (!ref) return { sessionId: null, turnIndex: null, summaries: [] }
  const summaries = listSummariesForTurn(db, ref.sessionId, ref.turnIndex)
  return { sessionId: ref.sessionId, turnIndex: ref.turnIndex, summaries }
}

export function turnSummariesByTurnEndpoint(db: Database.Database, query: URLSearchParams): unknown {
  const sessionId = query.get('session_id') ?? ''
  const turnIndexRaw = query.get('turn_index') ?? ''
  const turnIndex = Number(turnIndexRaw)
  if (!sessionId || !Number.isFinite(turnIndex)) return { summaries: [] }
  return { summaries: listSummariesForTurn(db, sessionId, turnIndex) }
}
