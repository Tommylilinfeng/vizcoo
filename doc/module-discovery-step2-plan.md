# Module discovery — Step 2 plan (revised after review)

Date: 2026-04-25

This is the revised plan after addressing 8 design issues found in review of the first draft. The original draft had a broken `origin` semantics that would have caused module-count drift across runs, an estimate error on the module count of a large test repo, and several unbounded/over-rigid prompts. All addressed below.

## Decision summary

User picked **B**: drop Phase 3 (auto LLM split) and drop Foundation. Single LLM call after heuristic. Each file in exactly one 2-level dir bucket; LLM only **decorates** (display_name + description) and **groups** (parent_id pointing to a synthetic mega row).

Locked:
- LLM decides final module count and mega count within prompt-set ranges.
- Single sequential LLM call.
- File budget exception granted.
- Foundation concept removed.

## What changes vs Step 1

| Concern | Step 1 (now) | Step 2 (target) |
|---|---|---|
| Foundation | Yes | **No** |
| 1-level vs 2-level | Always 2-level | **Adaptive**: 1-level default; 2-level only for IQR-outlier 1-level buckets |
| Module names | Raw paths in `name` | Raw paths still in `name` (deterministic key); LLM writes `display_name` |
| Module description | None | `description ≤ 80 chars` from LLM |
| Hierarchy | Flat | mega → detail → file (3 levels) |
| Detail row `origin` | `heuristic` | **stays `heuristic`** (NOT modified by LLM) |
| Mega row `origin` | n/a | `ai-mega` |
| Trigger | `indexProject` (sync) | `indexProject` (sync) + `POST /api/aggregate` (manual) |
| Fingerprint signal | n/a | **Set of `heuristicName` values only** (not keyExports — too volatile) |

## The 8 review issues + how they're fixed

| # | Issue | Fix |
|---|---|---|
| 1 | `origin` field semantics broken — LLM changing detail's origin to `ai-aggregated` makes `replaceHeuristic`'s `DELETE WHERE origin='heuristic'` skip it next run, modules pile up | **Detail rows keep `origin='heuristic'` forever.** LLM writes `display_name` + `description` columns instead. `name` is the deterministic key |
| 2 | Mega rows never cleaned | **`replaceHeuristic` deletes both `heuristic` and `ai-mega` origins** at start of every transaction. Single source of truth for cleanup |
| 3 | Large-repo module count estimate wrong (244 → 80-100 was bogus; 666 redistribute back to existing dirs, count stays ~243) | **Adaptive depth heuristic** added in Phase A. Verified: the large test repo has about 30 top-level dirs; only outliers get drilled to 2-level. Expected ~40-60 modules |
| 4 | Fingerprint too sensitive — any file add invalidates, 60-90s rerun every cold start | **Fingerprint = sorted set of `heuristicName` only.** File additions within an existing module DON'T bust cache. Only new/removed top-level dirs do |
| 5 | LLM-failure fallback was flat heuristic names → bad UX, violates visual-priority | **Heuristic emits a static fallback mega layout** (group by 1-level dir). UI always has hierarchy. LLM result *replaces* the static megas; if LLM unavailable, static megas stay |
| 6 | 4-6 mega hardcoded → vizcoo's 8 details would be 1.3-2 per mega → useless | **`mega_target = clamp(3, ceil(N/8), 6)` when `N ≥ 7`. If `N ≤ 6`, skip mega entirely.** vizcoo (N=8) → 3 megas. large test repo (N=~50) → 6 megas |
| 7 | description length unbounded | **Prompt: `description ≤ 80 chars`.** Server-side: truncate to 80 if longer |
| 8 | `VIZCOO_FORCE_AGGREGATE` env var is debt | **Removed.** `POST /api/aggregate` is **mandatory** (was optional) and is the only way to force re-run |

## Phase breakdown

Each phase is a self-contained commit. I stop after each.

### Phase A — Adaptive heuristic + drop Foundation (~80 lines, no LLM)

`src/core/modules/discover-heuristic.ts`:
- Delete `computeFoundationFiles()`, `resolveImport()`, `IMPORT_REGEX`
- Switch from "always 2-level" to **adaptive depth**:
  ```
  1. Group all files by 1-level dir.
  2. Compute IQR on 1-level group sizes (file count).
  3. For groups with size > Q3 + 1.5·IQR (and > absolute floor of 30):
       drill into 2-level inside that group.
  4. For all other groups: keep at 1-level.
  ```
- Each module carries `dirs: string[]` (one entry for 1-level kept; multiple-or-deeper for drilled)
- Static mega fallback (used when LLM unavailable):
  ```
  Group all detail modules by their FIRST path segment.
  Each first segment = one fallback mega.
  Fallback mega name = first segment, capitalized.
  ```
  This is deterministic and computed alongside detail modules in the same function.

**Expected output:**
- vizcoo on itself (49 source files, ~7 1-level dirs): ~8 detail modules, 2-3 fallback megas (`src`, `bin`, `scripts`)
- large test repo (~1,900 files, ~30 top-level dirs): ~50 detail modules (the handful of huge top-level dirs get a 2-level drill), 1 fallback mega (almost everything sits at root level in that repo)

Verify: `curl /api/tree`; eyeball; run all 4 puppeteer tests.

### Phase B — Schema + migration (~30 lines)

`src/core/storage/schema.sql` (final shape):
```sql
CREATE TABLE IF NOT EXISTS modules (
  id           INTEGER PRIMARY KEY,
  parent_id    INTEGER REFERENCES modules(id),
  name         TEXT NOT NULL,                    -- deterministic key, e.g. "src/core" or "utils/parsers"
  display_name TEXT,                              -- LLM-set human name; UI prefers this if present
  description  TEXT,                              -- LLM-set, ≤80 chars
  origin       TEXT NOT NULL,                    -- enum, validated in TS
  created_at   TEXT NOT NULL,
  key_exports  TEXT,                              -- JSON array; NULL for mega rows
  dir_paths    TEXT                               -- JSON array; NULL for mega rows
);

CREATE TABLE IF NOT EXISTS meta (                 -- new
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

`src/core/storage/db.ts`:
- Migrate existing DB:
  - `ALTER TABLE modules ADD COLUMN display_name TEXT` if missing
  - `ALTER TABLE modules ADD COLUMN description TEXT` if missing
  - `CREATE TABLE IF NOT EXISTS meta (...)`
  - For the CHECK constraint loosening: SQLite can't ALTER CHECK; we just drop it from `schema.sql` and rely on TS layer validation. Existing DBs with old CHECK still work — they just reject unknown values, which is fine since `'heuristic'` and `'ai-split'` are still in the allowed set; we add `'ai-mega'` only on fresh DBs OR by table-rebuild migration if needed.
  
  **Actually simpler:** drop CHECK constraint entirely from `schema.sql`. For existing DBs, do the table-rebuild migration once: `CREATE TABLE modules_new ... ; INSERT SELECT ... ; DROP modules ; RENAME`. PRagma table_info detects whether old constraint exists.

`origin` allowed values (validated in `src/core/modules/origin.ts` or inline):
- `heuristic` — emitted by `discoverHeuristic`, never modified by LLM
- `ai-mega` — synthetic top-level row created by aggregation
- `ai-split` — produced by user-triggered `splitModule()`

Verify: typecheck; restart server; existing data unaffected.

### Phase C — Prompt + LLM caller (~150 lines, no integration)

`src/core/modules/llm-prompt.ts` (new, ~80 lines):
- `buildAggregationPrompt(modules, megaTarget) → string`
- Mega target rule encoded explicitly:
  ```
  if N <= 6:  no mega layer (omit megaModules from response)
  else:       megaTarget = clamp(3, ceil(N/8), 6)
  ```
  Prompt asks LLM to produce **exactly `megaTarget`** megas (or zero if `N ≤ 6`). LLM doesn't pick the count.
- Prompt content (verbatim):
  ```
  You are analyzing a TypeScript project. The directory analysis below
  produced N modules. Each module is one or more directory paths;
  attached are the top exports for that module.

  Project: <packageName>
  Total source files: <totalFiles>
  Modules to label: <N>

  <for each module:>
  [<heuristicName>]  (<fileCount> files)
    keyExports: <comma-separated, max 8>
    paths: <comma-separated dirs>

  Your task:
  - Give each module a human-readable architectural name (NOT the directory name)
    and a one-line description (≤ 80 characters).
  - <if N >= 7>: Group all modules into EXACTLY <megaTarget> mega-modules.
                Each mega gets a name (≤ 30 chars) and description (≤ 80 chars).
                Every module belongs to exactly one mega.

  HARD RULES:
  - Do NOT add modules. Do NOT remove modules. Do NOT split modules.
  - Use the exact "heuristicName" strings from input as keys.
  - Description ≤ 80 characters. Truncate aggressively. No marketing speak.
  - <if N >= 7>: Produce exactly <megaTarget> megas. Not 5 if I asked for 4.

  Respond ONLY in JSON:
  {
    "modules": [
      { "heuristicName": "...", "name": "...", "description": "..." }
    ],
    "megaModules": [
      { "name": "...", "description": "...", "contains": ["heuristicName1", ...] }
    ]
  }
  ```

`src/core/modules/discover-llm.ts` (new, ~120 lines):
- `aggregateModules(ai, heuristicModules) → AggregatedResult`
- Single `ai.complete()` call
- Reuses JSON-extraction logic from `split.ts`
- Validation:
  - Every input `heuristicName` appears once in `modules[]`
  - If `N >= 7`: `megaModules.length === megaTarget` exactly
  - Every `heuristicName` appears in exactly one mega's `contains[]`
  - All descriptions truncated to 80 chars (server-side, even if LLM ignored prompt)
  - On any failure: throw with diagnostic. Caller catches.

Verify: standalone tsx script:
```ts
// scripts/test-aggregate.ts
const heuristics = readHeuristicsFromDB(...)
const result = await aggregateModules(claudeCliProvider, heuristics)
console.log(JSON.stringify(result, null, 2))
```
Run on vizcoo and on a large TypeScript test repo. Verify shape and content. No DB writes.

### Phase D — Persist + cache + integrate (~100 lines)

`src/core/modules/persist-aggregation.ts` (new, ~70 lines):
- `applyAggregation(db, result, fingerprint)`:
  - In a single transaction:
    1. `DELETE FROM modules WHERE origin = 'ai-mega'` (clean stale megas)
    2. INSERT each mega row (`origin='ai-mega'`, `name`, `description`, no `key_exports`/`dir_paths`)
    3. For each detail in `result.modules`: `UPDATE modules SET display_name=?, description=?, parent_id=? WHERE name=? AND origin='heuristic'`
    4. `INSERT OR REPLACE INTO meta(key, value) VALUES ('aggregation_fingerprint', ?)`
    5. `INSERT OR REPLACE INTO meta(key, value) VALUES ('aggregation_result', ?)` — store the full LLM JSON for re-apply on next heuristic re-run
- `replayAggregation(db, fingerprint)`:
  - Reads cached result from `meta`, applies same way
  - Used when fingerprint matches and we want to re-decorate detail rows after `replaceHeuristic` wiped them

`src/core/modules/tree.ts` `replaceHeuristic`:
- Modify cleanup query: `UPDATE files SET module_id = NULL WHERE module_id IN (SELECT id FROM modules WHERE origin IN ('heuristic', 'ai-mega'))`
- `DELETE FROM modules WHERE origin IN ('heuristic', 'ai-mega')`
- Insert heuristic rows with `display_name=NULL`, `description=NULL`, `parent_id=NULL`

`src/core/index-project.ts`:
- After `classifyProject`:
  ```
  fingerprint = sha256(sortedJoin(heuristicModules.map(m => m.name)))
  cached = readMeta(db, 'aggregation_fingerprint')
  if cached === fingerprint && hasMeta(db, 'aggregation_result'):
    replayAggregation(db, fingerprint)        // no LLM call
  else if ai available:
    try:
      result = await aggregateModules(ai, heuristicModules)
      applyAggregation(db, result, fingerprint)
    catch error:
      log warning, fall through to fallback
  // fallback path: apply static mega from heuristic.fallbackMegas
  if no aggregation applied:
    applyStaticFallback(db, heuristicModules)
  ```

`src/core/modules/static-fallback.ts` (new, ~30 lines):
- `applyStaticFallback(db, heuristicModules)`:
  - For each unique first-segment of detail names, insert one mega with that name
  - Set parent_id of details accordingly
  - origin = 'ai-mega' (yes, even though it's heuristic — single cleanup origin)

`bin/vizcoo.ts`:
- Pass `claudeCliProvider` (already imported) to `indexProject`

Verify:
- vizcoo cold start: heuristic → LLM → 3 megas + 8 detail with names
- vizcoo restart with no file changes: cache hit, no LLM call, < 1s
- vizcoo with one new file added: same fingerprint → cache hit (because heuristicName set unchanged)
- vizcoo with new top-level dir: fingerprint busts → LLM re-runs

### Phase E — API surface (~50 lines)

`src/core/server/api/tree.ts`:
- Return:
  ```
  {
    modules: [
      {
        id, parentId, name, displayName, description, origin,
        fileCount, keyExports
      }
    ]
  }
  ```
- Sort: megas first, then their children grouped under them
- UI: prefer `displayName` if present, fall back to `name`

`src/core/server/api/aggregate.ts` (new, ~30 lines):
- `POST /api/aggregate` — force re-run
- Body: `{ force?: boolean }`. If `force=true`, ignore fingerprint
- Returns: `{ status: 'ok' | 'cached' | 'failed', tokens?: number, megaCount?: number }`
- Uses same `aggregateModules` + `applyAggregation` as Phase D

`src/core/server/http.ts`: register the new endpoint.

Verify: `curl -X POST http://localhost:3721/api/aggregate -d '{"force":true}'` re-runs the LLM call.

### Phase F — UI: render hierarchy in MapView (~40 lines)

`src/ui/MapView.tsx`:
- Use React Flow's `parentNode` for grouping
- Each mega → group container with name + description
- Each detail → child node showing `displayName ?? name` + (small) `description`
- Tooltip: `dirs.join(', ')` + `keyExports.slice(0, 5)`
- No drag-merge yet (deferred)

Verify: open browser, see grouped layout. No flat fallback.

## Schema (final after all phases)

```sql
modules:
  id INT PK
  parent_id INT FK -> modules(id)
  name TEXT NOT NULL                      -- "src/core" or "utils/parsers" or "src" (mega)
  display_name TEXT                        -- LLM
  description TEXT                         -- LLM, ≤80 chars
  origin TEXT                              -- 'heuristic' | 'ai-mega' | 'ai-split'
  created_at TEXT
  key_exports TEXT                         -- JSON array
  dir_paths TEXT                           -- JSON array

meta:
  key TEXT PK                              -- 'aggregation_fingerprint' | 'aggregation_result'
  value TEXT
```

## Cache lifecycle

```
indexProject() called
       ↓
heuristic emits N modules (always)
       ↓
replaceHeuristic clears origin IN ('heuristic', 'ai-mega') and re-inserts heuristic
       ↓
fingerprint_now = sha256(sortedJoin(names))
fingerprint_cache = meta.get('aggregation_fingerprint')
       ↓
       ↓ if equal and meta.get('aggregation_result') exists
       ↓        replay cached result, done
       ↓
       ↓ if differ and AI provider available
       ↓        try LLM call
       ↓        on success: apply + cache
       ↓        on failure: fall through
       ↓
       ↓ fallback (LLM unavailable, failed, or no AI)
                applyStaticFallback (1-level dir grouping)
```

Critical invariant: **after every `indexProject` call, the DB has a complete mega → detail tree.** Either LLM-decorated, replayed-from-cache, or static-fallback. Never half-applied.

## Failure modes (revised)

| Failure | Result |
|---|---|
| LLM call throws (network, claude CLI missing) | Static fallback megas. UI shows hierarchy with raw heuristic names |
| LLM returns invalid JSON | Same as above |
| LLM returns wrong heuristic name / wrong mega count | Same as above |
| LLM returns description > 80 chars | Server-side truncates to 80 |
| LLM returns name > 30 chars | Server-side truncates to 30 |
| Fingerprint cache hit but `aggregation_result` missing/corrupt | Static fallback + log warning |
| User has no `ai` provider configured | Static fallback (no warning needed; works silently) |

UI never sees a flat unstructured list.

## Token budget (revised)

Per project, single call:
- vizcoo (~8 detail, ~50 source files): ~3K input + ~1K output = ~4K tokens
- large test repo (~50 detail, ~1900 source files): ~20K input + ~3K output = ~23K tokens

Both fit Sonnet-4.6 200K context. Sonnet is the recommended default model (faster, cheaper, sufficient for this task).

## Order of operations

```
A.  adaptive heuristic + drop Foundation     ~80 lines net    verify: tests + curl
B.  schema migration + meta table            ~30 lines        verify: DB rebuild + tests
C.  prompt + LLM caller (no DB)              ~200 lines       verify: standalone script
D.  persist + cache + fallback + integrate   ~150 lines       verify: cold start + restart
E.  /api/tree + /api/aggregate               ~50 lines        verify: curl
F.  MapView grouped layout                   ~40 lines        verify: browser
```

I stop after each phase.

## Out of scope for Step 2

- Drag-merge UI (Step 3)
- Sub-modules within a detail module (already covered by user-triggered `splitModule()`)
- Re-aggregation on file watcher changes (only on cold start + manual `/api/aggregate`)
- Multi-file membership
- Streaming names to UI
- Renaming megas / details by hand (Step 3)

## Out of plan but worth noting

The static fallback (Phase A's mega-by-1-level-dir) is decent enough that **vizcoo could ship without LLM** and still have a usable hierarchy. The LLM step is *additive*, not foundational. This means we can iterate on the LLM prompt without risk to the baseline UX.
