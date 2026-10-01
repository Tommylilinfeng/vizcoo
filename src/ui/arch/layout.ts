import { hierarchy, treemap, type HierarchyNode } from 'd3-hierarchy'
import type { Tier } from '../api.js'
import type { ArchSettings } from './settings.js'
import type { ArchNode, NodeId, PositionedNode } from './types.js'
import { simulateForceLayout, type ForcedNode } from './force-layout.js'

export interface RelationLink { aId: number; bId: number }

export interface LayoutOptions {
  pxPerFile: number
  paddingInner: number
  paddingOuter: number
  paddingTop: number
  floorThickness: number
  floorGapZ: number
  floorGapXY: number
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  pxPerFile: 70,
  paddingInner: 4,
  paddingOuter: 8,
  paddingTop: 8,
  floorThickness: 12,
  floorGapZ: 70,
  floorGapXY: 80,
}

export function layoutOptionsFromSettings(s: ArchSettings): LayoutOptions {
  return {
    pxPerFile: s.pxPerFile,
    paddingInner: s.paddingInner,
    paddingOuter: s.paddingOuter,
    paddingTop: s.paddingOuter,
    floorThickness: s.floorThickness,
    floorGapZ: s.floorGapZ,
    floorGapXY: s.floorGapXY,
  }
}

export interface LayoutResult {
  floors: PositionedNode[]
  worldWidth: number
  worldHeight: number
  worldDepth: number
  options: LayoutOptions
}

const TIER_GAP_XY = 36

export function layoutTree(
  roots: ArchNode[],
  tiers: Tier[],
  expanded: Set<NodeId> | null = null,
  options: LayoutOptions = DEFAULT_LAYOUT,
  hiddenFloors: number[] = [],
  relations: RelationLink[] = [],
): LayoutResult {
  const hidden = new Set(hiddenFloors)
  const sortedTiers = [...tiers].sort((a, b) => a.position - b.position)
  const tierZByTierId = new Map<number, number>()
  const tierVisibleIdxById = new Map<number, number>()
  let z = 0; let visibleIdx = 0
  for (const t of sortedTiers) {
    if (hidden.has(visibleIdx)) { visibleIdx++; continue }
    tierZByTierId.set(t.id, z)
    tierVisibleIdxById.set(t.id, visibleIdx)
    z += options.floorGapZ
    visibleIdx++
  }

  const tierRoots = roots.filter((r) => r.tierId !== null && tierZByTierId.has(r.tierId))
  if (tierRoots.length === 0) {
    return { floors: [], worldWidth: 0, worldHeight: 0, worldDepth: 0, options }
  }

  const layouts = tierRoots.map((n) => layoutBoardTreemap(n, 0, 0, sizeFromFiles(n, options), 0, expanded, options))

  const forcedNodes: ForcedNode[] = layouts.map((nl) => ({
    id: nl.node.id, x: 0, y: 0, z: tierZByTierId.get(nl.node.tierId!)!,
    w: nl.w, h: nl.h,
  }))
  const validIds = new Set(forcedNodes.map((n) => n.id))
  const forcedEdges = relations
    .filter((r) => validIds.has(r.aId) && validIds.has(r.bId))
    .map((r) => ({ aId: r.aId, bId: r.bId }))
  simulateForceLayout(forcedNodes, forcedEdges)

  layouts.forEach((nl, i) => {
    const fn = forcedNodes[i]!
    shiftXY(nl, fn.x - nl.x - nl.w / 2, fn.y - nl.y - nl.h / 2)
    nl.z = fn.z
    nl.floorIndex = tierVisibleIdxById.get(nl.node.tierId!) ?? null
    propagateZ(nl, fn.z + options.floorThickness)
  })

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const nl of layouts) {
    if (nl.x < minX) minX = nl.x
    if (nl.y < minY) minY = nl.y
    if (nl.x + nl.w > maxX) maxX = nl.x + nl.w
    if (nl.y + nl.h > maxY) maxY = nl.y + nl.h
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0 }

  return {
    floors: layouts,
    worldWidth: maxX - minX,
    worldHeight: maxY - minY,
    worldDepth: z - options.floorGapZ + options.floorThickness,
    options,
  }
}

function effectiveFileCount(node: ArchNode): number {
  return Math.max(1, node.fileCount)
}

function isExpanded(node: ArchNode, expanded: Set<NodeId> | null): boolean {
  if (node.children.length === 0) return false
  if (expanded === null) return true
  return expanded.has(node.id)
}

function sizeFromFiles(node: ArchNode, options: LayoutOptions): { w: number; h: number } {
  const totalArea = effectiveFileCount(node) * options.pxPerFile
  const side = Math.sqrt(totalArea)
  return {
    w: Math.max(80, Math.round(side * 1.35)),
    h: Math.max(50, Math.round(side / 1.35)),
  }
}

function layoutBoardTreemap(
  node: ArchNode,
  x: number,
  y: number,
  size: { w: number; h: number },
  depth: number,
  expanded: Set<NodeId> | null,
  options: LayoutOptions,
): PositionedNode {
  const w = size.w
  const h = size.h
  if (!isExpanded(node, expanded)) {
    return { node, x, y, w, h, z: 0, depth, expanded: false, children: [], floorIndex: null }
  }
  const innerX = options.paddingOuter
  const innerY = options.paddingTop
  const innerW = Math.max(8, w - options.paddingOuter * 2)
  const innerH = Math.max(8, h - options.paddingTop - options.paddingOuter)

  type Wrap = { ref: ArchNode; value: number; children?: undefined }
  const wraps: Wrap[] = node.children.map((c) => ({ ref: c, value: Math.max(c.fileCount, 1) }))
  const root = hierarchy<{ children: Wrap[] }>({ children: wraps })
    .sum((d) => ('value' in d ? (d as Wrap).value : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

  treemap<{ children: Wrap[] }>()
    .size([innerW, innerH])
    .paddingInner(options.paddingInner)
    .paddingOuter(0)
    .round(true)(root)

  const leaves = (root.children ?? []) as HierarchyNode<Wrap>[]
  const positionedChildren: PositionedNode[] = leaves.map((leaf) => {
    const cx = innerX + (leaf.x0 ?? 0)
    const cy = innerY + (leaf.y0 ?? 0)
    const cw = (leaf.x1 ?? 0) - (leaf.x0 ?? 0)
    const ch = (leaf.y1 ?? 0) - (leaf.y0 ?? 0)
    return layoutBoardTreemap(leaf.data.ref, cx, cy, { w: cw, h: ch }, depth + 1, expanded, options)
  })

  return {
    node, x, y, w, h, z: 0, depth,
    expanded: true,
    children: positionedChildren,
    floorIndex: null,
  }
}

interface Placement { mx: number; my: number; mw: number; mh: number }
interface SizedBlock { idx: number; w: number; h: number }

function bestPositionPack(blocks: SizedBlock[], gap: number): Placement[] {
  if (blocks.length === 0) return []
  const sorted = [...blocks].sort((a, b) => (b.w * b.h) - (a.w * a.h))
  const placed: Placement[] = []
  const result: Placement[] = new Array(blocks.length)

  const overlaps = (x: number, y: number, w: number, h: number): boolean => {
    for (const p of placed) {
      if (x < p.mx + p.mw + gap && x + w + gap > p.mx &&
          y < p.my + p.mh + gap && y + h + gap > p.my) return true
    }
    return false
  }

  const centroid = (): { x: number; y: number } => {
    let tw = 0, sx = 0, sy = 0
    for (const p of placed) {
      const w = p.mw * p.mh
      sx += w * (p.mx + p.mw / 2)
      sy += w * (p.my + p.mh / 2)
      tw += w
    }
    return tw > 0 ? { x: sx / tw, y: sy / tw } : { x: 0, y: 0 }
  }

  for (const block of sorted) {
    let posX: number, posY: number
    if (placed.length === 0) {
      posX = -block.w / 2
      posY = -block.h / 2
    } else {
      const cur = centroid()
      const blockArea = block.w * block.h
      const totalW = placed.reduce((s, p) => s + p.mw * p.mh, 0)
      let bestX = 0, bestY = 0, bestScore = Infinity
      const candidates: { x: number; y: number }[] = []
      for (const p of placed) {
        candidates.push({ x: p.mx + p.mw + gap, y: p.my })
        candidates.push({ x: p.mx, y: p.my + p.mh + gap })
        candidates.push({ x: p.mx + p.mw + gap, y: p.my + p.mh - block.h })
        candidates.push({ x: p.mx - block.w - gap, y: p.my })
        candidates.push({ x: p.mx - block.w - gap, y: p.my + p.mh - block.h })
        candidates.push({ x: p.mx, y: p.my - block.h - gap })
        candidates.push({ x: p.mx + (p.mw - block.w) / 2, y: p.my + p.mh + gap })
        candidates.push({ x: p.mx + (p.mw - block.w) / 2, y: p.my - block.h - gap })
      }
      for (const c of candidates) {
        if (overlaps(c.x, c.y, block.w, block.h)) continue
        const newCx = (cur.x * totalW + blockArea * (c.x + block.w / 2)) / (totalW + blockArea)
        const newCy = (cur.y * totalW + blockArea * (c.y + block.h / 2)) / (totalW + blockArea)
        const torque = newCx * newCx + newCy * newCy
        const dist = (c.x + block.w / 2) * (c.x + block.w / 2) + (c.y + block.h / 2) * (c.y + block.h / 2)
        const score = torque * 3 + dist * 0.1
        if (score < bestScore) { bestScore = score; bestX = c.x; bestY = c.y }
      }
      posX = bestX
      posY = bestY
    }
    const placement: Placement = { mx: posX, my: posY, mw: block.w, mh: block.h }
    placed.push(placement)
    result[block.idx] = placement
  }

  let tw = 0, wcx = 0, wcy = 0
  for (const p of result) {
    const w = p.mw * p.mh
    wcx += w * (p.mx + p.mw / 2)
    wcy += w * (p.my + p.mh / 2)
    tw += w
  }
  if (tw > 0) {
    wcx /= tw; wcy /= tw
    for (const p of result) { p.mx -= wcx; p.my -= wcy }
  }
  let minX = Infinity, minY = Infinity
  for (const p of result) {
    if (p.mx < minX) minX = p.mx
    if (p.my < minY) minY = p.my
  }
  for (const p of result) { p.mx -= minX; p.my -= minY }
  return result
}

function propagateZ(node: PositionedNode, baseZ: number): void {
  node.z = baseZ
  for (const child of node.children) propagateZ(child, baseZ)
}

function shiftXY(node: PositionedNode, dx: number, dy: number): void {
  node.x += dx
  node.y += dy
  for (const child of node.children) shiftXY(child, dx, dy)
}

export function eachNode(layout: LayoutResult, visit: (n: PositionedNode) => void): void {
  const walk = (n: PositionedNode) => { visit(n); for (const c of n.children) walk(c) }
  for (const f of layout.floors) walk(f)
}
