import type { Module } from '../api.js'
import type { ArchNode, NodeId } from './types.js'

export function buildTree(modules: Module[]): ArchNode[] {
  const byId = new Map<NodeId, ArchNode>()
  for (const m of modules) {
    byId.set(m.id, {
      id: m.id,
      parentId: m.parentId,
      name: m.name,
      displayName: m.displayName,
      description: m.description,
      origin: m.origin,
      tierId: m.tierId,
      selfFiles: m.fileCount,
      fileCount: m.fileCount,
      children: [],
      depth: 0,
      raw: m,
    })
  }
  const roots: ArchNode[] = []
  for (const node of byId.values()) {
    if (node.parentId !== null && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  for (const root of roots) aggregate(root, 0)
  for (const node of byId.values()) {
    node.children.sort((a, b) => b.fileCount - a.fileCount)
  }
  return roots
}

function aggregate(node: ArchNode, depth: number): void {
  node.depth = depth
  if (node.children.length === 0) return
  let total = node.selfFiles
  for (const child of node.children) {
    aggregate(child, depth + 1)
    total += child.fileCount
  }
  node.fileCount = total
}

export function findById(roots: ArchNode[], id: NodeId): ArchNode | null {
  for (const root of roots) {
    if (root.id === id) return root
    const found = findById(root.children, id)
    if (found) return found
  }
  return null
}

export function findRootContaining(roots: ArchNode[], id: NodeId): ArchNode | null {
  for (const root of roots) {
    if (containsId(root, id)) return root
  }
  return null
}

function containsId(node: ArchNode, id: NodeId): boolean {
  if (node.id === id) return true
  for (const c of node.children) if (containsId(c, id)) return true
  return false
}
