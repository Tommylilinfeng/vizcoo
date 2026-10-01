# Module discovery — Step 1 (heuristic only, no LLM)

Date: 2026-04-25

## What this step delivers

Replaced the old 1-level `folderFallback` (every top-level folder = one module) with an **export-aware, import-fan-in** heuristic ported from the legacy context-chain `module-discovery.ts` pipeline. Still **zero LLM calls** at this stage.

## What it does

1. **Walk source files** — uses the existing `scanProject` (respects `.gitignore`, ignores `node_modules`, `dist`, etc.).
2. **Extract exports** — same regex as legacy (`export (default? async? function|const|let|class|abstract class|interface|type|enum) <Name>`).
3. **Group by 2-level directory** — `src/core/storage/db.ts` → bucket `src/core`; `bin/vizcoo.ts` → bucket `bin`; `vite.config.ts` → bucket `.`.
4. **Compute import fan-in** — for each `from '…'` literal in source, resolve relative imports against the file set; for each imported file, count distinct **other** 2-level dirs that import it.
5. **Promote to `Foundation`** — files with ≥2 distinct external 2-level-dir importers move to a synthetic module named `Foundation`. This is the legacy "shared kernel" rule.
6. **Per-module `keyExports`** — top 8 most frequent export names within the module's files. Used by UI tooltips and as input for Step 2's LLM naming.

## What it does NOT do

- **No LLM call.** No descriptive names, no semantic clustering. Module names are still raw paths (`src/core`, `src/ui`, `Foundation`).
- **No sub-modules.** That's `splitModule()`, which is user-triggered.
- **No noise filtering.** Legacy `noise-filter.ts` requires CALLS edges + function-body sizes; vizcoo's storage doesn't carry those yet. Deferred to V0.2.
- **No mega-module roll-up.** Legacy outputs ~22 modules; the user-requested 4-5 mega-modules need an LLM merge → Step 2.
- **No single-importer reassignment.** Legacy moved orphans imported by exactly 1 other module to that module. Skipped here because every file already has a 2-level home; reconsider once we have orphans (e.g., users dropping flat `utils/` directories).

## Files touched

| Path | Change |
|---|---|
| `src/core/modules/discover-heuristic.ts` | **new** — 100 lines. The whole heuristic. |
| `src/core/modules/classify.ts` | replaced `folderFallback` (the 1-level top-folder fallback) with a call to `discoverHeuristic`. Net -20 lines. |
| `src/core/modules/tree.ts` | `replaceHeuristic` now also writes `key_exports` and `dir_paths` columns. |
| `src/core/storage/schema.sql` | `modules` table gained `key_exports TEXT` and `dir_paths TEXT` (both JSON arrays, nullable). |
| `src/core/storage/db.ts` | `migrateAddColumns` runs `ALTER TABLE` on existing DBs that pre-date the new columns. |
| `src/core/plugin-api/detector.ts` | `DetectorResult.modules[]` extended with optional `keyExports` and `dirs`. Framework detectors don't have to populate them. |
| `src/core/server/api/tree.ts` | `/api/tree` returns `keyExports: string[] \| null` per module. |

## Verified output (vizcoo on itself, after wiping `.vizcoo/`)

```
1. src/core                       30 files   exports: AIProvider, AggregatedEdge, ApiCall, Broadcaster, ...
2. src/ui                         18 files   exports: App, BG_COLOR, BLOOM_INTENSITY, ...
3. scripts                        14 files   (no exports — scripts use top-level code)
4. src/analyzers                   8 files   exports: expressDetector, extractApiCalls, ...
5. doc/legacy-module-discovery     7 files   exports: DirGroup, DiscoveredModule, ...   ← snapshot from legacy
6. fixtures/nextjs-minimal         4 files   exports: Button, GET, Home, User, getUsers
7. .                               3 files   (root config files: vite.config.ts, etc.)
8. Foundation                      3 files   exports: indexProject, openDatabase, typescriptAnalyzer
9. bin                             1 file    (entry point)
```

`Foundation` correctly captured the cross-module shared layer:
- `src/core/index-project.ts` — imported by `bin/` and `src/core/server/`
- `src/core/storage/db.ts` — imported by `bin/` and `src/core/`
- `src/analyzers/index.ts` — imported by `bin/` and `src/core/`

## Tests

| Suite | Result |
|---|---|
| `test:timeline` | PASS |
| `test:turns` | PASS |
| `test:settings` | PASS |
| `test:map-nav` | PASS |

No new tests added — Step 1 has no UI surface. The output is verified manually via `curl /api/tree`. Step 2 will add a dedicated test once LLM naming is stable.

## Step 2 plan (next, with LLM)

A single LLM call takes the Step 1 output (modules + keyExports + file paths) and returns:

1. **Human-readable name + 1-line description per module** — replaces machine names like `src/core` → "Storage & Indexing", `Foundation` → "Cross-cutting Infrastructure", etc.
2. **4-6 mega-modules** — clustering of the ~9-22 modules into top-level architectural concepts. Stored as `modules` rows with `parent_id = NULL` and the existing modules pointing at them via `parent_id`.

Schema impact: add `description TEXT` column (currently no place to write the LLM-generated description). Mega-modules use the existing `parent_id` relation.

Token budget for vizcoo-on-itself: ~3K tokens, single call, ~3-5s. Caches in DB so subsequent runs skip the call unless the file set changes.

## Step 3 plan (already implemented)

`splitModule(moduleId)` in `src/core/modules/split.ts` already does LLM-driven splits and writes children with `parent_id` pointing to the original. UI hookup pending — currently exposed at `POST /api/split` but no Map-view button calls it yet.
