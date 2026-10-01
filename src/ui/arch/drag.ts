import { useCallback, useEffect, useRef, useState, type RefObject, type MutableRefObject } from 'react'
import type { Tier } from '../api.js'
import { hitTest, type FitTransform, type HitResult } from './hit.js'
import type { LayoutResult } from './layout.js'
import { findById } from './tree.js'
import type { ArchNode, CameraState, NodeId } from './types.js'

export type DropAction =
  | { type: 'noop' }
  | { type: 'invalid'; reason: string }
  | { type: 'reparent'; targetId: NodeId }
  | { type: 'merge'; targetId: NodeId }
  | { type: 'move-tier'; tierId: number }
  | { type: 'promote-to-tier'; tierId: number }
  | { type: 'orphan' }

export interface DragState {
  sourceId: NodeId
  startMx: number
  startMy: number
  mx: number
  my: number
  moved: boolean
  modifier: 'none' | 'shift'
  hover: HitResult | null
  preview: DropAction
}

export interface UseDragDeps {
  wrapperRef: RefObject<HTMLDivElement | null>
  layout: LayoutResult
  tiers: Tier[]
  cam: CameraState
  fit: FitTransform
  resolveAction: (sourceId: NodeId, hover: HitResult, modifier: 'none' | 'shift') => DropAction
  onDrop: (sourceId: NodeId, action: DropAction) => void | Promise<void>
  enabled: boolean
}

const MOVE_THRESHOLD_PX = 5

export function isDescendantOfSource(sourceId: NodeId, targetId: NodeId, archRoots: ArchNode[]): boolean {
  const target = findById(archRoots, targetId)
  if (!target) return false
  let pid = target.parentId
  while (pid !== null) {
    if (pid === sourceId) return true
    const p = findById(archRoots, pid)
    if (!p) break
    pid = p.parentId
  }
  return false
}

export function resolveDropAction(
  source: ArchNode,
  hover: HitResult,
  modifier: 'none' | 'shift',
  archRoots: ArchNode[],
): DropAction {
  if (hover.kind === 'empty') {
    if (source.parentId === null && source.tierId === null) return { type: 'noop' }
    return { type: 'orphan' }
  }
  if (hover.kind === 'tier') {
    if (source.parentId === null && source.tierId === hover.tier.id) return { type: 'noop' }
    if (source.parentId === null) return { type: 'move-tier', tierId: hover.tier.id }
    return { type: 'promote-to-tier', tierId: hover.tier.id }
  }
  const target = hover.node.node
  if (target.id === source.id) return { type: 'noop' }
  if (isDescendantOfSource(source.id, target.id, archRoots)) return { type: 'invalid', reason: 'circular' }
  if (modifier === 'shift') {
    if (target.parentId === source.parentId) return { type: 'merge', targetId: target.id }
    return { type: 'invalid', reason: 'merge requires sibling target' }
  }
  if (source.parentId === target.id) return { type: 'noop' }
  return { type: 'reparent', targetId: target.id }
}

export function useDrag(deps: UseDragDeps): {
  state: DragState | null
  beginDrag: (id: NodeId, e: React.MouseEvent) => void
  justDroppedRef: MutableRefObject<boolean>
} {
  const [state, setState] = useState<DragState | null>(null)
  const stateRef = useRef<DragState | null>(null)
  stateRef.current = state
  const justDroppedRef = useRef(false)

  const depsRef = useRef(deps)
  depsRef.current = deps

  const relCoords = useCallback((clientX: number, clientY: number): { mx: number; my: number } => {
    const r = depsRef.current.wrapperRef.current?.getBoundingClientRect()
    return r ? { mx: clientX - r.left, my: clientY - r.top } : { mx: clientX, my: clientY }
  }, [])

  const resolveHover = useCallback((mx: number, my: number, sourceId: NodeId): HitResult => {
    const { layout, tiers, cam, fit } = depsRef.current
    return hitTest(mx, my, layout, tiers, cam, fit, sourceId)
  }, [])

  const beginDrag = useCallback((id: NodeId, e: React.MouseEvent) => {
    if (!depsRef.current.enabled) return
    if (e.button !== 0) return
    const { mx, my } = relCoords(e.clientX, e.clientY)
    const modifier: 'none' | 'shift' = e.shiftKey ? 'shift' : 'none'
    const hover = resolveHover(mx, my, id)
    const preview = depsRef.current.resolveAction(id, hover, modifier)
    setState({ sourceId: id, startMx: mx, startMy: my, mx, my, moved: false, modifier, hover, preview })
  }, [relCoords, resolveHover])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const cur = stateRef.current
      if (!cur) return
      const { mx, my } = relCoords(e.clientX, e.clientY)
      const moved = cur.moved || Math.abs(mx - cur.startMx) + Math.abs(my - cur.startMy) >= MOVE_THRESHOLD_PX
      const modifier: 'none' | 'shift' = e.shiftKey ? 'shift' : 'none'
      const hover = moved ? resolveHover(mx, my, cur.sourceId) : cur.hover
      const preview = hover ? depsRef.current.resolveAction(cur.sourceId, hover, modifier) : cur.preview
      setState({ ...cur, mx, my, moved, modifier, hover, preview })
    }
    const onUp = () => {
      const cur = stateRef.current
      if (!cur) return
      setState(null)
      if (cur.moved) {
        justDroppedRef.current = true
        setTimeout(() => { justDroppedRef.current = false }, 0)
        void depsRef.current.onDrop(cur.sourceId, cur.preview)
      }
    }
    const onLeave = () => {
      if (stateRef.current) setState(null)
    }
    const onKey = (e: KeyboardEvent) => {
      const cur = stateRef.current
      if (!cur) return
      const modifier: 'none' | 'shift' = e.shiftKey ? 'shift' : 'none'
      if (modifier === cur.modifier) return
      const preview = cur.hover ? depsRef.current.resolveAction(cur.sourceId, cur.hover, modifier) : cur.preview
      setState({ ...cur, modifier, preview })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mouseleave', onLeave)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [relCoords, resolveHover])

  return { state, beginDrag, justDroppedRef }
}
