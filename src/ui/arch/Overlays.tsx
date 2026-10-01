import { useState } from 'react'
import { TIER_PALETTES } from './ArchScene.js'
import type { ArchNode } from './types.js'

const LEGEND_COLLAPSED_COUNT = 3

export interface StatsHudProps {
  show: boolean
  floors: number
  visibleNodes: number
  edges: number
  files: number
  pxPerFile: number
}

export function StatsHud({ show, floors, visibleNodes, edges, files, pxPerFile }: StatsHudProps) {
  if (!show) return null
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-30 rounded-md border border-hairline bg-surface-2/95 px-3 py-2 backdrop-blur-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12px] tabular-nums text-fg-dim">
        <span><span className="text-fg">{floors}</span> floors</span>
        <span><span className="text-fg">{visibleNodes}</span> nodes</span>
        <span><span className="text-fg">{files}</span> files</span>
        <span><span className="text-fg">{edges}</span> edges</span>
        <span className="col-span-2 text-fg-faint">~{pxPerFile} px²/file</span>
      </div>
    </div>
  )
}

export interface LegendHudProps {
  show: boolean
  floors: ArchNode[]
  hiddenFloors: number[]
  onToggleFloor: (idx: number) => void
}

export function LegendHud({ show, floors, hiddenFloors, onToggleFloor }: LegendHudProps) {
  const [expanded, setExpanded] = useState(false)
  if (!show) return null
  const hidden = new Set(hiddenFloors)
  const overflow = floors.length - LEGEND_COLLAPSED_COUNT
  const visible = expanded || overflow <= 0 ? floors : floors.slice(0, LEGEND_COLLAPSED_COUNT)
  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-30 flex max-h-[60%] flex-col gap-0.5 overflow-y-auto rounded-md border border-hairline bg-surface-2/95 px-2.5 py-2 backdrop-blur-sm">
      {visible.map((f, idx) => {
        const palette = TIER_PALETTES[idx % TIER_PALETTES.length]!
        const isHidden = hidden.has(idx)
        const display = f.displayName ?? f.name
        return (
          <button
            key={f.id}
            onClick={() => onToggleFloor(idx)}
            className={[
              'flex items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] transition',
              isHidden ? 'opacity-40' : 'opacity-100',
              'text-fg-muted hover:bg-interactive',
            ].join(' ')}
          >
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: palette.top, border: `1px solid ${palette.chip}` }} />
            <span className="max-w-[140px] truncate">{display}</span>
            <span className="ml-auto tabular-nums text-fg-faint">{f.fileCount}</span>
          </button>
        )
      })}
      {overflow > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 flex items-center justify-center gap-1 rounded px-1.5 py-1 text-[11px] text-fg-faint transition hover:bg-interactive hover:text-fg"
        >
          {expanded ? 'Show less' : `Show ${overflow} more`}
        </button>
      )}
    </div>
  )
}

export interface MinimapProps {
  show: boolean
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null
  // We will pass cached chip rectangles in screen space (already projected)
  rects: Array<{ x: number; y: number; w: number; h: number; color: string }>
}

export function Minimap({ show, bbox, rects }: MinimapProps) {
  if (!show || !bbox) return null
  const w = bbox.maxX - bbox.minX
  const h = bbox.maxY - bbox.minY
  if (w <= 0 || h <= 0) return null
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-30 h-[140px] w-[180px] overflow-hidden rounded-md border border-hairline bg-surface-2/95 backdrop-blur-sm">
      <svg width="100%" height="100%" viewBox={`${bbox.minX} ${bbox.minY} ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        {rects.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.color} fillOpacity={0.85} stroke={r.color} strokeOpacity={0.4} strokeWidth={1.5} />
        ))}
      </svg>
    </div>
  )
}
