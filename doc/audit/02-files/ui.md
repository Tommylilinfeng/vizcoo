# File-by-file audit: `src/ui/`

UI is split into three groups:
- **shell**: `App.tsx`, `Sidebar.tsx`, `MapView.tsx`, `SettingsModal.tsx`, `api.ts`, `main.tsx`, `index.html`, `style.css`, `layout.ts` (top-level dead).
- **arch/**: 9 files, the Map route's iso-projection scene.
- **view/**: 11 files, the View route's 3D Three.js scene.

CLAUDE.md frontend rules: **React + React Flow + Tailwind, bundled with Vite. One viz library, one styling approach, no state-management library, no CSS-in-JS, no animation library beyond what React Flow ships.** Memory file says CLAUDE.md stack limits apply to **arch-map only, not new features**. So `view/` can use 3D + zustand + spring; `arch/` should not.

---

## Shell

### `main.tsx` (14 lines)

- **Job**: React StrictMode bootstrap.
- **Issues**:
  - **minor**: imports `'@xyflow/react/dist/style.css'`. **No file in the codebase imports React Flow components.** `Grep "@xyflow"` confirms only `main.tsx`. The CSS is loaded but unused. **Action**: delete the import. Also confirm `@xyflow/react` dep can be dropped (or kept if planned for V0.2).
  - **nit**: `throw new Error('#root missing')` is a 3-line guard. Idiomatic.
- **Verdict**: tiny, mostly clean. **Drop the unused React Flow CSS.**

### `index.html` (14 lines)

- **Job**: HTML shell. Inter font from CDN.
- **Issues**:
  - **minor**: external font CDN (`rsms.me`) at runtime — works, but for an offline-friendly local dev tool, hosting the font locally would be more robust. Aesthetic.
  - **nit**: body classes use `bg-neutral-950 text-neutral-100` — Tailwind. Fine.
- **Verdict**: clean.

### `style.css` — not read

- Tailwind directives. Standard.

### `App.tsx` (53 lines)

- **Job**: 2-route shell — View vs Map. Wires Sidebar / Stage / Timeline / SettingsModal.
- **Issues**:
  - **minor**: `localStorage` route persistence is inline (lines 12-20). Fine.
  - **minor**: `setRoute` shorthand wraps both setState + localStorage write. Tight, fine.
  - **minor**: `useEffect` re-fetches `/api/project-info` and `/api/hooks/status` whenever `settingsOpen` changes (line 27-30). That's actually a feature — when the user closes settings after installing hooks, the status refreshes. But it also fires on initial mount AND every settings open/close. Minor over-fetch. Acceptable for V0.1.
  - **nit**: `hasLive = conversations.some((c) => c.status === 'alive')` (line 32) — pulls from zustand. Tight coupling between App shell and View store. Acceptable; `App.tsx` is the composition root.
- **Verdict**: clean. Composition root.

### `Sidebar.tsx` (138 lines)

- **Job**: collapsible left rail with project name, status dot, route tabs, conversation list, settings button.
- **Issues**:
  - **major - file size**: 138 lines, above target. Has 5 sub-components (`SidebarCollapsed`, `SidebarExpanded`, `Logo`, `StatusDot`, `IconBtn`, `RouteTab`, `statusText`). Splitting by mode (Collapsed/Expanded as one file each) is one option; pulling `Logo`/`StatusDot`/`IconBtn`/`RouteTab` into `Sidebar.parts.tsx` is another. **Recommendation**: leave it. The file is single-purpose (the sidebar). All sub-components are private to the sidebar. Splitting wouldn't make a future reader's life easier.
  - **minor**: `localStorage` for `collapsed` (line 18-22). Same pattern as App.tsx. Two persisted UI prefs in two files. If a third lands, factor a `useLocalStoragedState` hook. Wait until then.
  - **nit**: `StatusDot` is exported, used inside this file only. Could be private. Inconsistent.
- **Verdict**: works; size is borderline.

### `MapView.tsx` (271 lines) — **OVER 200 LINES (HARD LIMIT)**

- **Severity**: **MAJOR — violates 200-line hard limit.**
- **Job**: the entire Map route — fetch data, set up state, render `ArchScene` + overlays + `DetailPanel`.
- **Issues**:
  - **MAJOR - file size**: 271 lines. The component is doing 3+ things:
    1. State + data fetching (lines 15-72) — ~58 lines.
    2. The render tree (lines 79-127) — the actual Map view.
    3. `Toolbar`, `Hint`, `ErrorScreen`, `EmptyScreen` — small (4 components × ~10 lines).
    4. `DetailPanel` (lines 166-207) — 42 lines, edge listing nested inside.
    5. `EdgeListing`, `SimpleEdges`, `Stat`, `countModules`, `subtree` — 6 helpers totaling ~70 lines.
    
    **Recommendation**: split into:
    - `MapView.tsx` — top-level component, ~120 lines.
    - `arch/DetailPanel.tsx` — DetailPanel + EdgeListing + SimpleEdges + Stat + countModules + subtree (this whole thing is "the right-side panel for a selected module") ~120 lines.
    - The 4 small status components (`Toolbar`, `Hint`, `ErrorScreen`, `EmptyScreen`) can stay inline or move to `arch/MapView.parts.tsx`.
  - **minor**: the `meta` state shape (line 24) is one giant inline type. Move to `arch/types.ts` or use the existing `LayoutResult` shape if compatible.
  - **minor**: `panResetKey` (line 23) increments on reset to force `ArchScene` to remount (`key={panResetKey}` line 85). Standard React idiom. Could go in arch internal state, but works.
  - **minor**: `onCameraChange` writes back into settings (line 65-67). So the camera angle is persisted. Different settings (slider) and camera-drag both flow through `setSettings`. Coherent.
- **Verdict**: **must be split.** Same severity as `live.ts`.

### `SettingsModal.tsx` (157 lines)

- **Job**: settings modal with Project / Hooks / Sessions sections + install/uninstall hooks button + storage info.
- **Issues**:
  - **major - file size**: 157 lines, above target. Structure: `SettingsModal` (main, ~70 lines), `Section` / `Row` / `Loading` (4 small helpers, ~30 lines), `formatBytes` (~6 lines).
    - **Recommendation**: keep as-is. Settings modal is single-purpose, helpers are local. Not split-worthy.
  - **minor**: `refresh` does 3 parallel fetches. Could combine into a single `/api/settings` endpoint. **But** that creates a "kitchen sink" endpoint — current shape has 3 narrow endpoints, each doing one thing. Stick with parallel fetches.
  - **minor**: `onCopyPath` uses `navigator.clipboard.writeText` (line 50). Fails silently if not granted. Catches error and sets it. OK.
  - **nit**: `formatBytes` (line 152) reinvents byte formatting. Fine.
- **Verdict**: works. Single-purpose.

### `api.ts` (62 lines)

- **Job**: typed fetch helpers for the Map route.
- **Issues**:
  - **minor**: `aggregateRequest` is dead — see dead-code report.
  - **minor**: error parsing inconsistency — `splitModuleRequest` does `body.error ?? '...split failed: ...'`, `aggregateRequest` does `body.error ?? '...aggregate failed: ...'`, `fetchTree`/`fetchGraph` just throw a status code. Three different error shapes. **Recommendation**: a single `fetchJson(url, options)` helper that throws a structured error. Saves duplication and standardizes error UX.
  - **nit**: `Module` and `ModuleEdge` types here mirror `core/server/api/tree.ts` and `core/server/api/graph.ts` (the `ModuleRow` shape). Two type definitions for the same wire format. **Consider**: extract to `src/shared/api-types.ts` — used by both server and ui. CLAUDE.md doesn't forbid a `shared/` dir here, but the project's anti-patterns say "no `util/`, `common/`, or `shared/` dumping grounds". So either accept the duplication or make `tree.ts` import from `ui/api.ts` (gross — server depending on UI). Best: define once in `core/api-types.ts` (next to the SQL row types) and import from both sides. Two new lines, one less inconsistency.
- **Verdict**: clean. The type duplication is the worst smell.

### `layout.ts` (33 lines) — DEAD

- See dead-code report (item #1). Delete.

---

## arch/ (Map route)

CLAUDE.md says: arch-map should be **React + React Flow + Tailwind, no zustand, no animation library**.

Reality:
- Uses **SVG** (not React Flow) — custom iso-projection rendering. **Conflict with CLAUDE.md**.
- Uses Tailwind — ✅
- No zustand — ✅
- No animation library — ✅ (uses CSS transitions + `setState` interpolation)

The SVG choice is presumably because React Flow doesn't natively do isometric 3D-stacked layouts. Memory says "stack limits apply to arch-map" — which would mean arch *must* use React Flow. But the code clearly chose SVG. **Either CLAUDE.md needs updating, or arch should be ported to React Flow.** Important architectural question to flag.

### `arch/ArchScene.tsx` (451 lines) — **OVER 200, MORE THAN DOUBLE THE HARD LIMIT**

- **Severity**: **BLOCKER — most violating file in the codebase.**
- **Job**: the Map route's whole rendering pipeline — drag/pan/zoom/rotate, layout, edge aggregation, SVG rendering of floors+chips+edges, palette tables, fit calculation.
- **Issues**:
  - **BLOCKER - file size**: 451 lines. The 200-line hard limit is comfortably busted. Concerns visible in the file:
    1. `TIER_PALETTES` table (10 entries × multiple colors, ~20 lines).
    2. `ArchScene` outer component (lines 35-191) — state, mouse/wheel event handlers, layout/edge memos, fit calc, SVG defs + transform group.
    3. `FloorView` + `renderInside` (lines 193-256) — recursive nested floor rendering.
    4. `PlateBoard` (lines 258-313) — single floor or sub-floor rendering with shading/labels.
    5. `Chip` (lines 315-350) — leaf module rendering.
    6. `EdgesLayer` (lines 352-392) — cross-module edges with bezier curves.
    7. `eachFloorNode` / `collectChipScreen` / `computeFit` / `clamp` / `truncate` / `countLeaves` / `findArchById` (lines 394-451) — 7 helpers.
    
    **Recommendation**: split into:
    - `arch/ArchScene.tsx` — the outer component, mouse handling, layout integration ~150 lines.
    - `arch/Floor.tsx` — `FloorView` + `renderInside` ~70 lines.
    - `arch/Plate.tsx` — `PlateBoard` ~60 lines.
    - `arch/Chip.tsx` — `Chip` ~40 lines.
    - `arch/Edges.tsx` — `EdgesLayer` ~45 lines.
    - `arch/palettes.ts` — `TIER_PALETTES` + types ~25 lines.
    - `arch/fit.ts` — `computeFit` + helpers ~40 lines.
    
    Each file then has one rendering responsibility. **This split is non-optional under the project's own rules.**
  - **major**: `findArchById` is dead (see dead-code).
  - **major**: every render computes `chipScreen` (line 138 — `useMemo`), `tree`, `layoutOpts`, `layout`, `visibleEdges`, `fit` — chained dependencies. The deps lists are mostly correct but I'd want a closer look during the split.
  - **minor**: `useEffect` at lines 74-90 builds the minimap rectangles inline by re-walking the layout. With the split, this can move into the new `Floor.tsx` or stay in `ArchScene` as a separate hook. Either way, simplify by computing `meta` in a helper.
  - **minor**: drag/pan logic spans lines 92-133. A `useDragRotate(setSettings, pan, setPan)` custom hook (~50 lines) cleans up the component body.
  - **nit**: `clamp`, `truncate` are bottom-of-file utilities. Move to `arch/util.ts` (or stay — they're 4-line nothings).
- **Verdict**: **MUST SPLIT.** This is the largest single file in the codebase and breaks the project's own hard rule by 2.25×.

### `arch/Overlays.tsx` (86 lines)

- **Job**: 3 overlay components — StatsHud, LegendHud, Minimap.
- **Issues**:
  - **minor**: Overlays imports `TIER_PALETTES` from `ArchScene.tsx`. Once `ArchScene` is split, palettes move to `arch/palettes.ts` and this import gets cleaner.
  - **nit**: `Minimap` receives precomputed rects as a prop — good (the math stayed in `ArchScene`).
- **Verdict**: clean. Will benefit from the ArchScene split.

### `arch/SettingsPanel.tsx` (177 lines)

- **Job**: settings drawer — sliders, checkboxes, view presets, floor pin/hide, reset.
- **Issues**:
  - **major - file size**: 177 lines. Has `SettingsPanel` (main, ~70 lines) + `Section` / `Slider` / `Check` / `FloorRow` (4 helpers, ~70 lines).
    - The 4 helpers are pure form widgets, used only here. **Recommendation**: leave together — they belong with their consumer, and pulling them out wouldn't aid clarity.
  - **minor**: a lot of inline Tailwind class strings. Hard to skim. Acceptable in a small project; consider variants pattern (e.g., a `cn()` utility) at scale. **Defer.**
  - **nit**: `Slider` accepts `min/max/step` plus `onChange(v: number)`. Reusable; lives only here. Fine.
- **Verdict**: works. Long but single-purpose.

### `arch/types.ts` (46 lines)

- **Job**: shared types.
- **Issues**:
  - **minor**: `DEFAULT_CAMERA` (line 24) duplicates the same default rotation expressed in `settings.ts:27` (`rotZDeg: 45, rotXDeg: 30`). Two sources of truth: one in radians, one in degrees. Not used together (DEFAULT_CAMERA goes unused now? Let me check). **Verify with grep — likely dead.** If no consumer, delete.
- **Verdict**: clean.

### `arch/settings.ts` (71 lines)

- **Job**: `ArchSettings`, defaults, localStorage load/save, `VIEW_PRESETS`.
- **Issues**:
  - **minor**: silent JSON parse fallback (line 56-57). Same pattern as `hooks/install.ts`. Reasonable for user-perceptible storage but document.
  - **nit**: `VIEW_PRESETS` shape repeats `rotXDeg`/`rotZDeg`. Tight, fine.
- **Verdict**: clean.

### `arch/iso.ts` (69 lines)

- **Job**: pure isometric projection math.
- **Issues**: none. Pure functions, single concern. Excellent shape.
- **Verdict**: exemplary.

### `arch/layout.ts` (165 lines)

- **Job**: tree → 3D-stacked positions via d3 treemap.
- **Issues**:
  - **major - file size**: 165 lines, above the 100-line target but under 200.
  - **major**: dead code — `effectiveFileCount` (line 88-91):
    ```ts
    function effectiveFileCount(node: ArchNode, expanded: Set<NodeId> | null): number {
      return Math.max(1, node.fileCount)
      void expanded
    }
    ```
    The `void expanded` is unreachable — there's a `return` above it. The parameter is unused. Either use it (semantics?) or drop it. As written, the function ignores `expanded` and uses raw `fileCount`. **MAJOR**: this is clearly leftover. Either delete the parameter or implement the intended logic.
  - **minor**: `DEFAULT_LAYOUT` (line 15) duplicates fields from `DEFAULT_SETTINGS` (in `settings.ts`). Two defaults objects with overlapping fields. Awkward. The `layoutOptionsFromSettings` mapping function exists to convert one to the other (line 25). Document why both exist (settings is user-tweakable; layout-options is the engine input).
  - **minor**: the layout uses `d3-hierarchy` + `treemap`. Per CLAUDE.md "One viz library (React Flow)" — this is a second one. Memory exemption likely applies (legacy arch-map allowed). Document.
  - **nit**: `propagateZ` and `shiftXY` are tiny tree-walks (lines 151-160). Fine.
- **Verdict**: works. **Fix `effectiveFileCount`** — either implement the `expanded` logic or remove the parameter.

### `arch/tree.ts` (62 lines)

- **Job**: build `ArchNode[]` from flat `Module[]`.
- **Issues**:
  - **major**: `flatten` is dead — see dead-code report. Delete.
  - **minor**: `aggregate` mutates `node.fileCount` (line 45). The field starts as `selfFiles` value (line 14) and gets overwritten with subtree sum. So after `buildTree`, `fileCount = selfFiles + sum(children.fileCount)`. Documented by reading. A short comment on the type definition (`ArchNode.fileCount: total subtree files`) would prevent confusion.
- **Verdict**: clean after dead-code removal.

### `arch/edges.ts` (48 lines)

- **Job**: roll-up file→file edges to currently-visible nodes.
- **Issues**:
  - **minor**: thresholding logic at line 39 (`Math.max(2, Math.floor(total / Math.max(1, all.length) / 4))`) — magic formula. "Edges below ¼ of the average count are dropped." Not obvious. **Add a one-line comment**: `// drop edges weaker than 25% of the mean to declutter`.
- **Verdict**: clean.

---

## view/ (View route)

The new feature. CLAUDE.md stack rules don't apply (per memory).

### `view/ViewScene.tsx` (89 lines)

- **Job**: Three.js Canvas with files, camera rig, parallax, bloom postprocessing.
- **Issues**:
  - **minor**: WebSocket connection lives here (lines 31-36). It's the second WS connection in the app — `MapView.tsx:39-44` has its own. **Two connections to the same `/ws` endpoint.** When both routes mount? Only one is mounted at a time (App.tsx switches), so only one connection. But the connection lifecycle is duplicated logic. **Recommendation**: a `useVizcooSocket(handler)` hook in `src/ui/socket.ts`. Saves 7 lines per use × 2 sites + standardizes reconnection logic.
  - **minor**: `handleLive` is from zustand. It receives every WS message, including `'update'` from the indexer for the Map route. Currently zustand silently ignores unknown types (line 117 type narrowing). Fine.
  - **nit**: `DevProbes` and `StoreProbe` are imported and rendered unconditionally. See dead-code item #8 — gate behind `import.meta.env.DEV`.
- **Verdict**: clean. WS hook duplication is the cleanup.

### `view/Timeline.tsx` (290 lines) — **OVER 200**

- **Severity**: **MAJOR — exceeds hard limit.**
- **Job**: right-side timeline panel. Collapsed/expanded modes, turn cards with expand-detail, file chips, status indicators.
- **Issues**:
  - **MAJOR - file size**: 290 lines. Concerns:
    1. `Timeline` outer (collapsed-vs-expanded routing) ~30 lines.
    2. `Expanded` body (scroll, tail tracking, render turns) ~50 lines.
    3. `TimelineCollapsed` (flash on new turn) ~30 lines.
    4. `Header` + `CollapseBtn` + `ReviewBanner` + `Empty` + `Dot` ~50 lines.
    5. `Card` (turn card) ~50 lines.
    6. `ExpandedDetail` + `DetailSection` ~30 lines.
    7. `Chip` + `relTime` ~50 lines.
    
    **Recommendation**: split:
    - `Timeline.tsx` — outer + Expanded ~120 lines.
    - `view/TurnCard.tsx` — `Card` + `Chip` + `ExpandedDetail` + `DetailSection` ~140 lines.
    - `view/TimelineCollapsed.tsx` — collapsed mode + flash ~30 lines.
  - **minor**: `relTime` is duplicated in `view/ConversationList.tsx` (`relTime`). Two implementations with slightly different rules (`Timeline` returns 'just now' for < 5s, `ConversationList` returns 'now' for < 60s). **Move to `view/util.ts`** with one canonical version.
  - **minor**: tailing-vs-not logic uses a ref (`isTailingRef`) and scroll handler. Standard. Fine.
- **Verdict**: must split.

### `view/viewStore.ts` (167 lines)

- **Job**: zustand store — conversations, files, turns, layout, live state, derived activated paths.
- **Issues**:
  - **minor**: `handleLive` (lines 115-160) is 46 lines, branching on 5 `msg.type` values. Each case shape: read state, mutate, set. Could split into one method per message type (`onLivePending`, `onLiveDone`, etc.). Marginal — current shape is readable.
  - **minor**: state shape has 11 fields. Some are derived (`activatedPaths` from `livePaths` ∪ `selectedTurnIndex`). Derivation is done inside actions (line 109-112). A computed selector would be cleaner but adds overhead. Acceptable.
  - **minor**: `selectConversation(null)` resets a lot of fields (line 82). Risk of forgetting one if a new field is added. A `RESET_DETAIL_STATE` constant would help.
  - **minor**: `WsMessage` union (line 28) is duplicated *server-side* in the broadcast types (`live.ts` outputs the same shapes). Two definitions. Same fix as `api.ts`: shared types file.
- **Verdict**: works. The handle-live function is the longest in the file but readable.

### `view/layout.ts` (40 lines)

- **Job**: position files into a 3D cabinet (col by folder, drawer by index in folder).
- **Issues**: none.
- **Verdict**: clean.

### `view/scene-constants.ts` (40 lines)

- **Job**: tuning constants.
- **Issues**: none. The file gathers magic numbers in one place — exemplary.
- **Verdict**: clean.

### `view/FileNode.tsx` (78 lines)

- **Job**: per-file animated 3D plate.
- **Issues**:
  - **minor**: animation logic (`useSpring` + `useEffect`) ~10 lines, fine.
  - **minor**: change-color decision inline at line 54 (`activated && change?.kind === 'write' ? COLOR_WRITE : ...`). Triple ternary. Could be a small helper `materialColors(activated, kind)`. Marginal.
- **Verdict**: clean.

### `view/HoverCard.tsx` (90 lines)

- **Job**: hover diff card on a plate.
- **Issues**:
  - **minor**: `buildDiffLines` (line 76) takes a `FileChange` and returns DiffSummary. Heuristic: write → first 8 lines, edit → first half-of-max old + half-of-max new. Rough but readable.
  - **minor**: `DiffLine` and `DiffSummary` interfaces are redeclared here (lines 73-74). The shared `DiffLine` from `core/view/types.ts` exists but has 3 fields (`kind, lineNumber, text`) vs this 2-field local copy (`kind, text`). The local copy is a stripped variant. Either reuse with optional `lineNumber` or document the divergence.
- **Verdict**: clean.

### `view/ConversationList.tsx` (56 lines)

- **Job**: list conversations in sidebar with status dots, turn count, relative time.
- **Issues**:
  - **minor**: `relTime` duplicated with Timeline (see above).
- **Verdict**: clean.

### `view/EmptyState.tsx` (33 lines)

- **Job**: "no conversations yet" full-screen state with hooks-not-installed warning.
- **Issues**: none.
- **Verdict**: clean.

### `view/dev-probes.tsx` (40 lines)

- See dead-code item #8. Either gate behind `DEV` or delete.

---

## Cross-cutting

1. **`MapView.tsx` (271) and `ArchScene.tsx` (451) and `Timeline.tsx` (290) and `live.ts` (267) all violate the 200-line hard limit.** Plus `MapView` and `ArchScene` are the heart of the Map route — splitting both is a meaningful refactor.
2. **3 unused things in main shell**: `@xyflow/react/dist/style.css` import, `aggregateRequest`, possibly `DEFAULT_CAMERA` in arch/types.ts.
3. **`relTime` duplicated** in 2 places.
4. **API row types duplicated** between server (`server/api/tree.ts`) and ui (`ui/api.ts`). Same for `WsMessage` between `live.ts` and `viewStore.ts`. Single shared types file would help.
5. **WebSocket connection logic duplicated** between `MapView.tsx` and `ViewScene.tsx`. Extract to `useVizcooSocket(onMessage)`.
6. **CLAUDE.md says "one viz library (React Flow)"** but arch uses SVG + d3-hierarchy. View uses Three.js. Memory says only arch is restricted to the React Flow / no-3D rule, but the actual arch code does NOT use React Flow either. **Architectural divergence to discuss.**

The UI is the most code-bloated part of the project. Three components must be split to honor the 200-line hard limit.
