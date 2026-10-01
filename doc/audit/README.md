# vizcoo audit — index

A file-by-file → module-by-module → architectural review of the codebase as of 2026-04-25.

The user asked me to be a strict code reviewer. The summary verdict is below; per-file detail is in the linked documents.

---

## Bottom line

The codebase is **smaller and cleaner than it feels** — ~5500 LOC, no truly dead modules, plugin discipline holds, layering is correct. But there are **four files that violate the project's own 200-line hard limit** and **a handful of structural smells** that, left alone, will compound as V0.2 features land.

The biggest risks (in priority order):

1. **Four files over 200 lines.** Must split per project rules.
2. **`core/modules/` has 11 files for what's logically 3 phases.** Sub-folder it.
3. **TS-specific code embedded in `core/`** — language-agnostic claim is partially false. Three small extractions fix it.
4. **Wire-format duplication** between server and UI in two places.
5. **Stale React Flow dependency**: arch/ doesn't use it, but the CSS import shipped. Either drop or commit to it.

Nothing is broken. The user's gut feeling that "it's a mess" is mostly about **organization**, not **correctness**.

---

## Document map

```
doc/audit/
├── README.md                    ← you are here
├── 01-dead-code.md              ← dead exports, dead deps, legacy dirs (~14 items)
├── 02-files/                    ← file-by-file detail
│   ├── analyzers.md             ← src/analyzers/typescript/ (9 files)
│   ├── core-graph.md            ← src/core/graph/ (3)
│   ├── core-modules.md          ← src/core/modules/ (11)
│   ├── core-server-storage.md   ← src/core/server/, storage/, plugin-api/ (16)
│   ├── core-view-ai-hooks-project.md  ← src/core/view/, ai/, hooks/, project/, bin/, index-project.ts (15)
│   └── ui.md                    ← src/ui/ (29)
├── 03-modules.md                ← per-directory cohesion + budgets
└── 04-architecture/
    ├── boundaries.md            ← plugin discipline, file-vs-module edges, server budgets, route isolation
    ├── extensibility.md         ← multi-language, AI provider, view evolution, future ops
    ├── naming-and-shape.md      ← noun/verb naming, file size, comments, classes
    └── data-flow.md             ← index, aggregation, map render, view pipelines
```

---

## Findings by severity

### BLOCKER (1)
- **`src/ui/arch/ArchScene.tsx` at 451 lines**, 2.25× the 200-line hard limit. Single largest file. Must split into 7 files.

### MAJOR (cumulative; ~12 items)

- **3 more files over 200 lines**: `Timeline.tsx` (290), `MapView.tsx` (271), `live.ts` (267). Each must split.
- **`core/server/http.ts` at 164** vs the 150 hard limit. Extract static-file serving.
- **`core/modules/tree.ts`** name-vs-content mismatch + dead exports. Rename + clean.
- **`live.ts` module-globals** (`pending`, `sessions` Maps) impede testability. Class wrap when convenient.
- **3 TS-specific assumptions in `core/`**: `graph/resolve.ts`, `discover-heuristic.ts:EXPORT_REGEX`, `ApiCall.kind` enum. Move into the analyzer interface.
- **`'api-call'` edges** are written but never aggregated. Pick a fate.
- **`content_hash` column** is written but never read. Use or drop.
- **CLAUDE.md says cold-start is heuristic only**; the code calls LLM aggregation on first cold start. Doc-vs-code drift.
- **CLAUDE.md says one viz library (React Flow)**; arch uses SVG, view uses Three.js. Doc-vs-code drift.
- **Wire-format types duplicated** server↔UI for Map types and WS messages.
- **`split.ts` (137 lines)** and `discover-heuristic.ts` regex export extraction — two places that should improve before language #2 lands.

### MINOR (~25 items)
- `ui/layout.ts` dead file (33 lines).
- Dead exports: `listModules`, `filesInModule`, `flatten`, `findArchById`, `aggregateRequest`, `DEFAULT_CAMERA`.
- `@xyflow/react` dep effectively unused.
- 3 ignore-list copies (`scan.ts`, `watch.ts`, `project-files.ts`) — unify.
- 3 `relTime` / `byFolderThenBasename` copies — unify.
- `projectsDirFor` defined twice — share.
- `extractJson` defined three times — share.
- 7 functions use forbidden `handle*` / `process*` prefix — rename.
- Magic numbers in `discover-heuristic.ts` need a constants block.
- `legacy-3d/` and `legacy-module-discovery/` doc folders — confirm whether to delete.

### NIT (~30 items)
Various aesthetic comments scattered through file-by-file audits.

---

## Recommended PR sequence

**PR 1 — dead code cleanup** (low-risk, frees up future audit clarity):
- Delete `src/ui/layout.ts` and `@dagrejs/dagre` dep.
- Delete `listModules`, `filesInModule`, `flatten`, `findArchById`, `aggregateRequest`, `DEFAULT_CAMERA`.
- Delete `@xyflow/react/dist/style.css` import (and the dep, after user confirms).
- Confirm + delete `doc/legacy-3d/` and `doc/legacy-module-discovery/`.
- Either delete `core/server/api/view.ts` + the puppeteer tests, or migrate the tests to `/api/conversations`.

**PR 2 — split the big files** (mechanical, by-the-book):
- Split `ArchScene.tsx` → 7 files in `src/ui/arch/`.
- Split `Timeline.tsx` → 3 files in `src/ui/view/`.
- Split `MapView.tsx` → 2 files (extract `DetailPanel`).
- Split `live.ts` → 4 files in `src/core/view/live/`.
- Extract static-file serving from `http.ts`.

**PR 3 — rename the misnamed** (touches imports across the codebase):
- `core/modules/tree.ts` → `persist-heuristic.ts`.
- Re-organize `core/modules/` into `discover/`, `aggregate/`, `split/` sub-folders.
- Re-organize `core/view/live.ts` (already from PR 2).
- Rename `core/server/api/{hook, hookStatus}.ts` to `{hook-events, hook-settings}.ts`.
- Rename `handleHook*` functions to verbs.

**PR 4 — extensibility prep** (sets up for language #2 + AI provider #2):
- Move `resolveImport` into `LanguageAnalyzer` interface.
- Move `extractExportNames` into the analyzer (drop the regex).
- Rename `ApiCall.kind` → `'http-call' | 'route-definition'`.
- Add `AbortSignal` to `CompleteOptions`.
- Make AI provider env-selectable.

**PR 5 — wire format DRY + unify ignore lists**:
- Shared types file for Map (`Module`, `ModuleEdge`).
- Shared types file for WS messages.
- Single ignore-list, imported by `scan.ts` / `watch.ts` / `project-files.ts`.
- Single `relTime` and `byFolderThenBasename` helpers.

**PR 6 — small fixes** (non-mechanical, judgment calls):
- Decide fate of `'api-call'` edges and `content_hash`.
- Decide fate of `'Other' / 'Config'` framework buckets (keep or rename).
- Add `files.assignment_origin` column for V0.2 manual operations.
- Add timeout to `claudeCliProvider`.
- Cache `scanProjectFiles` and per-conversation parses.

**Estimated total**: 6 PRs, ~3-5 days of focused work to clean up.

**Risk profile**: PRs 1-3 are mechanical (split, rename, delete). PR 4 is structural but well-scoped. PR 5 is straight refactor. PR 6 is judgment + small additions.

---

## What the audit does NOT cover

- **Performance benchmarks**: I noted potential slow paths but didn't measure.
- **Test coverage**: there are puppeteer integration tests but no unit tests visible. A separate audit could enumerate what's tested vs not.
- **Security review**: this is a localhost dev tool with no auth — by design (CLAUDE.md). Path traversal in `serveStatic` is checked (line 143). Beyond that, no formal review was done.
- **CSS / visual quality**: the user's "visuals top priority" memory wasn't probed; that's a design review, not a code review.
- **CC integration robustness**: hook installation works, but I didn't test on a corrupt `~/.claude/settings.json`. The fallback (`catch { return {} }`) would discard user config. Single hardening item to consider.

---

## How to use this audit

1. **Read this README** for the headline.
2. **Read `01-dead-code.md`** for the safe-to-delete list.
3. **Skim `03-modules.md`** for the per-directory verdicts.
4. **Read `04-architecture/boundaries.md`** for the rule-vs-code checks.
5. **Drill into `02-files/*.md`** when you're about to touch a specific file.
6. **Read `04-architecture/extensibility.md`** before starting V0.2.

If a finding seems wrong, the source code is the truth. I marked everything I traced; if I missed an import the call graph would show it.
