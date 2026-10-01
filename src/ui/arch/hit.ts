import type { Tier } from '../api.js'
import { project } from './iso.js'
import type { LayoutResult } from './layout.js'
import type { CameraState, NodeId, PositionedNode, ScreenPoint } from './types.js'

export type HitResult =
  | { kind: 'board'; node: PositionedNode }
  | { kind: 'tier'; tier: Tier; z: number }
  | { kind: 'empty' }

export interface FitTransform { tx: number; ty: number; scale: number }

export function unprojectAtZ(sx: number, sy: number, z: number, cam: CameraState): { x: number; y: number } {
  const sinZ = Math.sin(cam.rotZ)
  const cosZ = Math.cos(cam.rotZ)
  const sinX = Math.sin(cam.rotX)
  const cosX = Math.cos(cam.rotX)
  const v = (sy + z * cosX) / sinX
  return {
    x: sx * cosZ + v * sinZ,
    y: -sx * sinZ + v * cosZ,
  }
}

export function pointInQuad(sx: number, sy: number, quad: ScreenPoint[]): boolean {
  if (quad.length !== 4) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!
    const b = quad[(i + 1) % 4]!
    const cross = (b.sx - a.sx) * (sy - a.sy) - (b.sy - a.sy) * (sx - a.sx)
    if (cross === 0) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

export function hitTest(
  sx: number,
  sy: number,
  layout: LayoutResult,
  tiers: Tier[],
  cam: CameraState,
  fit: FitTransform,
  sourceId: NodeId,
): HitResult {
  const skip = collectSubtreeIds(layout.floors, sourceId)
  const candidates = collectPostOrder(layout.floors)
  const ft = layout.options.floorThickness
  for (const n of candidates) {
    if (skip.has(n.node.id)) continue
    const quad = topQuadForNode(n, ft, cam).map((p) => ({
      sx: p.sx * fit.scale + fit.tx,
      sy: p.sy * fit.scale + fit.ty,
    }))
    if (pointInQuad(sx, sy, quad)) return { kind: 'board', node: n }
  }
  const band = tierBandHit(sx, sy, layout, tiers, cam, fit)
  return band ?? { kind: 'empty' }
}

function tierBandHit(
  _sx: number,
  sy: number,
  layout: LayoutResult,
  tiers: Tier[],
  cam: CameraState,
  fit: FitTransform,
): HitResult | null {
  const sorted = [...tiers].sort((a, b) => a.position - b.position)
  if (sorted.length === 0) return null
  const ft = layout.options.floorThickness
  const centers = sorted.map((t, idx) => {
    const f = layout.floors.find((fl) => fl.node.tierId === t.id)
    const z = f ? f.z + ft : idx * layout.options.floorGapZ + ft
    const sceneCx = (layout.worldWidth || 0) / 2
    const sceneCy = (layout.worldHeight || 0) / 2
    const p = project(sceneCx, sceneCy, z, cam)
    return { tier: t, z, sy: p.sy * fit.scale + fit.ty }
  })
  centers.sort((a, b) => a.sy - b.sy)
  let bestIdx = -1
  let bestDist = Infinity
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(centers[i]!.sy - sy)
    if (d < bestDist) { bestDist = d; bestIdx = i }
  }
  if (bestIdx < 0) return null
  const c = centers[bestIdx]!
  const prev = bestIdx > 0 ? centers[bestIdx - 1]! : null
  const next = bestIdx < centers.length - 1 ? centers[bestIdx + 1]! : null
  const halves: number[] = []
  if (prev) halves.push(Math.abs(c.sy - prev.sy) / 2)
  if (next) halves.push(Math.abs(c.sy - next.sy) / 2)
  const radius = halves.length > 0 ? Math.min(...halves) : 60
  if (bestDist <= radius) return { kind: 'tier', tier: c.tier, z: c.z }
  return null
}

function topQuadForNode(node: PositionedNode, floorThickness: number, cam: CameraState): ScreenPoint[] {
  const isBoard = node.expanded && node.children.length > 0
  const thickness = isBoard ? thicknessForBoard(node.depth, floorThickness) : 0
  const topZ = node.z + thickness
  return [
    project(node.x, node.y, topZ, cam),
    project(node.x + node.w, node.y, topZ, cam),
    project(node.x + node.w, node.y + node.h, topZ, cam),
    project(node.x, node.y + node.h, topZ, cam),
  ]
}

function thicknessForBoard(depth: number, floorThickness: number): number {
  if (depth <= 0) return floorThickness
  let t = floorThickness
  for (let d = 1; d <= depth; d++) t = Math.max(4, t - d * 2)
  return t
}

function collectPostOrder(roots: PositionedNode[]): PositionedNode[] {
  const out: PositionedNode[] = []
  const walk = (n: PositionedNode) => { for (const c of n.children) walk(c); out.push(n) }
  for (const r of roots) walk(r)
  return out
}

function collectSubtreeIds(roots: PositionedNode[], rootId: NodeId): Set<NodeId> {
  const out = new Set<NodeId>([rootId])
  const found = findNode(roots, rootId)
  if (!found) return out
  const walk = (n: PositionedNode) => { out.add(n.node.id); for (const c of n.children) walk(c) }
  walk(found)
  return out
}

function findNode(roots: PositionedNode[], id: NodeId): PositionedNode | null {
  const search = (n: PositionedNode): PositionedNode | null => {
    if (n.node.id === id) return n
    for (const c of n.children) { const r = search(c); if (r) return r }
    return null
  }
  for (const r of roots) { const f = search(r); if (f) return f }
  return null
}
