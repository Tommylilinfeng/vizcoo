# Module-level audit

After file-by-file review, this audit looks at each *module* (directory of related files) as a unit. Questions per module:

1. **Cohesion**: do all files belong together? Or has it become a dumping ground?
2. **Internal coupling**: do files import each other in a sane DAG, or are there cycles / weird back-imports?
3. **External surface**: what does the module *export* to the rest of the codebase? Is it a tight API or a leaky bag?
4. **File-budget compliance**: any > 200-line files (hard limit) or > 100-line files (target)?
5. **Naming**: does each filename match its content? Does the directory name match its purpose?

I rank each module: **clean / borderline / messy / refactor-needed**.

---

## `src/analyzers/typescript/` — borderline

**Files** (9): `index.ts`, `parser.ts`, `imports.ts`, `symbols.ts`, `api-calls.ts`, `frameworks/{deps,express,monorepo,nextjs}.ts`.

- **Cohesion**: ✅ all about TS analysis. `frameworks/` is a clear sub-concern.
- **Internal coupling**:
  - `index.ts` imports all 4 main extractors + 3 framework detectors.
  - `parser.ts` is the foundation (loads tree-sitter); `imports.ts`/`symbols.ts`/`api-calls.ts` all depend on it via `withTree`.
  - `frameworks/deps.ts` is shared by `express.ts` and `nextjs.ts`. `monorepo.ts` reads `package.json` directly.
  - **No cycles**. DAG is clean.
- **External surface**: only `typescriptAnalyzer` from `index.ts`. Everything else is module-private. ✅ tight.
- **File budgets**: largest is `api-calls.ts` at 108 lines. Three files at 99-108 (imports, api-calls). Slightly above the 100-line target but all single-purpose. **Acceptable.**
- **Naming**: ✅ `imports.ts` extracts imports, `symbols.ts` extracts symbols, etc. Files are nouns, what they export is a verb. Good.
- **Borderline issue**: `frameworks/` 4 detectors share a structural pattern (filter file list into N named buckets via regex) but no shared base. Acceptable.

**Rank: borderline-clean.** Best-shaped module in the codebase.

---

## `src/core/plugin-api/` — clean

**Files** (2): `analyzer.ts`, `detector.ts`.

- **Cohesion**: ✅ contracts only.
- **Coupling**: `analyzer.ts` imports `detector.ts` for `FrameworkDetector` re-exposure. One edge.
- **External surface**: 7 types, 0 functions. Pure interface module.
- **File budgets**: 35 + 21 = trivial.
- **Naming**: ✅
- **One issue**: `ApiCall.kind` leaks TS-stack vocabulary (already noted).

**Rank: clean.**

---

## `src/core/storage/` — clean

**Files** (2): `db.ts`, `schema.sql`.

- **Cohesion**: ✅ schema + open + migrations.
- **Coupling**: `db.ts` reads `schema.sql` from disk. No code imports.
- **External surface**: `openDatabase(path) → Database`. One function.
- **File budgets**: 54 + 33. Fine.
- **Naming**: ✅
- **One issue**: migration code lives mixed in `db.ts`. As migrations grow, factor `migrations.ts`. Defer.

**Rank: clean.**

---

## `src/core/graph/` — clean

**Files** (3): `edges.ts`, `resolve.ts`, `aggregate.ts`.

- **Cohesion**: ✅ all about edges (build, resolve, aggregate).
- **Coupling**: `edges.ts` imports `resolve.ts`. `aggregate.ts` is standalone (only DB).
- **External surface**: `edgesFromImports`, `edgesFromApiCalls`, `replaceEdgesForFile`, `Edge`, `resolveImport`, `moduleEdges`, `AggregatedEdge`. Tight, all related.
- **File budgets**: 40 + 43 + 22. Excellent.
- **Naming**: ✅
- **Issues**: `edgesFromApiCalls` produces edges that nobody consumes (see core-graph audit). Architectural decision, not module-internal.

**Rank: clean.** Best balance of size + clarity in core.

---

## `src/core/modules/` — refactor-needed

**Files** (11): `classify.ts`, `discover-heuristic.ts`, `discover-llm.ts`, `aggregate-and-apply.ts`, `list-for-aggregation.ts`, `llm-prompt.ts`, `meta.ts`, `persist-aggregation.ts`, `split.ts`, `static-fallback.ts`, `tree.ts`.

- **Cohesion**: ⚠ this directory does a lot:
  - **Discovery** (heuristic + framework dispatch): `classify.ts`, `discover-heuristic.ts`.
  - **Aggregation** (heuristic → LLM-named modules): `discover-llm.ts`, `aggregate-and-apply.ts`, `llm-prompt.ts`, `list-for-aggregation.ts`, `meta.ts`, `persist-aggregation.ts`, `static-fallback.ts`.
  - **Split** (LLM splits one module on user request): `split.ts`.
  - **DB persist for heuristic** (misnamed): `tree.ts`.
  
  3-4 distinct concerns in one directory. CLAUDE.md says *"No `util/`, `common/`, or `shared/` dumping grounds"* — `modules/` is becoming "anything related to modules".

- **Coupling**: dependency graph (within this dir):
  ```
  classify.ts        → discover-heuristic.ts, tree.ts (replaceHeuristic)
  discover-heuristic.ts (no internal deps)
  discover-llm.ts    → llm-prompt.ts
  aggregate-and-apply.ts → discover-heuristic.ts (type), discover-llm.ts, persist-aggregation.ts, static-fallback.ts, meta.ts
  llm-prompt.ts      → discover-heuristic.ts (type)
  list-for-aggregation.ts → discover-heuristic.ts (type)
  meta.ts            → discover-heuristic.ts (type)
  persist-aggregation.ts → discover-llm.ts (type), meta.ts
  split.ts           (no internal deps)
  static-fallback.ts → discover-heuristic.ts (type)
  tree.ts            (no internal deps)
  ```
  
  No cycles. `aggregate-and-apply.ts` is the orchestrator — sensible. `split.ts` is independent — good.

- **External surface**: from `index-project.ts`, only `classifyProject` and `aggregateAndApply` are called. From `server/api/aggregate.ts`, `aggregateAndApply` and `listHeuristicModules`. From `server/api/split.ts`, `splitModule`. **6+ functions exported, 4 actually used externally.**

- **File budgets**:
  - `split.ts` at 137 (over target).
  - `discover-heuristic.ts` at 101.
  - `discover-llm.ts` at 108.
  - All others ≤ 55. Median ~40.

- **Naming issues**:
  - **`tree.ts` does not contain a tree.** Major.
  - `discover-heuristic.ts` and `discover-llm.ts` parallel each other in name. Decent.
  - `aggregate-and-apply.ts` is a long compound name. Acceptable for an orchestrator.
  - `list-for-aggregation.ts` reads as a verb-phrase, not a noun. The function inside is `listHeuristicModules` — file should be named after that.

### Recommended re-organization

Group by concern:

```
src/core/modules/
  discover/
    heuristic.ts       (was discover-heuristic.ts)
    classify.ts        (was classify.ts — orchestrates framework + heuristic)
  aggregate/
    apply.ts           (was aggregate-and-apply.ts)
    llm.ts             (was discover-llm.ts)
    prompt.ts          (was llm-prompt.ts)
    meta.ts            (cache fingerprint)
    persist.ts         (was persist-aggregation.ts)
    fallback.ts        (was static-fallback.ts)
    list.ts            (was list-for-aggregation.ts — for /api/aggregate)
  split/
    split.ts           (the LLM split flow)
    parse.ts           (the JSON-parse helpers — extracted from split.ts)
    prompt.ts          (the prompt-building — extracted from split.ts)
  persist-heuristic.ts  (was tree.ts — minus dead exports)
```

That's 3 sub-folders with focused contents. Could also keep `modules/` flat but rename to make the 3 phases visible:

```
modules/
  discover-heuristic.ts
  discover-classify.ts
  aggregate-apply.ts
  aggregate-llm.ts
  aggregate-prompt.ts
  aggregate-meta.ts
  aggregate-persist.ts
  aggregate-fallback.ts
  aggregate-list.ts
  split.ts
  split-parse.ts
  split-prompt.ts
  persist-heuristic.ts
```

Sub-folder option is cleaner. **Recommend the sub-folder layout.** Adds 2 levels of indirection but each folder fits in a single mental frame.

**Rank: refactor-needed.**

---

## `src/core/server/` — clean (mostly)

**Files** (12): `http.ts`, `ws.ts`, `api/{tree, graph, aggregate, conversations, hook, hookStatus, projectInfo, split, view}.ts`.

- **Cohesion**: ✅ HTTP layer.
- **Coupling**: `http.ts` imports every endpoint. Endpoints import from `core/<thing>/`. No endpoint imports another endpoint. Clean star topology.
- **External surface**: `startServer`, `attachWebSocket`. Two functions.
- **File budgets**:
  - `http.ts` at 164 (over the 150 hard rule).
  - All others ≤ 47.
- **Naming**:
  - `hook.ts` vs `hookStatus.ts` — naming inconsistent. `hook.ts` is the hook *event receiver*, `hookStatus.ts` is the *settings inspector + install/uninstall*. Names don't reflect that. Better:
    - `hookEvents.ts` (was `hook.ts`)
    - `hookSettings.ts` (was `hookStatus.ts`)
  - `view.ts` is legacy — see dead-code report.
  - `projectInfo.ts` houses 3 endpoints (slight rule violation; defensible).

### Recommended re-organization

After fixing http.ts size, the structure is fine. Possibly:

```
src/core/server/
  http.ts            (route registration only)
  static.ts          (extracted static-file serving)
  ws.ts              (websocket)
  api/
    tree.ts
    graph.ts
    aggregate.ts
    split.ts
    conversations.ts
    sessions.ts             (was: list-sessions inline in http.ts + sessionStorage in projectInfo.ts)
    project-info.ts
    hooks-events.ts         (was hook.ts)
    hooks-settings.ts       (was hookStatus.ts + hooksPreview from projectInfo.ts)
```

`projectInfo.ts` then just has the project-info endpoint, and the related endpoints (storage, preview) move to logical homes.

**Rank: clean.** Just `http.ts` size + naming nits.

---

## `src/core/view/` — refactor-needed

**Files** (6): `live.ts`, `conversations.ts`, `turns.ts`, `file-tree.ts`, `project-files.ts`, `types.ts`.

- **Cohesion**: ✅ everything is "View pipeline" — JSONL → typed model → live broadcasting.
- **Coupling**:
  ```
  types.ts          (no deps)
  turns.ts          → types.ts
  file-tree.ts      → types.ts
  project-files.ts  → types.ts
  conversations.ts  → turns.ts, file-tree.ts, project-files.ts, types.ts
  live.ts           → types.ts
  ```
  Clean DAG. `conversations.ts` is the orchestrator for the file-mode (JSONL replay), `live.ts` for the streaming-mode (hooks).
- **External surface**: from server, ~10 functions imported. Mostly via the api/ wrappers.
- **File budgets**:
  - **`live.ts` at 267 — over hard limit.** Must split.
  - `conversations.ts` at 121 — over target.
  - `turns.ts` at 119 — over target.
  - Others ≤ 51.
- **Naming**: ✅

### Recommended split for `live.ts`

(Repeated from file-by-file audit.)

```
src/core/view/
  live/
    sessions.ts        (record + PID polling + listSessions)
    edits.ts           (handleHookPre + handleHookPost + line counters)
    turns.ts           (handleHookTurnStart + handleHookStop)
    disk-context.ts    (readDiskContext + rawDiff)
    types.ts           (HookBody, PendingChange, SessionRecord, DiskContext — internal)
  conversations.ts
  turns.ts             (the JSONL parser, separate from the hook turn-handler)
  file-tree.ts
  project-files.ts
  types.ts
```

Two `turns.ts` is a name collision risk. Rename one:
- `core/view/turns.ts` (JSONL parser) → `core/view/parse-turns.ts` (verbs)
- `core/view/live/turns.ts` (hook handlers) → `core/view/live/turn-events.ts`

**Rank: refactor-needed** (mainly because of `live.ts`).

---

## `src/core/ai/` — clean

**Files** (2): `provider.ts`, `claude-cli.ts`.

- **Cohesion**: ✅ AI provider abstraction.
- **Coupling**: `claude-cli.ts` imports `provider.ts`. Linear.
- **External surface**: `AIProvider` interface, `claudeCliProvider` instance.
- **File budgets**: 11 + 23.
- **Naming**: ✅
- **One issue**: `CompleteOptions.maxTokens` and `temperature` declared but ignored. Trim.

**Rank: clean** (after JIC-options trim).

---

## `src/core/hooks/` — clean

**Files** (1): `install.ts`.

- **Cohesion**: ✅
- **External surface**: `status`, `install`, `uninstall`, `previewEntries`, `readSettings`. 5 functions.
- **File budgets**: 89 lines, under target.
- **Naming**: ⚠ the directory has one file. Two options:
  - Move to `src/core/hooks.ts` (single file, no dir).
  - Anticipate growth — when adding "hook event log" or "hook diagnostics", they'd land here.
- **My pick**: leave the dir; it's a logical boundary.

**Rank: clean.**

---

## `src/core/project/` — clean

**Files** (2): `scan.ts`, `watch.ts`.

- **Cohesion**: ✅ project-level file enumeration.
- **Coupling**: `watch.ts` imports `processFile` and `deleteFile` from `index-project.ts`. So watch's collaborator lives one level up. Acceptable — the alternative (move processing helpers down here) feels worse.
- **External surface**: `scanProject`, `watchProject`.
- **File budgets**: 49 + 47. Fine.
- **Naming**: ✅
- **Issues**: ignore-list duplicated 3× across project (see view audit). Should converge.

**Rank: clean.**

---

## `src/core/index-project.ts` (top-level)

- **Cohesion**: ⚠ this file is top-level (not inside a subdir). It exports `indexProject`, `processFile`, `deleteFile`. The latter two are also imported by `project/watch.ts` — the watcher reaches *up* to read them.
- **Where should it live?** Three options:
  1. **Stay**: top-level orchestrator. Clear "this is the entry point" signal. Current shape.
  2. **Move to `core/index/index.ts`** with full-scan + delta processing inside. `watch.ts` lives next to it.
  3. **Split**: full-scan in `core/project/scan.ts` (already half there), delta in `core/project/process.ts`.
- **Rank: clean** as-is. The top-level placement is fine; it's the public coordinator.

---

## Top-level `src/`

```
src/
  analyzers/typescript/
  core/
    ai/
    graph/
    hooks/
    modules/             (refactor-needed)
    plugin-api/
    project/
    server/
    storage/
    view/                (refactor-needed)
    index-project.ts
  ui/
    arch/                (split required, especially ArchScene)
    view/                (split required for Timeline)
    [shell files]        (split required for MapView)
```

**Two folders need internal restructuring** (`modules/`, `view/`); **three files need splitting** (`MapView.tsx`, `ArchScene.tsx`, `Timeline.tsx`, `live.ts` — that's four).

The top-level architecture (analyzers / core / ui) is sound. The plugin-discipline boundary (core never imports analyzer) holds based on imports inspected.

---

## Module summary table

| Module | Files | Largest | Rank | Top action |
|---|---:|---:|---|---|
| analyzers/typescript | 9 | 108 | borderline-clean | document `extractSymbols` contract |
| core/plugin-api | 2 | 35 | clean | rename `ApiCall.kind` enum |
| core/storage | 2 | 54 | clean | track migrations as debt |
| core/graph | 3 | 43 | clean | decide api-call edge fate |
| core/modules | 11 | 137 | **refactor-needed** | sub-folder by phase + rename `tree.ts` |
| core/server | 12 | 164 | clean | trim http.ts, rename hook files |
| core/view | 6 | 267 | **refactor-needed** | split `live.ts` |
| core/ai | 2 | 23 | clean | trim JIC options |
| core/hooks | 1 | 89 | clean | — |
| core/project | 2 | 49 | clean | unify ignore lists |
| ui (shell) | 9 | 271 | **refactor-needed** | split `MapView.tsx` |
| ui/arch | 9 | 451 | **refactor-needed** | split `ArchScene.tsx` |
| ui/view | 11 | 290 | **refactor-needed** | split `Timeline.tsx`, gate `dev-probes` |
