# Plan audit: `doc/drag-drop-plan.md`

Reviewed against current codebase state (post tier-as-entity / module-refactor PRs).

**Verdict**: solid plan, schema/API foundations already in place, math is correct. Three real concerns: (1) lands new code in already-over-budget files, (2) some name/contract drift between plan sections, (3) a few unstated dependencies.

---

## Foundations check ✅

The plan assumes a tier model + PATCH/merge API surface. Verified present:

- `schema.sql`: `tiers` table, `modules.tier_id`, `modules.locked`. ✅
- `api.ts`: `patchModuleRequest`, `mergeModulesRequest`, `Module.tierId`, `Module.locked`. ✅
- `ArchScene.tsx`: already takes `tiers: Tier[]` prop, `layoutTree(tree, tiers, ...)`. ✅
- `feedback_direct_manipulation.md` invariants: present, plan references correctly. ✅

So the plan isn't building on imaginary infrastructure. Good.

---

## BLOCKER (1)

### Code lands in already-over-budget files

Current state:
- `src/ui/arch/ArchScene.tsx` — **449 lines** (vs 200 hard limit).
- `src/ui/MapView.tsx` — **541 lines** (vs 200 hard limit).

The plan adds:
- Phase 4 (visual feedback): ghost rendering, hover highlight, tier band, drop label, source dim — all into `ArchScene.tsx`.
- Phase 5 (mousedown integration): `onMouseDown` on Chip + PlateBoard, click-vs-drag branching — into `ArchScene.tsx`.
- Drop dispatcher (`onDrop` switch + mutation-pending lock) — into `MapView.tsx`.

Each phase makes both files larger. **Recommend: split ArchScene + MapView before drag-drop lands.** Otherwise drag-drop adds the easiest excuse to keep deferring the split.

Concrete sequencing:
1. PR A (1-2 days): split `ArchScene.tsx` → 7 files (per `02-files/ui.md` recommendation), split `MapView.tsx` → 2 files.
2. PR B (drag-drop, this plan): lands cleanly into the already-decomposed files. `arch/Chip.tsx` adds its own `onMouseDown`. `arch/DragOverlay.tsx` is a new sibling rendering ghost+highlight+label. `MapView/Toolbar.tsx` or similar holds the `onDrop` dispatcher.

If the user wants drag-drop *now* without splitting first: acceptable, but the audit's MapView/ArchScene split items get harder.

---

## MAJOR (4)

### 1. `isAncestor` is misnamed

Plan defines: *"walking target.parentId chain, return true if hit source.id. Prevents cycles."*

That function answers **"is target a descendant of source?"** — not "is `source` an ancestor of `target`" in the natural reading. It's the inverse direction that the parameter order implies.

The cycle prevented: dropping source onto something inside source's subtree, which would create a cycle.

**Fix**: rename to `isDescendantOfSource(source, target, roots)` or `targetIsInSourceSubtree(...)`. The current name will mislead a reader.

The resolver code (line 154) already invokes it as `isAncestor(source.node, target, archRoots)` — so source first, target second. With the rename, this becomes `isDescendantOfSource(source.node, target, archRoots)`. Same arg order, clearer name.

### 2. Resolver and edge-cases table disagree on "already at this tier"

- **Edge cases table** (line 219): *"Source already at target's tier (move-tier no-op) → Show 'Already at this tier' label, no API call."*
- **`resolveDropAction`** (line 138): if `hover.kind === 'tier'`, returns `move-tier` unconditionally — does not check `source.tierId === hover.tier.id`.

Pick one and align both. Either:
- Add the check to the resolver: `if (source.node.tierId === hover.tier.id) return { type: 'noop' }`.
- Or remove the edge-case row.

Same potential issue for "drop board onto its existing parent" (`reparent` to current parent = noop) — plan doesn't say, current resolver dispatches anyway. Add a `noop` short-circuit when target.id === source.parentId.

### 3. `locked = 1` claim depends on server-side behavior

The plan's "Done means" includes *"All drops persist across restart (locked = 1)"*. The frontend `patchModuleRequest` payload (`api.ts:68-73` — `displayName?, description?, tierId?, parentId?`) doesn't include `locked`. So `locked = 1` must be set **server-side** when these PATCH fields are touched.

**Verify**: read `src/core/server/api/modules.ts` (or wherever the PATCH handler lives) and confirm `UPDATE modules SET ..., locked = 1 WHERE id = ?`. If not set, drag-and-drop "persists" but the next heuristic re-classification overwrites it. Invariant 1 silently breaks.

Plan should add to Phase 3: *"verify PATCH handler sets locked=1 when parentId/tierId changes; if not, this PR includes that one-line fix"*.

### 4. Pending-mutation lock leaks state across components

Plan: *"Drag while another mutation pending — block: dim the whole map, ignore mousedown"*.

Current `MapView` already has `splitting: NodeId | null` for the split flow. Adding drag introduces more mutations. The plan implies a generic "is-mutation-pending" signal but doesn't specify where it lives.

**Two options**:
1. Single boolean `mutationPending: boolean` in `MapView`, passed to `ArchScene` (which then refuses mousedown when true).
2. A small zustand store / React context.

Option 1 is fewer concepts, fits CLAUDE.md ("no state-management library" for arch). Plan should commit to one and add ~5 lines to Phase 6.

---

## MINOR (8)

### 1. Threshold inconsistency
Plan: 5px before drag triggers. Current `ArchScene.tsx:107` rotate-pan threshold: 3px (`Math.abs(dx) + Math.abs(dy) > 3`). Two thresholds in one file. Either align both (5px) or document why drag is stricter.

### 2. Shift modifier needs keyboard listeners too
Plan implies shift state comes from `MouseEvent.shiftKey` (per-event). That works while mouse moves. But: user holds-down-shift WITHOUT moving the mouse → preview doesn't update. Add `keydown`/`keyup` window listeners for `Shift` in `useDrag` so preview re-resolves on modifier change alone. ~5 lines.

### 3. `Tier` doesn't carry Z; plan needs to spell out the resolution
`Tier { id, name, position }` (api.ts:14). No Z. Plan's `HitResult.tier: Tier; z: number` requires `z` — derived from layout (each `PositionedNode` has `floorIndex`, sorted by `tier.position`). Plan should state: "tier.z is `floors[floorIndex].z`" so the implementer doesn't reinvent the mapping.

### 4. Inverse projection forgets fit/zoom/pan
"Inverse projection (the math)" derives `(x, y) = f(sx, sy)` for the iso transform only. The screen point a user clicks goes through `(p.sx * scale + tx + pan.x, p.sy * scale + ty + pan.y)` first. Inverse must:
1. Subtract `(tx + pan.x, ty + pan.y)`.
2. Divide by `scale`.
3. Then run the inverse-iso math.

The "Hit testing detail" section #2-3 mentions fit-transform application but the inverse section doesn't. **Add the 3-step inverse explicitly** so the implementer doesn't do the math wrong.

### 5. Toast component doesn't exist yet
Plan references "show toast" in failure path + Phase 6 #24. No `Toast.tsx` in `src/ui/`. Two options:
- Add a Toast component (~30 lines, 1 new file).
- Reuse the existing inline error banner (`MapView.tsx:line 82` uses one for split errors).

Plan should pick one. The latter is simpler and matches existing UX.

### 6. "Drag onto own ancestor" not in invalid list
Edge cases table (line 213) covers self and descendant. **Drop onto current parent** (an ancestor that's the immediate parent) currently isn't a noop in the resolver — it dispatches `reparent` with no actual change. The PATCH would touch the row (set `locked = 1` if added per #3 above) but the parent-id is unchanged. Add a noop branch when `target.id === source.parentId`.

### 7. Tier-band hit area is thin
"Tier band = `[z, z + floorThickness]` projected" — that's a thin strip in screen space. For typical viewing angles, the strip is < 20px tall. Users will rarely hit it precisely. **UX**: widen the hit area for tier-bands (e.g., `[z - floorGapZ/2, z + floorGapZ/2]`) so the cursor naturally lands in *some* tier when it's between boards. Otherwise most "drop in tier" attempts default to `orphan`.

### 8. Action label set + i18n
Plan lists 6 labels: "Move into X", "Merge into X", "Move to tier 3", "Promote to tier 3", "Make orphan", "Invalid". Some include the target name; some don't ("Make orphan"). Consistency: include source name too? "Move 'Auth' into 'Server'". Aesthetic — current set is fine. Note for V0.2.

---

## NIT (4)

- **"Pure blank" definition** is fuzzy — "outside all tier z-ranges". Could be sharpened: "above topmost tier OR below bottom tier OR neither board nor tier-band hit". The hit-test pseudocode does this implicitly.
- **Modifier matrix** says Shift over a tier-band has same behavior as no-modifier. Worth saying: "Shift only meaningful on board hover" once in prose, not just in the table.
- **Phase totals 8.5h** assumes ArchScene/MapView already split or the implementer is willing to drop new code into the big files. With current state, add 2-3h for integration friction.
- **Dim source at 30% opacity** — already 0.3 in plan text but "0.5" implied in "Ghost rendering: render with `opacity=0.5`". 0.5 is ghost; 0.3 is source. Two opacities, both mentioned. Make sure the implementer reads both lines.

---

## Out-of-scope items: are these the right ones?

Plan defers: multi-select, sibling reorder, drag tiers, animated re-layout, sticky drop zones.

**Should also defer (not currently mentioned)**:
- **Undo**. Invariant 3 says "operations are forgiving". Without undo, a misdrag is recovered by another drag. Acceptable for V1 but should be in the V0.2 list explicitly.
- **Locked indicator UI**. Invariant 5 says auto-generated rows need a `locked` signal — the data has it, but the UI shows nothing. Drag flips `locked=1`; user sees no visual change. Add to V0.2.
- **Keyboard alternative**. Plan says "buttons stay for accessibility" — but no keyboard equivalent for tier-move or merge exists yet. Either confirm DetailPanel covers all 6 actions, or add a V0.2 row.

---

## Phase-by-phase notes

| Phase | Comment |
|---|---|
| 1 (math) | ✅ correct, complete derivation. Add the fit/scale/pan inverse steps. |
| 2 (state machine) | ✅ clean shape. Add Shift keydown/keyup listeners. |
| 3 (resolver + dispatch) | ⚠ needs `noop` branches for "already-at-tier" and "already-this-parent". Verify server-side `locked = 1` set in PATCH. |
| 4 (visual feedback) | ⚠ all into `ArchScene.tsx`. Strongly recommend splitting ArchScene first. |
| 5 (mousedown integration) | ⚠ same. Click-vs-drag at the chip level interacts with the wrapper-div's rotate logic — risk that `e.stopPropagation` isn't enough; verify both ref-based drag refs (rotate uses `dragRef`, drag uses `useDrag` state) don't fight. |
| 6 (edge cases) | Toast or inline-error decision still pending. |
| 7 (manual verification) | ✅ good list. Add: "drag onto own immediate parent → noop". Add: "drag without moving > 5px → click still selects". |

---

## Bottom line

Plan is **well-scoped, math is right, foundations in place**. Three changes before kicking off:

1. **Split `ArchScene.tsx` and `MapView.tsx` first** (separate PR), or accept that drag-drop deepens the file-budget debt.
2. **Rename `isAncestor`** to reflect its actual question (target-in-source-subtree).
3. **Confirm server-side `locked = 1` in PATCH handler** — if not set, the persistence claim fails on next re-classify.

Plus the minor fixes: full inverse-projection (with fit transform), `noop` branches for already-at-tier and already-this-parent, Shift keyboard listener, widened tier-band hit area, toast-vs-inline error decision.

Estimated post-revisions: **plan is ready, ~9-10h focused work** (vs the plan's 8.5h).
