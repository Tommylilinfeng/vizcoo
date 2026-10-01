import type { ModuleEdge } from '../api.js'
import type { NodeId, PositionedNode } from './types.js'

export interface VisibleEdge {
  sourceId: NodeId
  targetId: NodeId
  count: number
}

export function aggregateEdges(
  floors: PositionedNode[],
  rawEdges: ModuleEdge[],
  maxCount: number = 80,
): VisibleEdge[] {
  const visibleId = new Map<NodeId, NodeId>()
  const visit = (n: PositionedNode, current: NodeId | null) => {
    const own = n.expanded ? n.node.id : current ?? n.node.id
    if (!n.expanded) {
      mark(n, n.node.id, visibleId)
      return
    }
    visibleId.set(n.node.id, own)
    for (const c of n.children) visit(c, own)
  }
  for (const f of floors) visit(f, null)

  const counts = new Map<string, VisibleEdge>()
  for (const e of rawEdges) {
    const sid = visibleId.get(e.sourceId)
    const tid = visibleId.get(e.targetId)
    if (sid === undefined || tid === undefined || sid === tid) continue
    const key = `${sid}-${tid}`
    const existing = counts.get(key)
    if (existing) existing.count += e.count
    else counts.set(key, { sourceId: sid, targetId: tid, count: e.count })
  }
  const all = [...counts.values()].sort((a, b) => b.count - a.count)
  const total = all.reduce((s, e) => s + e.count, 0)
  const threshold = Math.max(2, Math.floor(total / Math.max(1, all.length) / 4))
  const filtered = all.filter((e) => e.count >= threshold)
  return filtered.slice(0, maxCount)
}

function mark(node: PositionedNode, ownerId: NodeId, out: Map<NodeId, NodeId>): void {
  out.set(node.node.id, ownerId)
  for (const c of node.children) mark(c, ownerId, out)
}
