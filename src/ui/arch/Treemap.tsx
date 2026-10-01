import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy'
import type { ArchNode, NodeId } from './types.js'

export interface TreemapProps {
  floors: ArchNode[]
  hiddenFloors: number[]
  selectedId: NodeId | null
  onSelect: (id: NodeId | null) => void
}

interface Cell {
  node: ArchNode
  x: number
  y: number
  w: number
  h: number
}

const OUTER_PAD = 14
const INNER_GAP = 10
const TOP_PAD = 26
const MIN_LABEL_W = 60
const MIN_LABEL_H = 28

export function Treemap({ floors, hiddenFloors, selectedId, onSelect }: TreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visible = useMemo(() => {
    const hidden = new Set(hiddenFloors)
    return floors.map((f, idx) => ({ f, idx })).filter(({ idx }) => !hidden.has(idx))
  }, [floors, hiddenFloors])

  const cells = useMemo<Cell[]>(() => {
    if (size.w <= 0 || size.h <= 0 || visible.length === 0) return []
    const root = hierarchy<{ children?: ArchNode[]; node?: ArchNode }>({
      children: visible.map(({ f }) => ({ node: f })),
    })
      .sum((d) => (d.node ? Math.sqrt(Math.max(1, d.node.fileCount)) : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

    treemap<{ children?: ArchNode[]; node?: ArchNode }>()
      .tile(treemapSquarify)
      .size([size.w - OUTER_PAD * 2, size.h - OUTER_PAD * 2])
      .paddingInner(INNER_GAP)
      .round(true)(root)

    const out: Cell[] = []
    for (const leaf of root.leaves()) {
      if (!leaf.data.node) continue
      out.push({
        node: leaf.data.node,
        x: leaf.x0 + OUTER_PAD,
        y: leaf.y0 + OUTER_PAD,
        w: leaf.x1 - leaf.x0,
        h: leaf.y1 - leaf.y0,
      })
    }
    return out
  }, [visible, size])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedId !== null) onSelect(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, onSelect])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-surface-0"
      onClick={(e) => { if (e.target === e.currentTarget) onSelect(null) }}
    >
      {cells.map((c) => (
        <ModuleCell
          key={c.node.id}
          cell={c}
          selected={selectedId === c.node.id}
          onClick={() => onSelect(c.node.id)}
        />
      ))}
    </div>
  )
}

function ModuleCell({ cell, selected, onClick }: { cell: Cell; selected: boolean; onClick: () => void }) {
  const { node, x, y, w, h } = cell
  const showLabel = w >= MIN_LABEL_W && h >= MIN_LABEL_H
  const display = node.displayName ?? node.name
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      style={{ left: x, top: y, width: w, height: h }}
      className={[
        'absolute flex flex-col items-start justify-start overflow-hidden rounded-md border text-left transition',
        selected
          ? 'border-focus bg-interactive-hover ring-2 ring-focus ring-offset-1 ring-offset-surface-0'
          : 'border-hairline-strong bg-surface-1 hover:bg-interactive-hover',
      ].join(' ')}
      title={`${display} · ${node.fileCount} files`}
    >
      {showLabel ? (
        <div className="flex w-full items-baseline justify-between gap-2 px-3" style={{ paddingTop: 8 }}>
          <span className="truncate text-[12.5px] font-medium text-fg">{display}</span>
          <span className="shrink-0 tabular-nums text-[11px] text-fg-faint">{node.fileCount}</span>
        </div>
      ) : (
        <span className="m-auto text-[10px] tabular-nums text-fg-faint">{node.fileCount}</span>
      )}
    </button>
  )
}
