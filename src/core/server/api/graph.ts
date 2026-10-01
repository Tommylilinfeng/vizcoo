import type Database from 'better-sqlite3'
import { moduleEdges } from '../../graph/aggregate.js'

export function graphEndpoint(db: Database.Database): { edges: Array<{ sourceId: number; targetId: number; count: number }> } {
  return { edges: moduleEdges(db) }
}
