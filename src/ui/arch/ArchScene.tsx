import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Module, ModuleEdge, ModuleRelation, Tier, TurnSummary } from '../api.js'
import { RelationsLayer } from './RelationsLayer.js'
import { TurnSummaryChips } from './TurnSummaryChips.js'
import { buildTree, findById, findRootContaining } from './tree.js'
import { layoutTree, layoutOptionsFromSettings, eachNode, type LayoutResult } from './layout.js'
import { aggregateEdges } from './edges.js'
import { center, pathFrom, project, quadBack, quadFront, quadLeft, quadRight, quadTop, visibleSides } from './iso.js'
import { type ArchNode, type CameraState, type NodeId, type PositionedNode } from './types.js'
import type { ArchSettings } from './settings.js'
import { resolveDropAction, useDrag, type DropAction } from './drag.js'
import type { HitResult } from './hit.js'
import { DragOverlay } from './DragOverlay.js'
import { useCameraStore } from './cameraStore.js'

export const TIER_PALETTES = [
  { top: '#1e3a5f', side: '#152d4d', front: '#17324f', chip: '#4d9fff', chipBg: 'rgba(77,159,255,0.10)', chipBgHover: 'rgba(77,159,255,0.22)', text: '#8bbfff', label: '#a0cfff' },
  { top: '#2d1f4d', side: '#231840', front: '#281b45', chip: '#a07cff', chipBg: 'rgba(160,124,255,0.10)', chipBgHover: 'rgba(160,124,255,0.22)', text: '#b99fff', label: '#c9b5ff' },
  { top: '#1a3a2a', side: '#132e20', front: '#163224', chip: '#3dd68c', chipBg: 'rgba(61,214,140,0.10)', chipBgHover: 'rgba(61,214,140,0.22)', text: '#6ee7b7', label: '#87edd0' },
  { top: '#3a2a1a', side: '#2e2013', front: '#322316', chip: '#f5a623', chipBg: 'rgba(245,166,35,0.10)', chipBgHover: 'rgba(245,166,35,0.22)', text: '#fbbf24', label: '#fcd87c' },
  { top: '#3a1a30', side: '#2e1326', front: '#32162a', chip: '#f06292', chipBg: 'rgba(240,98,146,0.10)', chipBgHover: 'rgba(240,98,146,0.22)', text: '#f48fb1', label: '#f8b4cc' },
  { top: '#1a2d3a', side: '#13232e', front: '#162632', chip: '#22d3ee', chipBg: 'rgba(34,211,238,0.10)', chipBgHover: 'rgba(34,211,238,0.22)', text: '#67e8f9', label: '#99f0ff' },
  { top: '#3a1a1a', side: '#2e1313', front: '#321616', chip: '#ef4444', chipBg: 'rgba(239,68,68,0.10)', chipBgHover: 'rgba(239,68,68,0.22)', text: '#fca5a5', label: '#fecaca' },
  { top: '#2a3a1a', side: '#202e13', front: '#233216', chip: '#84cc16', chipBg: 'rgba(132,204,22,0.10)', chipBgHover: 'rgba(132,204,22,0.22)', text: '#bef264', label: '#d9f99d' },
  { top: '#1a1a3a', side: '#13132e', front: '#161632', chip: '#818cf8', chipBg: 'rgba(129,140,248,0.10)', chipBgHover: 'rgba(129,140,248,0.22)', text: '#a5b4fc', label: '#c7d2fe' },
  { top: '#2e2e2e', side: '#222', front: '#262626', chip: '#94a3b8', chipBg: 'rgba(148,163,184,0.10)', chipBgHover: 'rgba(148,163,184,0.22)', text: '#cbd5e1', label: '#e2e8f0' },
] as const

export type Palette = (typeof TIER_PALETTES)[number]

export interface ArchSceneProps {
  modules: Module[]
  tiers: Tier[]
  edges: ModuleEdge[]
  relations: ModuleRelation[]
  selectedId: NodeId | null
  selectedRelationId: number | null
  turnSummaries: TurnSummary[]
  chipsLive: boolean
  onSelect: (id: NodeId | null) => void
  onSelectRelation?: (rel: ModuleRelation) => void
  onSelectTurnSummary?: (summary: TurnSummary) => void
  settings: ArchSettings
  onCameraChange: (rotZDeg: number, rotXDeg: number) => void
  onLayoutMeta?: (meta: { floors: number; visibleNodes: number; edges: number; bbox: { minX: number; minY: number; maxX: number; maxY: number }; minimapRects: Array<{ x: number; y: number; w: number; h: number; color: string }> }) => void
  onDropMutation: (sourceId: NodeId, action: DropAction) => void | Promise<void>
  mutationPending: boolean
}

export function ArchScene({ modules, tiers, edges, relations, selectedId, selectedRelationId, turnSummaries, chipsLive, onSelect, onSelectRelation, onSelectTurnSummary, settings, onCameraChange, onLayoutMeta, onDropMutation, mutationPending }: ArchSceneProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const pan = useCameraStore((s) => s.pan)
  const zoom = useCameraStore((s) => s.zoom)
  const size = useCameraStore((s) => s.size)
  const setSize = useCameraStore((s) => s.setSize)
  const [hoverId, setHoverId] = useState<NodeId | null>(null)
  const [hoveredRelationId, setHoveredRelationId] = useState<number | null>(null)
  const dragRef = useRef<{ kind: 'rotate' | 'pan'; startX: number; startY: number; startRotZ?: number; startRotX?: number; startPan?: { x: number; y: number }; moved: boolean } | null>(null)
  const justDraggedRef = useRef(false)

  const cam: CameraState = useMemo(() => ({
    rotZ: (settings.rotZDeg * Math.PI) / 180,
    rotX: (settings.rotXDeg * Math.PI) / 180,
  }), [settings.rotZDeg, settings.rotXDeg])

  useEffect(() => { useCameraStore.getState().setCam(cam) }, [cam])

  const tree = useMemo(() => buildTree(modules), [modules])
  const layoutOpts = useMemo(() => layoutOptionsFromSettings(settings), [settings])
  const expanded = useMemo(() => {
    if (hoverId === null) return new Set<NodeId>()
    const root = findRootContaining(tree, hoverId)
    return root ? new Set<NodeId>([root.id]) : new Set<NodeId>()
  }, [hoverId, tree])
  const relationLinks = useMemo(() => relations.map((r) => ({ aId: r.moduleAId, bId: r.moduleBId })), [relations])
  const layout = useMemo(() => layoutTree(tree, tiers, expanded, layoutOpts, settings.hiddenFloors, relationLinks), [tree, tiers, expanded, layoutOpts, settings.hiddenFloors, relationLinks])
  const visibleEdges = useMemo(
    () => settings.showEdges ? aggregateEdges(layout.floors, edges, settings.edgeMaxCount) : [],
    [layout, edges, settings.showEdges, settings.edgeMaxCount],
  )

  useEffect(() => {
    if (!wrapRef.current) return
    const measure = () => {
      const r = wrapRef.current!.getBoundingClientRect()
      setSize({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const fit = useMemo(() => {
    if (layout.floors.length === 0) return { tx: 0, ty: 0, scale: 1, bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }
    return computeFit(layout, cam, size.w, size.h)
  }, [layout, cam, size])

  const dataChangedRef = useRef(false)
  useEffect(() => { dataChangedRef.current = true }, [layout.floors])

  const prevFitRef = useRef<{ tx: number; ty: number; scale: number } | null>(null)
  useEffect(() => {
    const dataChanged = dataChangedRef.current
    dataChangedRef.current = false
    const prev = prevFitRef.current
    if (dataChanged && prev) {
      const z = useCameraStore.getState().zoom
      const oldPan = useCameraStore.getState().pan
      const oldScale = prev.scale * z
      const newScale = fit.scale * z
      if (oldScale > 0 && newScale > 0) {
        const cx = size.w / 2
        const cy = size.h / 2
        const worldX = (cx - prev.tx - oldPan.x) / oldScale
        const worldY = (cy - prev.ty - oldPan.y) / oldScale
        const newPanX = cx - fit.tx - worldX * newScale
        const newPanY = cy - fit.ty - worldY * newScale
        if (Math.abs(newPanX - oldPan.x) > 0.5 || Math.abs(newPanY - oldPan.y) > 0.5) {
          useCameraStore.getState().setPan({ x: newPanX, y: newPanY })
        }
      }
    }
    prevFitRef.current = { tx: fit.tx, ty: fit.ty, scale: fit.scale }
    useCameraStore.getState().setFit({ tx: fit.tx, ty: fit.ty, scale: fit.scale })
  }, [fit, size.w, size.h])

  useEffect(() => { useCameraStore.getState().setFloors(layout.floors) }, [layout.floors])

  useEffect(() => {
    if (!onLayoutMeta) return
    let visible = 0
    const rects: Array<{ x: number; y: number; w: number; h: number; color: string }> = []
    for (const floor of layout.floors) {
      const palette = TIER_PALETTES[floor.floorIndex! % TIER_PALETTES.length]!
      eachFloorNode(floor, (n) => {
        visible++
        const pts = quadTop(n.x, n.y, n.w, n.h, n.z + layoutOpts.floorThickness, cam)
        const xs = pts.map((p) => p.sx); const ys = pts.map((p) => p.sy)
        const minX = Math.min(...xs); const maxX = Math.max(...xs)
        const minY = Math.min(...ys); const maxY = Math.max(...ys)
        rects.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, color: n === floor ? palette.top : palette.chip })
      })
    }
    onLayoutMeta({ floors: layout.floors.length, visibleNodes: visible, edges: visibleEdges.length, bbox: fit.bbox, minimapRects: rects })
  }, [layout, visibleEdges, fit, onLayoutMeta, cam, layoutOpts])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (useCameraStore.getState().flightCount > 0) return
    if (e.button === 2 || e.shiftKey || e.metaKey) {
      e.preventDefault()
      dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, startPan: pan, moved: false }
    } else if (e.button === 0) {
      dragRef.current = { kind: 'rotate', startX: e.clientX, startY: e.clientY, startRotZ: settings.rotZDeg, startRotX: settings.rotXDeg, moved: false }
    }
  }, [settings.rotZDeg, settings.rotXDeg, pan])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
      if (d.kind === 'rotate' && d.startRotZ !== undefined && d.startRotX !== undefined) {
        const rz = d.startRotZ + dx * 0.3
        const rx = clamp(d.startRotX + dy * 0.3, 3, 87)
        onCameraChange(rz, rx)
      } else if (d.kind === 'pan' && d.startPan) {
        useCameraStore.getState().setPan({ x: d.startPan.x + dx, y: d.startPan.y + dy })
      }
    }
    const onUp = () => {
      const d = dragRef.current
      if (d?.moved) {
        justDraggedRef.current = true
        setTimeout(() => { justDraggedRef.current = false }, 0)
      }
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [onCameraChange])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = Math.exp(-e.deltaY * 0.0015)
    const z = useCameraStore.getState().zoom
    useCameraStore.getState().setZoom(clamp(z * factor, 0.15, 6))
  }, [])

  const tx = fit.tx + pan.x
  const ty = fit.ty + pan.y
  const scale = fit.scale * zoom
  const chipScreen = useMemo(() => collectChipScreen(layout.floors, cam), [layout, cam])
  const topLevelScreen = useMemo(() => {
    const map = new Map<NodeId, { sx: number; sy: number }>()
    for (const f of layout.floors) map.set(f.node.id, center(f.x, f.y, f.w, f.h, f.z, cam))
    return map
  }, [layout, cam])
  const anyExpanded = expanded.size > 0
  const pinnedSet = useMemo(() => new Set(settings.pinned), [settings.pinned])

  const resolveAction = useCallback((sourceId: NodeId, hover: HitResult, modifier: 'none' | 'shift'): DropAction => {
    const src = findById(tree, sourceId)
    if (!src) return { type: 'noop' }
    return resolveDropAction(src, hover, modifier, tree)
  }, [tree])

  const drag = useDrag({
    wrapperRef: wrapRef,
    layout,
    tiers,
    cam,
    fit: { tx, ty, scale },
    resolveAction,
    onDrop: onDropMutation,
    enabled: !mutationPending,
  })

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full select-none overflow-hidden"
      style={{ cursor: drag.state?.moved ? (drag.state.preview.type === 'invalid' ? 'not-allowed' : 'grabbing') : dragRef.current?.kind === 'rotate' ? 'grabbing' : dragRef.current?.kind === 'pan' ? 'grabbing' : 'grab' }}
      onMouseDown={onMouseDown}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
      onClickCapture={(e) => {
        if (justDraggedRef.current || drag.justDroppedRef.current) { e.stopPropagation(); e.preventDefault() }
      }}
    >
      <svg width={size.w} height={size.h} style={{ display: 'block' }}>
        <defs>
          <filter id="arch-shadow" x="-20%" y="-10%" width="150%" height="150%">
            <feDropShadow dx={0} dy={4} stdDeviation={8} floodColor="rgba(0,0,0,0.45)" />
          </filter>
          {settings.showShading && TIER_PALETTES.map((p, i) => (
            <linearGradient key={i} id={`arch-shade-${i}`} x1="20%" y1="0%" x2="80%" y2="100%">
              <stop offset="0%" stopColor={p.top} stopOpacity={1} />
              <stop offset="100%" stopColor={p.side} stopOpacity={1} />
            </linearGradient>
          ))}
        </defs>
        <g transform={`translate(${tx},${ty}) scale(${scale})`}>
          {settings.showEdges && anyExpanded && (
            <EdgesLayer edges={visibleEdges} chipScreen={chipScreen} edgeStyle={settings.edgeStyle} />
          )}
          <RelationsLayer
            relations={relations}
            topLevelScreen={topLevelScreen}
            hoveredRelationId={hoveredRelationId}
            selectedRelationId={selectedRelationId}
            onHover={setHoveredRelationId}
            onSelect={(rel) => onSelectRelation?.(rel)}
          />
          {layout.floors.map((floor) => (
            <FloorView
              key={floor.node.id}
              node={floor}
              cam={cam}
              palette={TIER_PALETTES[floor.floorIndex! % TIER_PALETTES.length]!}
              tierIndex={floor.floorIndex! % TIER_PALETTES.length}
              selectedId={selectedId}
              hoverId={hoverId}
              pinnedSet={pinnedSet}
              onSelect={onSelect}
              onHover={setHoverId}
              thickness={layout.options.floorThickness}
              showFloorLabels={settings.showFloorLabels}
              showChipLabels={settings.showChipLabels}
              showShading={settings.showShading}
              beginDrag={drag.beginDrag}
              draggingId={drag.state?.sourceId ?? null}
            />
          ))}
          <TurnSummaryChips
            summaries={turnSummaries}
            isLive={chipsLive}
            fontSize={settings.chipFontSize}
            topLevelScreen={topLevelScreen}
            onSelect={(s) => onSelectTurnSummary?.(s)}
          />
        </g>
        {drag.state && (
          <DragOverlay
            drag={drag.state}
            layout={layout}
            cam={cam}
            fit={{ tx, ty, scale }}
            sortedTiers={[...tiers].sort((a, b) => a.position - b.position)}
            bandHalfHeight={Math.max(20, (layoutOpts.floorGapZ * scale) / 4)}
          />
        )}
      </svg>
    </div>
  )
}

function FloorView({
  node, cam, palette, tierIndex, selectedId, hoverId, pinnedSet, onSelect, onHover, thickness,
  showFloorLabels, showChipLabels, showShading, beginDrag, draggingId,
}: {
  node: PositionedNode
  cam: CameraState
  palette: Palette
  tierIndex: number
  selectedId: NodeId | null
  hoverId: NodeId | null
  pinnedSet: Set<NodeId>
  onSelect: (id: NodeId | null) => void
  onHover: (id: NodeId | null) => void
  thickness: number
  showFloorLabels: boolean
  showChipLabels: boolean
  showShading: boolean
  beginDrag: (id: NodeId, e: React.MouseEvent) => void
  draggingId: NodeId | null
}) {
  return (
    <g>
      <PlateBoard
        node={node} cam={cam} palette={palette} tierIndex={tierIndex} thickness={thickness}
        selected={selectedId === node.node.id} hover={hoverId === node.node.id} pinned={pinnedSet.has(node.node.id)}
        onSelect={onSelect} onHover={onHover} isFloor showLabel={showFloorLabels} showShading={showShading}
        beginDrag={beginDrag} dragging={draggingId === node.node.id}
      />
      {renderInside(node, cam, palette, tierIndex, selectedId, hoverId, pinnedSet, onSelect, onHover, thickness, showFloorLabels, showChipLabels, showShading, beginDrag, draggingId)}
    </g>
  )
}

function renderInside(
  parent: PositionedNode, cam: CameraState, palette: Palette, tierIndex: number,
  selectedId: NodeId | null, hoverId: NodeId | null, pinnedSet: Set<NodeId>,
  onSelect: (id: NodeId | null) => void, onHover: (id: NodeId | null) => void, thickness: number,
  showFloorLabels: boolean, showChipLabels: boolean, showShading: boolean,
  beginDrag: (id: NodeId, e: React.MouseEvent) => void, draggingId: NodeId | null,
): React.ReactNode {
  return parent.children.map((child) => {
    if (!child.expanded || child.children.length === 0) {
      return (
        <Chip
          key={child.node.id}
          node={child} cam={cam} palette={palette}
          selected={selectedId === child.node.id}
          hover={hoverId === child.node.id}
          pinned={pinnedSet.has(child.node.id)}
          onSelect={onSelect} onHover={onHover}
          showLabel={showChipLabels}
          beginDrag={beginDrag} dragging={draggingId === child.node.id}
        />
      )
    }
    const subThickness = Math.max(4, thickness - child.depth * 2)
    return (
      <g key={child.node.id}>
        <PlateBoard
          node={child} cam={cam} palette={palette} tierIndex={tierIndex} thickness={subThickness}
          selected={selectedId === child.node.id} hover={hoverId === child.node.id} pinned={pinnedSet.has(child.node.id)}
          onSelect={onSelect} onHover={onHover} isFloor={false}
          showLabel={showChipLabels} showShading={showShading}
          beginDrag={beginDrag} dragging={draggingId === child.node.id}
        />
        {renderInside(child, cam, palette, tierIndex, selectedId, hoverId, pinnedSet, onSelect, onHover, subThickness, showFloorLabels, showChipLabels, showShading, beginDrag, draggingId)}
      </g>
    )
  })
}

function PlateBoard({
  node, cam, palette, tierIndex, thickness, selected, hover, pinned, onSelect, onHover, isFloor, showLabel, showShading, beginDrag, dragging,
}: {
  node: PositionedNode
  cam: CameraState
  palette: Palette
  tierIndex: number
  thickness: number
  selected: boolean
  hover: boolean
  pinned: boolean
  onSelect: (id: NodeId | null) => void
  onHover: (id: NodeId | null) => void
  isFloor: boolean
  showLabel: boolean
  showShading: boolean
  beginDrag: (id: NodeId, e: React.MouseEvent) => void
  dragging: boolean
}) {
  const top = quadTop(node.x, node.y, node.w, node.h, node.z + thickness, cam)
  const sides = visibleSides(cam)
  const ySidePts = sides.y === 'front'
    ? quadFront(node.x, node.y, node.w, node.h, node.z + thickness, thickness, cam)
    : quadBack(node.x, node.y, node.w, node.h, node.z + thickness, thickness, cam)
  const xSidePts = sides.x === 'right'
    ? quadRight(node.x, node.y, node.w, node.h, node.z + thickness, thickness, cam)
    : quadLeft(node.x, node.y, node.w, node.h, node.z + thickness, thickness, cam)
  const labelOutsideY = sides.y === 'front' ? node.y - 22 : node.y + node.h + 22
  const subY = sides.y === 'front' ? node.y - 10 : node.y + node.h + 10
  const labelPt = project(node.x + node.w / 2, labelOutsideY, node.z + thickness, cam)
  const fileCountPt = project(node.x + node.w / 2, subY, node.z + thickness, cam)
  const display = node.node.displayName ?? node.node.name
  const stroke = pinned ? '#ffd166' : selected ? '#fff' : hover ? palette.label : palette.chip
  const strokeOpacity = pinned ? 0.95 : selected ? 0.9 : hover ? 0.6 : 0.3
  const strokeWidth = pinned ? 1.4 : selected ? 1.4 : hover ? 1 : 0.5
  const topFill = showShading && isFloor ? `url(#arch-shade-${tierIndex})` : palette.top
  return (
    <g
      style={{ cursor: 'pointer', opacity: dragging ? 0.3 : 1 }}
      onMouseEnter={() => onHover(node.node.id)}
      onMouseLeave={() => onHover(null)}
      onMouseDown={(e) => { if (e.button === 0) { e.stopPropagation(); beginDrag(node.node.id, e) } }}
      onClick={(e) => { e.stopPropagation(); onSelect(node.node.id) }}
    >
      <path d={pathFrom(ySidePts)} fill={palette.front} />
      <path d={pathFrom(xSidePts)} fill={palette.side} />
      <path d={pathFrom(top)} fill={topFill} stroke={stroke} strokeOpacity={strokeOpacity} strokeWidth={strokeWidth} filter={isFloor ? 'url(#arch-shadow)' : undefined} />
      {isFloor && showLabel && (
        <>
          <text x={labelPt.sx} y={labelPt.sy} textAnchor="middle" fontFamily="DM Sans, sans-serif" fontSize={13} fontWeight={700} fill={palette.label} opacity={0.85}>{display}</text>
          <text x={fileCountPt.sx} y={fileCountPt.sy} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={9} fill={palette.chip} opacity={0.55}>{node.node.fileCount} files · {countLeaves(node.node)} modules</text>
        </>
      )}
      {!isFloor && showLabel && node.w > 60 && (
        <text x={labelPt.sx} y={labelPt.sy} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize={9} fontWeight={600} fill={palette.label} opacity={0.7}>{truncate(display, Math.floor(node.w / 5.5))}</text>
      )}
    </g>
  )
}

function Chip({ node, cam, palette, selected, hover, pinned, onSelect, onHover, showLabel, beginDrag, dragging }: {
  node: PositionedNode
  cam: CameraState
  palette: Palette
  selected: boolean
  hover: boolean
  pinned: boolean
  onSelect: (id: NodeId | null) => void
  onHover: (id: NodeId | null) => void
  showLabel: boolean
  beginDrag: (id: NodeId, e: React.MouseEvent) => void
  dragging: boolean
}) {
  const pts = quadTop(node.x, node.y, node.w, node.h, node.z, cam)
  const ctr = center(node.x, node.y, node.w, node.h, node.z, cam)
  const minDim = Math.min(node.w, node.h)
  const fontSize = !showLabel ? 0 : minDim > 50 ? 8 : minDim > 32 ? 6 : minDim > 20 ? 5 : 0
  const display = node.node.displayName ?? node.node.name
  const fill = selected ? palette.chipBgHover : hover ? palette.chipBgHover : palette.chipBg
  const stroke = pinned ? '#ffd166' : selected ? '#fff' : hover ? palette.label : palette.chip
  const strokeOpacity = pinned ? 0.95 : selected ? 0.95 : hover ? 0.85 : 0.35
  const strokeWidth = pinned ? 1.2 : selected ? 1.2 : hover ? 1.0 : 0.5
  return (
    <g
      style={{ cursor: 'pointer', opacity: dragging ? 0.3 : 1 }}
      onMouseEnter={() => onHover(node.node.id)}
      onMouseLeave={() => onHover(null)}
      onMouseDown={(e) => { if (e.button === 0) { e.stopPropagation(); beginDrag(node.node.id, e) } }}
      onClick={(e) => { e.stopPropagation(); onSelect(node.node.id) }}
    >
      <path d={pathFrom(pts)} fill={fill} stroke={stroke} strokeOpacity={strokeOpacity} strokeWidth={strokeWidth} />
      {fontSize > 0 && (
        <text x={ctr.sx} y={ctr.sy} textAnchor="middle" dominantBaseline="middle" fontFamily="JetBrains Mono, monospace" fontSize={fontSize} fontWeight={500} fill={palette.text} opacity={0.85}>
          {truncate(display, Math.max(3, Math.floor(node.w / (fontSize * 0.6))))}
        </text>
      )}
    </g>
  )
}

function EdgesLayer({ edges, chipScreen, edgeStyle }: {
  edges: { sourceId: NodeId; targetId: NodeId; count: number }[]
  chipScreen: Map<NodeId, { sx: number; sy: number }>
  edgeStyle: 'dashed-curve' | 'solid-curve' | 'solid-straight'
}) {
  if (edges.length === 0) return null
  const maxCount = edges.reduce((m, e) => Math.max(m, e.count), 1)
  return (
    <g pointerEvents="none">
      {edges.map((e) => {
        const a = chipScreen.get(e.sourceId)
        const b = chipScreen.get(e.targetId)
        if (!a || !b) return null
        const dx = b.sx - a.sx
        const dy = b.sy - a.sy
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 5) return null
        const bow = Math.min(dist * 0.18, 60)
        const mx = (a.sx + b.sx) / 2
        const my = (a.sy + b.sy) / 2 - bow
        const wn = e.count / maxCount
        const opacity = 0.10 + 0.45 * wn
        const strokeWidth = 0.4 + 1.8 * wn
        const d = edgeStyle === 'solid-straight'
          ? `M${a.sx.toFixed(1)},${a.sy.toFixed(1)} L${b.sx.toFixed(1)},${b.sy.toFixed(1)}`
          : `M${a.sx.toFixed(1)},${a.sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${b.sx.toFixed(1)},${b.sy.toFixed(1)}`
        return (
          <path
            key={`${e.sourceId}-${e.targetId}`}
            d={d}
            fill="none"
            stroke="#7eb6ff"
            strokeOpacity={opacity}
            strokeWidth={strokeWidth}
            strokeDasharray={edgeStyle === 'dashed-curve' ? '5,4' : undefined}
          />
        )
      })}
    </g>
  )
}

function eachFloorNode(node: PositionedNode, visit: (n: PositionedNode) => void): void {
  visit(node)
  for (const c of node.children) eachFloorNode(c, visit)
}

function collectChipScreen(floors: PositionedNode[], cam: CameraState): Map<NodeId, { sx: number; sy: number }> {
  const out = new Map<NodeId, { sx: number; sy: number }>()
  const visit = (n: PositionedNode) => {
    if (!n.expanded || n.children.length === 0) {
      out.set(n.node.id, center(n.x, n.y, n.w, n.h, n.z, cam))
    } else {
      out.set(n.node.id, center(n.x, n.y, n.w, n.h, n.z, cam))
      for (const c of n.children) visit(c)
    }
  }
  for (const f of floors) visit(f)
  return out
}

function computeFit(layout: LayoutResult, cam: CameraState, screenW: number, screenH: number): { tx: number; ty: number; scale: number; bbox: { minX: number; minY: number; maxX: number; maxY: number } } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  eachNode(layout, (n) => {
    const pts = quadTop(n.x, n.y, n.w, n.h, n.z + layout.options.floorThickness, cam)
    for (const p of pts) {
      if (p.sx < minX) minX = p.sx
      if (p.sx > maxX) maxX = p.sx
      if (p.sy < minY) minY = p.sy
      if (p.sy > maxY) maxY = p.sy
    }
  })
  if (!isFinite(minX)) { minX = 0; maxX = 0; minY = 0; maxY = 0 }
  const w = Math.max(1, maxX - minX)
  const h = Math.max(1, maxY - minY)
  const margin = 80
  const scale = Math.min((screenW - margin) / w, (screenH - margin) / h, 2)
  const tx = (screenW - w * scale) / 2 - minX * scale
  const ty = (screenH - h * scale) / 2 - minY * scale
  return { tx, ty, scale, bbox: { minX, minY, maxX, maxY } }
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)) }

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  if (max < 3) return ''
  return s.slice(0, max - 1) + '…'
}

function countLeaves(node: ArchNode): number {
  if (node.children.length === 0) return 1
  let n = 0
  for (const c of node.children) n += countLeaves(c)
  return n
}

