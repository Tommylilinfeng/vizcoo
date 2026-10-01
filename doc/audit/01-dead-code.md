# Dead Code & Files Inventory

**Method**: every "dead" claim below was verified by `Grep` for incoming imports/callers across `src/`, `bin/`, `scripts/`. Items are graded **safe-to-delete** (no callers, no risk), **probably-dead** (no callers, but maybe a placeholder for V0.2), or **kept-for-tests** (only puppeteer scripts use it).

The user said "保留可拓展性" — so I default to listing rather than deleting. Each row has a recommendation.

---

## Severity legend
- **DELETE** — zero callers, zero rationale; remove now.
- **DELETE-PENDING** — looks like an unfinished placeholder; confirm with user before removing.
- **KEEP-OR-DELETE** — dead in `src/`, but kept alive only by a puppeteer test script. Decision: delete the script + endpoint, OR keep both.
- **MOVE** — the code is OK but lives in the wrong file (will be addressed in module-level audit).

---

## 1. `src/ui/layout.ts` — top-level Dagre layout

- **Severity**: DELETE
- **Lines**: 33
- **Why dead**: imports `@dagrejs/dagre`, exports `dagreLayout` / `dagreLayoutSized`. `Grep "from ['\"]\\./layout"` and `from ['\"]\\.\\./layout` returns nothing — the only files named `layout.ts` that get imported are `src/ui/arch/layout.ts` and `src/ui/view/layout.ts`, both via *their own* sibling imports. Nobody at the top level imports `./layout.js`.
- **Caused by**: probably built for an early Map prototype that switched to the iso projection in `src/ui/arch/layout.ts`.
- **Action**: delete file. Check `@dagrejs/dagre` is not used elsewhere (`grep -r "dagre"` confirms it isn't), then drop the dep.

## 2. `@dagrejs/dagre` dependency

- **Severity**: DELETE (paired with #1)
- **Why dead**: only consumer is `src/ui/layout.ts`. After #1, no remaining imports.
- **Action**: `npm uninstall @dagrejs/dagre` after deleting #1.

## 3. `src/core/modules/tree.ts: listModules`, `filesInModule`

- **Severity**: DELETE (the two exports only — the file itself stays for `replaceHeuristic`)
- **Why dead**: full-repo grep finds zero callers for either function.
- **Note**: file is also misnamed — there's no tree-building here, only DB writes for heuristic modules + two dead read helpers. Will be addressed in the module-naming audit.
- **Action**: delete the two functions and the now-unused `Module` interface and `Database` import that only they use. (`replaceHeuristic` will keep its own narrow types.)

## 4. `src/ui/arch/tree.ts: flatten`

- **Severity**: DELETE
- **Why dead**: zero callers.
- **Action**: delete.

## 5. `src/ui/arch/ArchScene.tsx: findArchById`

- **Severity**: DELETE
- **Why dead**: zero callers. The local `findById` (re-imported from `./tree.js`) is what `MapView.tsx` uses.
- **Action**: delete the wrapper at `ArchScene.tsx:449-451`.

## 6. `src/ui/api.ts: aggregateRequest`

- **Severity**: DELETE-PENDING
- **Why dead**: `POST /api/aggregate` endpoint exists in `src/core/server/api/aggregate.ts`, and the helper at `src/ui/api.ts:50-61` is wired to call it. **No UI component calls `aggregateRequest`.** This is an orphan — either the "re-aggregate" button was never built, or it's planned for V0.2.
- **Decision needed**: keep as placeholder (delete-pending), OR delete now and reintroduce when the button lands.
- **My recommendation**: delete. CLAUDE.md says "Don't add features…beyond what the task requires." Re-add when needed; trivial to do.

## 7. `src/core/server/api/view.ts` (and the `/api/view/turns`, `/api/view/files` routes)

- **Severity**: KEEP-OR-DELETE
- **Lines**: 21
- **Why suspect**: file's own comment says *"Legacy endpoints — frontend uses /api/conversations now. Kept for puppeteer tests written before the refactor."* Frontend grep confirms no UI consumer.
- **Question**: do those tests still need to pass? If yes, the test should be migrated to `/api/conversations` and this file deleted. If no, both go.
- **Action**: confirm with user — likely a 5-min refactor of the test scripts.

## 8. `src/ui/view/dev-probes.tsx`

- **Severity**: KEEP-OR-DELETE (more nuanced than the others)
- **Why suspect**: file comment says *"Test instrumentation only. Read by scripts/test-view-highlight.ts via window globals."* The component is unconditionally mounted by `ViewScene.tsx:43, 56` — so it ships to production.
- **Risk**: every frame, `useFrame` walks the entire scene, builds a fresh `meshes` record, and writes 3 globals (`__vizcooMeshes`, `__vizcooCamera`, `__vizcooCanvas`). For a real project with hundreds of files this is non-trivial.
- **Action options**:
  - **Best**: gate behind `import.meta.env.DEV` so prod doesn't ship test glue.
  - **Acceptable**: leave as-is until a real perf issue surfaces.
  - **Worst**: delete and lose the 3 puppeteer tests that depend on it.
- **My recommendation**: gate behind `DEV`; tests run dev-mode builds anyway.

## 9. Untracked scripts not wired into `package.json`

Three scripts in `scripts/` are not in `package.json` `scripts`:

- `check-view.ts` — puppeteer probe, manually invoked
- `dump-turns.ts` — JSONL dump utility, manually invoked
- `smoke-analyzer.ts` — sanity check, manually invoked

These are debugging utilities, not tests. None are dead, but they're undocumented. **Action**: either add a single `"debug:*"` block to `package.json` or move them to `scripts/debug/` so the test scripts stay separate. Up to user — pure organization, no code change.

## 10. `doc/legacy-3d/` — 4 stale HTML prototypes

- **Severity**: DELETE-PENDING
- **What's there**: 4 `.html` files, named "architecture-map-{hash}.html" / "architecture-map-final.html". These are pre-React mockups.
- **Action**: confirm there's nothing in there you still want to mine, then delete the directory.

## 11. `doc/legacy-module-discovery/` — 9 files of obsolete approach

- **Severity**: DELETE-PENDING
- **What's there**: full module-discovery v0 (cluster-analysis, noise-filter, doc-generation, prompt-* files, README). The current pipeline (`heuristic → aggregate-and-apply`) replaced this entirely.
- **Action**: confirm — if the README describes a *future* path you might revive, keep; otherwise delete the directory.

## 12. `src/ui/arch/types.ts: DEFAULT_CAMERA`

- **Severity**: DELETE
- **Why dead**: exported, zero callers. The actual default camera angles flow through `ArchSettings.rotZDeg / rotXDeg` (both DEG, not radians). This is an early prototype's radian-based version.
- **Action**: delete the constant and its dependent `CameraState` import-of-type chain… actually `CameraState` IS used (by `iso.ts`, `ArchScene.tsx`). Just delete the `DEFAULT_CAMERA` constant.

## 13. `@xyflow/react` dep (or its CSS import)

- **Severity**: DELETE-PENDING
- **Why dead**: `Grep "@xyflow"` → only `src/ui/main.tsx:5` imports the CSS. No React Flow components rendered anywhere in the codebase. The dep ships but isn't used.
- **Decision**: drop the dep + CSS import, OR commit to porting arch/ to React Flow per CLAUDE.md.
- **Action**: per the boundaries audit, this is a CLAUDE.md vs reality mismatch. Pick one.

## 14. `dist/` (gitignored)

- **Severity**: NOT DEAD (just stale)
- **Why mentioned**: it's the published npm artifact (`bin: dist/bin/vizcoo.js`). The committed snapshot at `dist/` is stale (older than current `src/`); regenerate with `npm run build` before publishing. Not an audit issue, just a hygiene note.

---

## Summary

| Item | Severity | Action |
|---|---|---|
| `src/ui/layout.ts` | DELETE | drop file |
| `@dagrejs/dagre` dep | DELETE | drop dep |
| `tree.ts: listModules`, `filesInModule` | DELETE | drop two exports |
| `arch/tree.ts: flatten` | DELETE | drop export |
| `ArchScene.tsx: findArchById` | DELETE | drop export |
| `api.ts: aggregateRequest` | DELETE-PENDING | confirm with user |
| `core/server/api/view.ts` + 2 routes | KEEP-OR-DELETE | migrate tests, delete file |
| `dev-probes.tsx` | KEEP-OR-DELETE | gate behind DEV |
| 3 untracked scripts | KEEP (organize) | move or document |
| `doc/legacy-3d/` | DELETE-PENDING | confirm |
| `doc/legacy-module-discovery/` | DELETE-PENDING | confirm |
| `dist/` | n/a | rebuild before publish |

**Net deletable lines after user confirmations: ~80 LOC of code + ~2 dirs of docs + 1 dependency.**

Not as much as the symptoms suggested. The codebase is leaner than it looks; the "mess" the user feels is more likely about **structure / naming / boundary smells** (covered in later audit files) than about dead weight.
