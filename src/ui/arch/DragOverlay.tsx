import type { Tier } from '../api.js'
import type { DragState, DropAction } from './drag.js'
import type { FitTransform, HitResult } from './hit.js'
import { project } from './iso.js'
import type { LayoutResult } from './layout.js'
import type { CameraState, NodeId, PositionedNode, ScreenPoint } from './types.js'

interface Props {
  drag: DragState
  layout: LayoutResult
  cam: CameraState
  fit: FitTransform
  sortedTiers: Tier[]
  bandHalfHeight: number
}

export function DragOverlay({ drag, layout, cam, fit, sortedTiers, bandHalfHeight }: Props) {
  const ft = layout.options.floorThickness
  const source = findPositioned(layout.floors, drag.sourceId)
  const hover = drag.hover
  const action = drag.preview
  const valid = action.type !== 'invalid'
  const stroke = valid ? '#ffd166' : '#ef4444'

  return (
    <g pointerEvents="none">
      {hover?.kind === 'tier' && (
        <TierBand tier={hover.tier} z={hover.z} layout={layout} cam={cam} fit={fit} halfH={bandHalfHeight} />
      )}
      {hover?.kind === 'board' && (
        <HoverQuad node={hover.node} cam={cam} fit={fit} ft={ft} stroke={stroke} />
      )}
      {source && drag.moved && (
        <Ghost node={source} cam={cam} fit={fit} ft={ft} mx={drag.mx} my={drag.my} stroke={stroke} />
      )}
      {drag.moved && (
        <DropLabel mx={drag.mx} my={drag.my} text={labelText(action, hover, sortedTiers)} valid={valid} />
      )}
    </g>
  )
}

function HoverQuad({ node, cam, fit, ft, stroke }: { node: PositionedNode; cam: CameraState; fit: FitTransform; ft: number; stroke: string }) {
  const quad = topQuadForNode(node, ft, cam).map((p) => ({ sx: p.sx * fit.scale + fit.tx, sy: p.sy * fit.scale + fit.ty }))
  return <path d={pathOf(quad)} fill="rgba(255,209,102,0.18)" stroke={stroke} strokeWidth={2} strokeDasharray="6,4" />
}

function Ghost({ node, cam, fit, ft, mx, my, stroke }: { node: PositionedNode; cam: CameraState; fit: FitTransform; ft: number; mx: number; my: number; stroke: string }) {
  const quad = topQuadForNode(node, ft, cam)
  const cx = (quad[0]!.sx + quad[1]!.sx + quad[2]!.sx + quad[3]!.sx) / 4
  const cy = (quad[0]!.sy + quad[1]!.sy + quad[2]!.sy + quad[3]!.sy) / 4
  const moved = quad.map((p) => ({ sx: mx + (p.sx - cx) * fit.scale, sy: my + (p.sy - cy) * fit.scale }))
  return <path d={pathOf(moved)} fill="rgba(255,209,102,0.20)" stroke={stroke} strokeWidth={1.5} strokeDasharray="4,4" />
}

function TierBand({ z, layout, cam, fit, halfH }: { tier: Tier; z: number; layout: LayoutResult; cam: CameraState; fit: FitTransform; halfH: number }) {
  const cx = (layout.worldWidth || 0) / 2
  const cy = (layout.worldHeight || 0) / 2
  const sy = project(cx, cy, z, cam).sy * fit.scale + fit.ty
  return <rect x={-9999} y={sy - halfH} width={20000} height={halfH * 2} fill="rgba(255,209,102,0.10)" />
}

function DropLabel({ mx, my, text, valid }: { mx: number; my: number; text: string; valid: boolean }) {
  const padding = 6
  const fontSize = 11
  const charW = 6.6
  const w = Math.max(40, text.length * charW + padding * 2)
  const h = fontSize + padding * 2
  return (
    <g transform={`translate(${mx + 14},${my + 12})`}>
      <rect x={0} y={0} width={w} height={h} rx={4} fill={valid ? 'rgba(20,24,32,0.92)' : 'rgba(60,15,15,0.92)'} stroke={valid ? '#ffd166' : '#ef4444'} strokeWidth={1} />
      <text x={padding} y={fontSize + padding - 2} fontFamily="JetBrains Mono, monospace" fontSize={fontSize} fill={valid ? '#ffd166' : '#fca5a5'}>{text}</text>
    </g>
  )
}

function labelText(action: DropAction, hover: HitResult | null, _tiers: Tier[]): string {
  switch (action.type) {
    case 'noop': return 'No change'
    case 'invalid': return action.reason === 'circular' ? 'Cannot move into descendant' : action.reason === 'merge requires sibling target' ? 'Merge needs sibling' : 'Invalid'
    case 'reparent': {
      const name = hover?.kind === 'board' ? hover.node.node.displayName ?? hover.node.node.name : '?'
      return `Move into ${truncate(name, 18)}`
    }
    case 'merge': {
      const name = hover?.kind === 'board' ? hover.node.node.displayName ?? hover.node.node.name : '?'
      return `Merge into ${truncate(name, 18)}`
    }
    case 'move-tier': {
      const t = hover?.kind === 'tier' ? hover.tier : null
      return `Move to ${t?.name ?? `tier ${t?.position ?? action.tierId}`}`
    }
    case 'promote-to-tier': {
      const t = hover?.kind === 'tier' ? hover.tier : null
      return `Promote to ${t?.name ?? `tier ${t?.position ?? action.tierId}`}`
    }
    case 'orphan': return 'Make orphan'
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

function pathOf(pts: ScreenPoint[]): string {
  return `M${pts.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join('L')}Z`
}

function topQuadForNode(node: PositionedNode, ft: number, cam: CameraState): ScreenPoint[] {
  const isBoard = node.expanded && node.children.length > 0
  let thickness = 0
  if (isBoard) {
    if (node.depth === 0) thickness = ft
    else { thickness = ft; for (let d = 1; d <= node.depth; d++) thickness = Math.max(4, thickness - d * 2) }
  }
  const z = node.z + thickness
  return [
    project(node.x, node.y, z, cam),
    project(node.x + node.w, node.y, z, cam),
    project(node.x + node.w, node.y + node.h, z, cam),
    project(node.x, node.y + node.h, z, cam),
  ]
}

function findPositioned(roots: PositionedNode[], id: NodeId): PositionedNode | null {
  const search = (n: PositionedNode): PositionedNode | null => {
    if (n.node.id === id) return n
    for (const c of n.children) { const r = search(c); if (r) return r }
    return null
  }
  for (const r of roots) { const f = search(r); if (f) return f }
  return null
}
