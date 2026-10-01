import type { ModuleRelation, RelationCategory, RelationDirection } from '../api.js'
import type { NodeId } from './types.js'

const CATEGORY_COLOR: Record<RelationCategory, string> = {
  depends:   '#7eb6ff',
  shares:    '#5dd6a8',
  observes:  '#f5b85a',
  contracts: '#c285ff',
}

interface Pos { sx: number; sy: number }

export interface RelationsLayerProps {
  relations: ModuleRelation[]
  topLevelScreen: Map<NodeId, Pos>
  hoveredRelationId: number | null
  selectedRelationId: number | null
  onHover: (id: number | null) => void
  onSelect: (rel: ModuleRelation) => void
}

export function RelationsLayer({ relations, topLevelScreen, hoveredRelationId, selectedRelationId, onHover, onSelect }: RelationsLayerProps) {
  if (relations.length === 0) return null
  return (
    <g>
      {relations.map((r) => {
        const a = topLevelScreen.get(r.moduleAId)
        const b = topLevelScreen.get(r.moduleBId)
        if (!a || !b) return null
        return (
          <RelationLine
            key={r.id}
            relation={r}
            a={a} b={b}
            color={CATEGORY_COLOR[r.category]}
            stale={r.fingerprintCurrent !== null && r.fingerprintCurrent !== r.fingerprint}
            hovered={hoveredRelationId === r.id}
            selected={selectedRelationId === r.id}
            onHover={onHover}
            onSelect={onSelect}
          />
        )
      })}
    </g>
  )
}

function RelationLine({ relation, a, b, color, stale, hovered, selected, onHover, onSelect }: {
  relation: ModuleRelation
  a: Pos; b: Pos; color: string; stale: boolean; hovered: boolean; selected: boolean
  onHover: (id: number | null) => void
  onSelect: (rel: ModuleRelation) => void
}) {
  const dx = b.sx - a.sx
  const dy = b.sy - a.sy
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < 5) return null
  const bow = Math.min(dist * 0.18, 60)
  const mx = (a.sx + b.sx) / 2
  const my = (a.sy + b.sy) / 2 - bow
  const d = `M${a.sx.toFixed(1)},${a.sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${b.sx.toFixed(1)},${b.sy.toFixed(1)}`

  // Quadratic bezier midpoint
  const mid = quadAt(a, { sx: mx, sy: my }, b, 0.5)
  const tangent = quadTangent(a, { sx: mx, sy: my }, b, 0.5)
  const angle = Math.atan2(tangent.dy, tangent.dx)

  const baseOpacity = stale ? 0.35 : 0.55
  const opacity = selected ? 1 : (hovered ? 0.95 : baseOpacity)
  const strokeWidth = selected ? 2.6 : (hovered ? 2.0 : 1.4)

  return (
    <g
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => onHover(relation.id)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onSelect(relation) }}
    >
      <path d={d} fill="none" stroke="transparent" strokeWidth={16} pointerEvents="stroke" />
      <path d={d} fill="none" stroke={color} strokeOpacity={opacity} strokeWidth={strokeWidth}
        strokeDasharray={stale ? '5,4' : undefined} pointerEvents="none" />
      {relation.direction !== 'shared' && (
        <Arrow color={color} opacity={opacity} mid={mid} angle={angle} reverse={relation.direction === 'b_to_a'} />
      )}
      {selected && (
        <LabelChip text={relation.label} mid={mid} angle={angle} color={color} opacity={1} stale={stale} />
      )}
    </g>
  )
}

function Arrow({ color, opacity, mid, angle, reverse }: { color: string; opacity: number; mid: Pos; angle: number; reverse: boolean }) {
  const a = reverse ? angle + Math.PI : angle
  const size = 7
  const tip = { x: mid.sx + Math.cos(a) * size, y: mid.sy + Math.sin(a) * size }
  const left = { x: mid.sx + Math.cos(a + 2.5) * size, y: mid.sy + Math.sin(a + 2.5) * size }
  const right = { x: mid.sx + Math.cos(a - 2.5) * size, y: mid.sy + Math.sin(a - 2.5) * size }
  return (
    <polygon
      points={`${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${left.x.toFixed(1)},${left.y.toFixed(1)} ${right.x.toFixed(1)},${right.y.toFixed(1)}`}
      fill={color} fillOpacity={opacity} pointerEvents="none"
    />
  )
}

function LabelChip({ text, mid, color, opacity, stale }: { text: string; mid: Pos; angle: number; color: string; opacity: number; stale: boolean }) {
  const padX = 6, padY = 3
  const fontSize = 10
  const charW = fontSize * 0.55
  const w = Math.min(text.length, 40) * charW + padX * 2
  const h = fontSize + padY * 2
  return (
    <g transform={`translate(${(mid.sx - w / 2).toFixed(1)},${(mid.sy - h - 8).toFixed(1)})`} pointerEvents="none">
      <rect width={w} height={h} rx={4} fill="rgba(20,24,32,0.92)" stroke={color} strokeOpacity={opacity * 0.7} strokeWidth={0.8} />
      <text x={w / 2} y={h / 2 + fontSize / 3} textAnchor="middle" fontSize={fontSize} fill="#cbd5e1" fontFamily="ui-sans-serif, system-ui, sans-serif">
        {text.length > 40 ? text.slice(0, 38) + '…' : text}
      </text>
      {stale && (
        <text x={w - 4} y={h / 2 + fontSize / 3} textAnchor="end" fontSize={fontSize - 1} fill="#fbbf24" fontFamily="ui-sans-serif, system-ui, sans-serif">↻</text>
      )}
    </g>
  )
}

function quadAt(p0: Pos, p1: Pos, p2: Pos, t: number): Pos {
  const u = 1 - t
  return {
    sx: u * u * p0.sx + 2 * u * t * p1.sx + t * t * p2.sx,
    sy: u * u * p0.sy + 2 * u * t * p1.sy + t * t * p2.sy,
  }
}

function quadTangent(p0: Pos, p1: Pos, p2: Pos, t: number): { dx: number; dy: number } {
  return {
    dx: 2 * (1 - t) * (p1.sx - p0.sx) + 2 * t * (p2.sx - p1.sx),
    dy: 2 * (1 - t) * (p1.sy - p0.sy) + 2 * t * (p2.sy - p1.sy),
  }
}
