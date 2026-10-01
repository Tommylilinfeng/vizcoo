import type Database from 'better-sqlite3'
import { canonicalPair, pairFingerprint, type CrossEdge } from './fingerprint.js'
import type { ModuleSnippet } from './prompt.js'
import { deleteRelation, listRelations, updateFingerprintCurrent } from './store.js'

export interface SyncStats {
  pairs: number
  pairsWithEdges: number
  generated: number
  unchanged: number
  removed: number
  noRelation: number
  failed: number
}

export interface PairContext {
  a: ModuleSnippet
  b: ModuleSnippet
  files: { a: string[]; b: string[] }
  crossEdges: CrossEdge[]
  fingerprint: string
}

export function gatherTopLevelPairs(db: Database.Database): PairContext[] {
  const allModules = db.prepare(`
    SELECT id, parent_id AS parentId, name, display_name AS displayName, description
    FROM modules
  `).all() as Array<{ id: number; parentId: number | null; name: string; displayName: string | null; description: string | null }>

  const childrenOf = new Map<number, number[]>()
  for (const m of allModules) {
    if (m.parentId !== null) {
      const list = childrenOf.get(m.parentId) ?? []
      list.push(m.id); childrenOf.set(m.parentId, list)
    }
  }
  const rootOf = new Map<number, number>()
  const walkRoot = (rootId: number, nodeId: number): void => {
    rootOf.set(nodeId, rootId)
    for (const c of childrenOf.get(nodeId) ?? []) walkRoot(rootId, c)
  }
  const modules = allModules.filter((m) => m.parentId === null)
  for (const m of modules) walkRoot(m.id, m.id)

  const filesByModule = new Map<number, string[]>()
  for (const m of modules) filesByModule.set(m.id, [])
  const fileRows = db.prepare(`SELECT path, module_id FROM files WHERE module_id IS NOT NULL`).all() as Array<{ path: string; module_id: number }>
  const fileToModule = new Map<string, number>()
  for (const r of fileRows) {
    const root = rootOf.get(r.module_id)
    if (root === undefined) continue
    fileToModule.set(r.path, root)
    const list = filesByModule.get(root)
    if (list) list.push(r.path)
  }

  const edgeRows = db.prepare(`SELECT source_file AS s, target_file AS t, kind FROM edges`).all() as Array<{ s: string; t: string; kind: string }>
  const pairEdges = new Map<string, CrossEdge[]>()
  for (const e of edgeRows) {
    const sm = fileToModule.get(e.s); const tm = fileToModule.get(e.t)
    if (sm === undefined || tm === undefined || sm === tm) continue
    const { a, b } = canonicalPair(sm, tm)
    const key = `${a}:${b}`
    const list = pairEdges.get(key) ?? []
    list.push({ sourceFile: e.s, targetFile: e.t, kind: e.kind })
    pairEdges.set(key, list)
  }

  const moduleById = new Map<number, typeof modules[number]>()
  for (const m of modules) moduleById.set(m.id, m)

  const out: PairContext[] = []
  for (let i = 0; i < modules.length; i++) {
    for (let j = i + 1; j < modules.length; j++) {
      const ma = modules[i]!; const mb = modules[j]!
      const { a, b } = canonicalPair(ma.id, mb.id)
      const aMod = moduleById.get(a)!; const bMod = moduleById.get(b)!
      const filesA = filesByModule.get(a) ?? []
      const filesB = filesByModule.get(b) ?? []
      const crossEdges = pairEdges.get(`${a}:${b}`) ?? []
      out.push({
        a: snippetOf(aMod, filesA),
        b: snippetOf(bMod, filesB),
        files: { a: filesA, b: filesB },
        crossEdges,
        fingerprint: pairFingerprint(filesA, filesB, crossEdges),
      })
    }
  }
  return out
}

function snippetOf(m: { id: number; name: string; displayName: string | null; description: string | null }, files: string[]): ModuleSnippet {
  return {
    id: m.id, name: m.name, displayName: m.displayName, description: m.description,
    fileCount: files.length, topFiles: files.slice(0, 5),
  }
}

export function markStale(db: Database.Database): SyncStats {
  const pairs = gatherTopLevelPairs(db)
  const pairMap = new Map<string, PairContext>()
  for (const p of pairs) pairMap.set(`${p.a.id}:${p.b.id}`, p)

  let unchanged = 0, removed = 0
  const existing = listRelations(db)
  for (const rel of existing) {
    const key = `${rel.moduleAId}:${rel.moduleBId}`
    const ctx = pairMap.get(key)
    if (!ctx) { deleteRelation(db, rel.id); removed++; continue }
    updateFingerprintCurrent(db, rel.id, ctx.fingerprint)
    if (ctx.fingerprint === rel.fingerprint) unchanged++
  }
  return {
    pairs: pairs.length,
    pairsWithEdges: pairs.filter((p) => p.crossEdges.length > 0).length,
    generated: 0, unchanged, removed, noRelation: 0, failed: 0,
  }
}
