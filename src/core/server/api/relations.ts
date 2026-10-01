import * as http from 'node:http'
import type Database from 'better-sqlite3'
import type { AIProvider } from '../../ai/provider.js'
import { listRelations, countStale } from '../../relations/store.js'
import { markStale } from '../../relations/sync.js'
import { regenerate } from '../../relations/regenerate.js'

export function relationsListEndpoint(db: Database.Database): unknown {
  return { relations: listRelations(db), staleCount: countStale(db) }
}

export async function handleRelationsSync(req: http.IncomingMessage, res: http.ServerResponse, db: Database.Database): Promise<void> {
  await readBody(req)
  const stats = markStale(db)
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ stats, staleCount: countStale(db) }))
}

export async function handleRelationsRegenerate(req: http.IncomingMessage, res: http.ServerResponse, db: Database.Database, ai: AIProvider, model?: string): Promise<void> {
  const body = await readBody(req)
  let pairKeys: string[] | undefined
  try {
    if (body) { const parsed = JSON.parse(body) as { pairKeys?: string[] }; pairKeys = parsed.pairKeys }
  } catch { res.writeHead(400).end(JSON.stringify({ error: 'invalid json' })); return }
  try {
    const stats = await regenerate(db, { ai, model, pairKeys })
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ stats, staleCount: countStale(db) }))
  } catch (e) {
    res.writeHead(500).end(JSON.stringify({ error: String(e) }))
  }
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}
