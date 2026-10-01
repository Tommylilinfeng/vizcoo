# Map drag-and-drop implementation plan

Date: 2026-04-26

## Why

Per `feedback_direct_manipulation.md`: invariant 1 (visual position = data position), invariant 2 (every visible relationship is editable), invariant 4 (tool does not impose structure) — none are fully satisfied without drag-and-drop. The current command-button UI works but feels indirect. This plan brings vizcoo to **direct manipulation parity** with what users instinctively try when they see a map.

## Decisions (locked in)

| # | Decision |
|---|---|
| Modifier | **Shift = merge**, no modifier = move/reparent. Explicit, learnable. |
| Source scope | **Both top-level and nested modules are draggable**. |
| Blank canvas drop | **Orphan** (`tier_id = NULL`, `parent_id = NULL`). Invariant 4. |
| Visual feedback | **Ghost follows cursor** + **hover target highlights** + **drop preview label** showing the resolved action. |
| Threshold | Move ≥ 5 pixels before drag triggers (otherwise it's a click). |
| Failure | On API error: revert ghost + show toast + leave data unchanged. |

## Drag → action matrix

Source = the dragged ArchNode. Target = whatever the cursor is over at mouseup.

| Cursor over… | No modifier | + Shift |
|---|---|---|
| Same as source | no-op | no-op |
| Source's ancestor / self subtree | invalid (red cursor) | invalid |
| Another **board** (not ancestor) | **Reparent**: `parent_id = target.id, tier_id = null` | **Merge**(if same parent — siblings)`/api/modules/:target/merge { sourceIds: [source] }` |
| Empty space within a **tier band** | **Move to that tier** (top-level only): `tier_id = target.tier.id, parent_id = null`. If source was nested, this is a **promote+set-tier**. | (same as no-modifier — Shift only meaningful over a board) |
| **Pure blank** (outside all tier z-ranges) | **Orphan**: `parent_id = null, tier_id = null` | (same) |

`isDescendantOfSource(source, target)` — walking `target.parentId` chain, return true if it hits `source.id`. Prevents cycles. (Name reflects what it actually computes: is `target` a descendant of `source`?)

## Architecture

Three components:

### 1. `src/ui/arch/drag.ts` (new)

```ts
export interface DragState {
  sourceId: NodeId
  startScreenX: number
  startScreenY: number
  currentScreenX: number
  currentScreenY: number
  moved: boolean              // true once movement > 5px
  modifier: 'none' | 'shift'
  hover: HitResult | null     // resolved each mousemove
}

export type HitResult =
  | { kind: 'board'; node: PositionedNode }
  | { kind: 'tier'; tier: Tier; z: number }
  | { kind: 'empty' }

export type DropAction =
  | { type: 'noop' }
  | { type: 'invalid'; reason: string }
  | { type: 'reparent'; targetId: NodeId }
  | { type: 'merge'; targetId: NodeId }
  | { type: 'move-tier'; tierId: number }
  | { type: 'promote-to-tier'; tierId: number }
  | { type: 'orphan' }

export function useDrag(deps: {
  layout: LayoutResult
  tiers: Tier[]
  cam: CameraState
  fit: { tx: number; ty: number; scale: number }
  onDrop: (sourceId: NodeId, action: DropAction) => Promise<void>
}): {
  state: DragState | null
  beginDrag: (id: NodeId, e: React.MouseEvent) => void
  // window-level mousemove + mouseup are wired internally via useEffect
}
```

The hook owns all drag state, listens window-level for mousemove/up, computes `hover` on each frame, calls `onDrop` on release with the resolved `DropAction`.

### 2. `src/ui/arch/hit.ts` (new)

```ts
// inverse iso projection helpers
export function unprojectAtZ(sx: number, sy: number, z: number, cam: CameraState): { x: number; y: number }

// point-in-polygon for the iso-projected top-face quad
export function pointInQuad(sx: number, sy: number, quad: ScreenPoint[]): boolean

// main entry — picks topmost board / tier / empty for a screen point
export function hitTest(sx: number, sy: number, layout: LayoutResult, tiers: Tier[], cam: CameraState, sourceId: NodeId): HitResult
```

`hitTest` algorithm:
1. Walk `layout.floors` recursively, top-down (deeper depth first since deeper = on top of parent's surface)
2. For each `PositionedNode`, compute its top-face quad (4 points in screen space using current cam)
3. Skip nodes that are `sourceId` or its descendants (can't drop on self/subtree)
4. First hit wins → return `{ kind: 'board', node }`
5. If none: check if `(sx, sy)` falls within any tier's z band. Each tier has a Z = its position-derived z. Tier band = `[z, z + floorThickness]` projected. If yes → `{ kind: 'tier', tier, z }`
6. Otherwise → `{ kind: 'empty' }`

### 3. `ArchScene.tsx` integration

- Each `Chip` and `PlateBoard` adds `onMouseDown={(e) => beginDrag(node.id, e)}`
- The wrapper div's existing `onMouseDown` (rotate / pan) gets bypassed when drag starts (chip's mousedown calls `e.stopPropagation()`)
- Click vs drag: `mouseup` without `state.moved` → click (selects); `mouseup` with `moved` → drop (calls onDrop)
- Render extras when `state` is set:
  - **Ghost**: a translucent copy of source's chip following `(currentScreenX, currentScreenY)`
  - **Source dim**: source rendered at 30% opacity (so user sees it's "lifted")
  - **Hover highlight**: if `state.hover.kind === 'board'`, render gold dashed border around the target's top-face quad
  - **Tier band highlight**: if `state.hover.kind === 'tier'`, render a translucent gold horizontal band at that z
  - **Drop label**: small text near cursor showing resolved action ("Move into X" / "Merge into X" / "Move to tier 3" / "Promote to tier 3" / "Make orphan" / "Invalid")

## Drop dispatcher (in MapView)

```ts
const onDrop = useCallback(async (sourceId: NodeId, action: DropAction) => {
  switch (action.type) {
    case 'noop': case 'invalid': return
    case 'reparent':
      await patchModuleRequest(sourceId, { parentId: action.targetId, tierId: null }); break
    case 'merge':
      await mergeModulesRequest(action.targetId, [sourceId]); break
    case 'move-tier':
      await patchModuleRequest(sourceId, { tierId: action.tierId, parentId: null }); break
    case 'promote-to-tier':
      await patchModuleRequest(sourceId, { parentId: null, tierId: action.tierId }); break
    case 'orphan':
      await patchModuleRequest(sourceId, { parentId: null, tierId: null }); break
  }
  await load()
}, [load])
```

## Action resolver

```ts
function resolveDropAction(
  source: PositionedNode,
  hover: HitResult,
  modifier: 'none' | 'shift',
  archRoots: ArchNode[],
): DropAction {
  const s = source.node
  if (hover.kind === 'empty') {
    if (s.parentId === null && s.tierId === null) return { type: 'noop' } // already orphan
    return { type: 'orphan' }
  }
  if (hover.kind === 'tier') {
    // Whether top-level or nested, dropping into a tier band means parentId=null + tierId=that tier.
    // No-op when source is already top-level on that tier.
    if (s.parentId === null && s.tierId === hover.tier.id) return { type: 'noop' }
    if (s.parentId === null) return { type: 'move-tier', tierId: hover.tier.id }
    return { type: 'promote-to-tier', tierId: hover.tier.id }
  }
  // hover.kind === 'board'
  const target = hover.node.node
  if (target.id === s.id) return { type: 'noop' }
  if (isDescendantOfSource(s, target, archRoots)) return { type: 'invalid', reason: 'circular' }
  if (modifier === 'shift') {
    if (target.parentId === s.parentId) return { type: 'merge', targetId: target.id }
    return { type: 'invalid', reason: 'merge requires sibling target' }
  }
  if (s.parentId === target.id) return { type: 'noop' } // already a child of target
  return { type: 'reparent', targetId: target.id }
}
```

## Inverse projection (the math)

Forward (from iso.ts):
```
sx = x cos(rZ) - y sin(rZ)
sy = (x sin(rZ) + y cos(rZ)) sin(rX) - z cos(rX)
```

Inverse for a known z plane: solve for (x, y) given (sx, sy):
```
let v = sy + z cos(rX)         // remove z contribution
v / sin(rX) = x sin(rZ) + y cos(rZ)
sx = x cos(rZ) - y sin(rZ)

[ cos(rZ)  -sin(rZ) ] [x]   [sx]
[ sin(rZ)   cos(rZ) ] [y] = [v / sin(rX)]
```

This is a 2D rotation, invert by transposing:
```
x = sx cos(rZ) + (v / sin(rX)) sin(rZ)
y = -sx sin(rZ) + (v / sin(rX)) cos(rZ)
```

Note: degenerates when `sin(rX) ≈ 0` (top-down view). Clamp rX to ≥ 3° (already done in camera limits).

## Hit testing detail

For each `PositionedNode` (at depth N, top-face z = node.z + thickness for boards, z for chips):
1. Compute screen quad: `quadTop(node.x, node.y, node.w, node.h, top_z, cam)` — 4 ScreenPoints
2. After `fit` transform: each point becomes `(p.sx * scale + tx, p.sy * scale + ty)`
3. Mouse `(mx, my)` is in the same coordinate system
4. Run point-in-polygon test (4-vertex convex quad — simple ray casting works)

## Visual feedback (SVG layers)

Render order (bottom up, so later draws on top):
1. Edges (existing)
2. Floors / boards / chips (existing)
3. **Drag ghost** — translucent copy of source's top-face at cursor position
4. **Hover highlight** — gold dashed stroke on target board's top-face, OR gold band on target tier
5. **Drop label** — text at `(currentScreenX + 12, currentScreenY)` showing action description

Ghost rendering: take source node's `quadTop` points, translate to cursor delta, render with `opacity=0.5`, dashed border. Don't render its sub-tree (just the surface).

## Edge cases

| Case | Handling |
|---|---|
| Drag self onto self | `noop` — no API call |
| Drag onto own subtree | `invalid` — show red cursor + label "Cannot move into descendant" |
| Drag during camera rotation (shift+drag from blank) | rotate takes precedence (chip's mousedown only fires when on a chip) |
| Drag while another mutation pending | `mutationPending` boolean lives in MapView (no zustand). Set true before `await` in `onDrop`, false in `finally`. While true, `beginDrag` is a no-op + cursor stays default. |
| Mouseup outside browser | `mouseleave` window listener — cancel drag (no API call) |
| Source no longer exists by mouseup time (race) | API will 404, swallow + toast |
| Shift pressed mid-drag | Modifier re-evaluated on each mousemove — preview updates live |
| Source already at target's tier (move-tier no-op) | Show "Already at this tier" label, no API call |

## Out of scope (V0.2)

- Multi-select drag (lasso or shift-click multi)
- Drop reordering within a tier (changing `position` of siblings)
- Drag entire tiers (vs just modules)
- Animated re-layout on drop (just refetch + re-render)
- Sticky drop zones for tiers (currently hover-band shows but isn't visually rich)

## Phases

### Phase 1 — Inverse projection + hit testing (1.5h)
1. Create `src/ui/arch/hit.ts` with `unprojectAtZ`, `pointInQuad`, `hitTest`
2. Unit-style verification: pick a known chip's center, verify hitTest returns it
3. No UI yet, just the math primitives

### Phase 2 — Drag state machine (1.5h)
4. Create `src/ui/arch/drag.ts` with `useDrag` hook
5. Wire window-level mousemove / mouseup
6. Compute `state.hover` each frame via hitTest
7. No visual feedback yet, just state correctness

### Phase 3 — Drop action resolver + API dispatch (1h)
8. `resolveDropAction(source, hover, modifier, archRoots)` returning DropAction
9. `isAncestor` walk
10. MapView's `onDrop` switch dispatching to existing API helpers
11. Test: drag a board to another board → reparent persists

### Phase 4 — Visual feedback (2h)
12. Ghost rendering (source's top-face translucent at cursor)
13. Hover board highlight (gold dashed)
14. Hover tier band highlight (translucent horizontal stripe at z)
15. Drop preview label (text at cursor with action description)
16. Source dim (opacity=0.3 while dragging)

### Phase 5 — Integration with existing mousedown (1h)
17. Chip / PlateBoard `onMouseDown` calls `beginDrag` with stopPropagation
18. Click-vs-drag: `if (!state.moved) handleClick(); else handleDrop()`
19. Verify no regression: rotate / pan still work on canvas blank
20. Verify no regression: chip click still selects (opens detail panel)

### Phase 6 — Edge cases + polish (1h)
21. `mouseleave` window cancels drag
22. Invalid action UI (red cursor, label)
23. Mutation pending lock
24. Failure recovery (toast)

### Phase 7 — Manual verification (30min)
25. Drag a top-level module to another tier — verify floor moves
26. Drag a top-level module to another module — verify reparent
27. Shift+drag to a sibling — verify merge
28. Drag a nested module out to blank — verify orphan
29. Drag cycle attempt → invalid feedback
30. All operations persist across restart (locked = 1 from PATCH path)
31. Run regression tests

**Total: ~8.5 hours**

## What this unlocks

After this lands, `feedback_direct_manipulation.md` invariants 1, 2, 4 are fully satisfied for module-level operations. Tier-level drag (reorder tiers via drag) is V0.2.

User can do everything previously needing buttons by just grabbing a chip and dragging:
- Move into another module → drag onto target
- Move to another tier → drag to that tier band
- Merge → shift+drag to sibling
- Promote → drag to blank tier or empty band
- Make orphan → drag to outer blank canvas

The button UI in DetailPanel still works (kept for keyboard / accessibility / discoverability) but most users will gravitate to drag once it's available.

## Done means

- [ ] Dragging a chip moves it visually as ghost
- [ ] Hover target highlights gold (board) or band (tier)
- [ ] Drop label shows resolved action live
- [ ] Each of the 6 DropAction types triggers correct API call
- [ ] Cycle prevention works (can't drop into descendant)
- [ ] Camera rotate/pan still work on canvas blank
- [ ] Chip click still selects
- [ ] All drops persist across restart — `locked = 1` is set **server-side** by `patchModuleEndpoint` (`module-edit.ts:44`) and `mergeModulesEndpoint` (`module-edit.ts:109`) regardless of client payload. Client never sends `locked`. Verified.
- [ ] Regression tests pass
- [ ] Failed API call shows toast and reverts ghost
