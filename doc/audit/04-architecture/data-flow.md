# Architecture audit — Data flow

This pass traces data end-to-end. Each pipeline is examined for: clarity of stages, redundant transformation, lossy steps, race conditions, and cohesion of the path.

The four data flows are:

1. **Index pipeline**: cold-start + delta. Source code → DB.
2. **Module aggregation pipeline**: heuristic modules → mega modules + display names.
3. **Map render pipeline**: DB → JSON → React state → SVG.
4. **View pipeline**: Claude Code (JSONL or live hooks) → typed turns → 3D scene.

---

## 1. Index pipeline

### Cold start (`indexProject`)

```
bin/vizcoo.ts
  ↓ openDatabase(.vizcoo/graph.db)
  ↓ analyzers[].init()  // load tree-sitter WASM
  ↓ scanProject(root, analyzers)  // → string[] of relative paths
  ↓ for each path:
  ↓   processFile(db, root, path, analyzers):
  ↓     analyzer = analyzers.find(canHandle)
  ↓     source = fs.readFileSync(path)
  ↓     hash = sha256(source)[:16]
  ↓     INSERT files (path, hash, module_id=NULL) ON CONFLICT UPDATE hash
  ↓     imports = analyzer.extractImports(source, path)
  ↓     apiCalls = analyzer.extractApiCalls(source, path)
  ↓     edges = [
  ↓       ...edgesFromImports(path, imports, root),  // resolves via graph/resolve.ts
  ↓       ...edgesFromApiCalls(path, apiCalls),
  ↓     ]
  ↓     replaceEdgesForFile(db, path, edges)
  ↓ classifyProject(db, root, files, allDetectors)
  ↓   for each detector: detect(ctx) → DetectorResult | null, pick max confidence
  ↓   if winner: replaceHeuristic(db, winner.modules) → returns null heuristic
  ↓   else:      heuristic = discoverHeuristic(root, files); replaceHeuristic(...); return heuristic
  ↓ if heuristicModules:
  ↓   aggregateAndApply(db, ai, heuristicModules):
  ↓     fingerprint = sha256(names)[:32]
  ↓     if cached: applyAggregation(db, cached, fingerprint) → 'cached'
  ↓     elif ai: try aggregateModules(ai, modules) → applyAggregation → 'llm'; on error: applyStaticFallback → 'fallback'
  ↓     else: applyStaticFallback → 'fallback'
  ↓ return stats
```

**Stages**: scan → per-file extract → aggregate to module table → group into megas.

**Strengths**:
- Each stage has a clear input and output type. Easy to follow.
- Idempotent: re-running on the same files leaves the same DB state.
- The `ON CONFLICT UPDATE` semantics let cold start overwrite stale rows safely.

**Concerns**:

1. **`content_hash` is computed and stored but never read** (already noted). The hash *should* let us skip re-extracting unchanged files, but `processFile` doesn't check the hash before re-reading and re-parsing. **Wasted work** on incremental updates if a file's content didn't actually change. Two fixes:
   - Add the check: `if (hashUnchanged) return 0`. ~5 lines.
   - Drop the hash column entirely.
2. **Edges are deleted-then-inserted** even on no-change updates. SQL: `DELETE FROM edges WHERE source_file = ?` then `INSERT`. Acceptable but expensive for huge files.
3. **No transaction across the cold-start loop.** Each `processFile` opens its own implicit auto-commit per statement. If vizcoo crashes mid-scan, the DB has half the project indexed. Acceptable for V0.1 (next run finishes).
4. **Race**: nothing prevents the watcher from firing during cold start. `indexProject` is called *before* `watchProject`, so this is sequential. ✅
5. **Detector vs heuristic split**: `classifyProject` returns `heuristicModules: HeuristicModule[] | null`. When a framework detector wins (returns non-null with confidence > 0), `aggregateAndApply` is **skipped** (since `heuristicModules` is null). So a Next.js project gets *no* LLM aggregation — just the framework's bucket names. Is that intentional?
   - **Argument for**: Next.js's "Pages / Components / Lib" are already meaningful; LLM relabeling could only make them worse.
   - **Argument against**: A user might want LLM-derived mega-grouping ("UI surface", "data layer") even on top of detector buckets.
   - **Current**: detector wins → no aggregation, no megas. **Likely intentional but undocumented.** Document.

### Delta (`watchProject`)

```
chokidar watcher on root, ignore configured set
  ↓ on add/change(path):
  ↓   processFile(db, root, path, analyzers)  // same as cold-start, single file
  ↓   handlers.onChange()  // → ws.broadcast({type:'update'})
  ↓ on unlink(path):
  ↓   deleteFile(db, path)
  ↓   handlers.onChange()
```

**Strengths**:
- Reuses `processFile` from cold start. ✅ DRY.
- Clean WS broadcast per change.

**Concerns**:

1. **No debouncing**. A burst of 100 changes (`git checkout`) fires 100 broadcasts. Frontend then re-fetches `/api/tree` + `/api/graph` 100 times. ~5-line fix (tail debounce).
2. **No re-classification or re-aggregation on delta.** A new file in a new directory won't appear in any module — `processFile` only updates `files` and `edges` tables. The new file's row has `module_id = NULL`. **Frontend behavior**: that file effectively disappears from the visualization (the SQL `JOIN` excludes `module_id IS NULL`). User adds a new directory → silent invisibility until cold restart.
   - **Is this intentional?** Per CLAUDE.md "Cold start is heuristic only", running the heuristic on every file change would be expensive and would re-name modules unexpectedly. So skipping is reasonable.
   - **But**: the user has no signal that "you need to restart vizcoo to see new directories". UX gap.
   - **Fix options**: (a) add a "re-classify" button in UI; (b) auto-classify after N changes; (c) document the limit.
3. **Edge cases with `'api-call'` edges**: same as cold start — written, ignored.

**Verdict**: ✅ pipeline is correct and simple. Two real UX gaps (new-dir invisibility, no debounce). The dead `content_hash` should be either used or removed.

---

## 2. Module aggregation pipeline

```
heuristic modules (HeuristicModule[])
  ↓ computeFingerprint(modules) = sha256(names.sorted)[:32]
  ↓ readMeta(db, 'aggregation_fingerprint')
  ↓ if cached fp matches and aggregation_result exists:
  ↓   parse cached → applyAggregation(db, cached, fingerprint)  // 'cached'
  ↓ elif ai available:
  ↓   prompt = buildAggregationPrompt(modules, megaRangeFor(modules.length))
  ↓   raw = ai.complete(prompt, model)
  ↓   parsed = JSON.parse(extractJson(raw))
  ↓   validate(parsed, modules, range)
  ↓   truncate(parsed)  // enforce MAX_NAME=30, MAX_DESC=80
  ↓   applyAggregation(db, parsed, fingerprint)  // 'llm'
  ↓ else:
  ↓   applyStaticFallback(db, modules)  // 'fallback' (capitalize first directory segment)
```

**Strengths**:
- Caching by fingerprint keeps repeat cold starts cheap.
- Validation is strict — LLM lying is caught (unknown heuristic name → throw).
- Three explicit outcome states: `cached / llm / fallback`. UX-meaningful.

**Concerns**:

1. **Fingerprint hashes only names**, not file lists. So if heuristic re-runs and produces the same module names but different file membership, the cached aggregation is reused. Documented above (`02-files/core-modules.md`). For V0.1 fine; for V0.2 might bite.

2. **Cache replay is wrapped in try/catch** (`aggregate-and-apply.ts:34-37`) — if cached JSON is corrupt, falls through to LLM. Reasonable.

3. **LLM call can hang**. `claudeCliProvider` has no timeout. If `claude -p` blocks indefinitely, vizcoo's cold start hangs. **The CLI uses `tsx` and `process.on('SIGINT')` cleanup, so Ctrl-C works** — but the user sees no progress for minutes. **Add a 30s timeout in `claudeCliProvider`.**

4. **Static fallback is silent** in the sense that the dashboard doesn't visually distinguish fallback megas from LLM megas. Module names like "Src" or "App" (capitalized first segment) tell a sharp user the LLM didn't run, but a casual user wouldn't notice. **UX**: show the `aggregation: 'fallback'` status in the UI as a banner.

5. **Cold-start LLM aggregation conflicts with CLAUDE.md** (already discussed in extensibility audit). On first-ever index of a project (no cache), the LLM runs unprompted. Either it's wanted (in which case CLAUDE.md should be updated) or it's a drift (in which case the cold start should default to fallback).

**Verdict**: ✅ correct and well-validated. The CLAUDE.md conflict is real and should be resolved.

---

## 3. Map render pipeline

### Server side

```
GET /api/tree → treeEndpoint(db):
  SQL: SELECT modules + COUNT(*) AS fileCount, ORDER BY (parent_id IS NULL) DESC, parent_id, fileCount DESC, name
  parse keyExports JSON → Module[]
  return { modules }

GET /api/graph → graphEndpoint(db):
  SQL: SELECT module_id pairs, GROUP BY, COUNT — all in one query
  return { edges: [{sourceId, targetId, count}] }
```

### Client side

```
MapView.tsx:
  on mount: Promise.all([fetchTree(), fetchGraph()])
  WS open '/ws' → on 'update' message: re-fetch tree + graph
  state: modules, edges, selectedId, settings, ...
  archRoots = buildTree(modules)  // group by parent_id, recursive aggregate fileCount

ArchScene receives modules + edges:
  tree = buildTree(modules) AGAIN (redundant — see below)
  layoutOpts = layoutOptionsFromSettings(settings)
  layout = layoutTree(tree, expanded=null, layoutOpts, hiddenFloors)  // d3 treemap per floor + 3D-stack Z
  visibleEdges = aggregateEdges(layout.floors, edges, settings.edgeMaxCount)
  render SVG: defs (gradients/shadow), then transform group with floors + chips + edges
```

**Concerns**:

1. **`buildTree(modules)` is called twice** — once in `MapView.tsx:47` (for `archRoots`, used by `LegendHud` and `DetailPanel`), once inside `ArchScene.tsx:49`. Each is `useMemo`'d, so the cost is per-update, not per-render. Still: same input, same function, two outputs. **Fix**: pass `archRoots` from `MapView` → `ArchScene` instead of re-building. Saves 1 traversal per update. Minor.

2. **`/api/tree` ORDER BY is opinionated**: `(parent_id IS NULL) DESC, parent_id, fileCount DESC, name`. Roots first, then children grouped by parent, then by file count. Frontend's `buildTree` re-sorts anyway (`children.sort((a, b) => b.fileCount - a.fileCount)`). The SQL ordering is wasted work. **Fix**: remove the ORDER BY entirely (or simplify to just `ORDER BY id`). Frontend sorts.

3. **No incremental updates**. WS sends `{type:'update'}`; frontend re-fetches *everything*. For a 500-file project, that's a 50KB+ JSON. **Acceptable** for V0.1 (refresh is < 100ms); poor for V0.2.

4. **Selection state reset on update**: frontend re-fetches and re-builds `archRoots`. The `selectedId` survives (state isn't cleared) but if the selected module's ID changed (e.g., split rebuilt the modules), the panel shows stale info. **Edge case** — split flow does `setSelectedId(null)` on success, so this is handled for the explicit case.

5. **Edge filtering on the client (`aggregateEdges`)**: the server sends ALL module-edges; client filters by visibility + threshold + max count. **Server could pre-filter** for "only edges between visible modules" — but visibility depends on client settings, so not really. Acceptable.

**Verdict**: ✅ pipeline is clean. The two redundancies (buildTree twice, ORDER BY ignored) are nits.

---

## 4. View pipeline

Two modes: **JSONL replay** and **live hooks**. Both end at the same zustand store; the user sees the same UI.

### JSONL replay (file-mode)

```
GET /api/conversations → conversationsListEndpoint(root, fixturePath):
  live = listSessions()  // hook-tracked sessions (in-memory)
  aliveIds = Set of alive session IDs
  summaries = listConversations(root, fixturePath):
    if fixturePath: parse single fixture
    else: scan ~/.claude/projects/<dashed>/*.jsonl
    each .jsonl → parseTurns(file) → buildView(turns) → summarize first/last → ConversationSummary
  return { conversations: summaries.map(s => ({ ...s, status: aliveIds.has(s.id) ? 'alive' : 'dead' })) }

GET /api/conversations/:id → conversationDetailEndpoint(root, id, fixturePath):
  fixturePath mode: load fixture only.
  live mode: parse the matching .jsonl + merge with project file scan.
  loadDetail:
    parseTurns(jsonlPath)
    view = buildView(turns):
      collect all paths → commonPrefix → relativize each path → FileNode[]
      strip absolute paths from each turn's fileChanges → relativized turns
    if mergeWithProjectScan: scanProjectFiles(root) joined into view.files
    return ConversationDetail { id, title, createdAt, lastActivity, turnCount, fileCount, files, turns }
```

**Strengths**:
- The `ConversationDetail` is a complete snapshot — frontend gets everything in one fetch.
- `commonPrefix` is computed once, applied to all paths consistently.
- Fixture mode is clean — same plumbing, different source.

**Concerns**:

1. **`mergeWithProjectScan` runs on every detail fetch.** `scanProjectFiles` walks the project filesystem. With a 500-file project, this is 500 stat calls per fetch. The user clicking between conversations triggers a fresh scan each time. **Cache** the project scan with a short TTL (5 seconds) or invalidate on file watcher events.

2. **Live status** is determined at *list* time, not at *detail* time (asymmetric — see `02-files/core-server-storage.md`). When the user opens a detail page, they don't see whether the conversation is alive. The selector knows; the detail doesn't.

3. **No pagination**. A project with 100 conversations returns 100 summaries. Each summary parses a JSONL file. For 100 files at ~50KB each = 5MB parsed per `/api/conversations` call. Slow.
   - **Fix**: cache summaries by JSONL `mtimeMs`. ~10 lines.
   - Or: limit to 30 most recent.

4. **Title heuristic** is the first user prompt, truncated. For prompts like `<command-name>...` (the local command annotations like `/clear`), the title is gibberish. **Fix**: skip prompt-decorations, take the actual user text. ~5 lines.

### Live hooks

```
PostToolUse hook fires → curl POST /hook/post → http.ts:handleHook → hook.ts:dispatchHook('post', ...)
  → live.ts:handleHookPost(body, deps):
    pending = pending.get(toolUseId) (set by handleHookPre)
    pending.delete(toolUseId)
    readDiskContext(filePath, prev, inp):
      if write → first lines of new content as 'add' lines
      else if file missing → rawDiff (oldString add, newString del — wait, that's backwards)
      else → indexOf(newString) in disk → resolve line numbers, emit context+del+add+context window
    broadcast({ type: 'live-done', sessionId, toolUseId, path, ..., contextStartLine, contextLines })
```

**Concerns**:

1. **`readDiskContext` looks for `newString` in disk** (line 231). If the user undid the change before the hook resolves, `newString` is no longer in the file → falls back to `rawDiff`. Fine.

2. **`rawDiff` order looks suspicious** at first read but is correct: it shows old (`del`) lines first, then new (`add`) lines. Standard diff order.

3. **State race**: `pending` Map, `sessions` Map, all module-globals. If two hooks for the same `toolUseId` arrive in quick succession (won't happen in practice with CC), the second `delete` is a no-op. Safe.

4. **`liveActivePath` in zustand**: set on `live-pending`, cleared on `live-done`. If a hook drops, the path stays "active" forever (visually a plate stays raised). **Edge case**: hook delivery is fire-and-forget HTTP curl. If vizcoo isn't running yet, the hook silently 404s; if vizcoo restarts mid-edit, the `pending` map is empty, `live-done` arrives with no `prev` — handled at line 148-149 (uses fallback values).

5. **Session liveness via PID polling**: `startSessionPoller` runs `process.kill(pid, 0)` every 1s. For 5 alive sessions, 5 syscalls/second. Negligible. ✅

6. **`UserPromptSubmit` → `live-turn-start`** happens before any `PreToolUse`. The viewStore reacts by **calling `loadConversations()`** — full re-fetch. That's a heavy reaction to a turn-start. Document or rate-limit. The user clicks "send" → vizcoo refetches the whole list. For a 100-conversation project, costly.

**Verdict**: ⚠ correct but heavy. The full re-fetch on every turn-start, plus the per-detail project scan, are the two perf concerns. Both are caching opportunities.

---

## Cross-cutting data-flow findings

### Where data is duplicated

1. **Module list**: server (DB) → `/api/tree` (JSON) → client (`Module[]`) → `archRoots` (`ArchNode[]` via `buildTree`) → `layout.floors` (`PositionedNode[]`).
   - 5 representations. Each adds a useful transform.
2. **Module edges**: server (file-edges in DB) → `moduleEdges` (SQL aggregation) → `/api/graph` → client (`ModuleEdge[]`) → `visibleEdges` (filtered + thresholded).
   - 5 representations. Same.
3. **Conversation files**: JSONL paths → `parseTurns` → `buildView` (relativized) → `mergeWithProjectScan` → frontend → `buildLayout` → `slots: Map<path, SlotPos>`.
   - 6 representations. Each adds value.

**Verdict**: not over-engineered. Each transform serves a purpose.

### Where data is dropped

1. **`'api-call'` edges**: written, never aggregated.
2. **`content_hash`**: computed, never read.
3. **`'route-definition'` ApiCall.kind**: declared in interface, never produced.
4. **`CompleteOptions.maxTokens, temperature`**: declared, never passed.

Four "write-only" or "declare-only" data items. Each is a small smell — unused capacity hints at unfinished thought.

### Where data is recomputed

1. `buildTree(modules)` called in `MapView` and `ArchScene`. Same input; one would be enough.
2. `scanProjectFiles(root)` called per `/api/conversations/:id` request. No cache.
3. `parseTurns(jsonlPath)` called once for `summarize` and again for `loadDetail`. Could cache.

**Optimization potential**: 3-4 places where caching would speed up the dashboard. Defer until perf is a complaint.

### Race conditions checked

| Pair | Risk | Status |
|---|---|---|
| cold-start indexing vs file watcher | watcher attached after index, sequential | ✅ |
| two concurrent `/api/split` requests | not protected | ⚠ |
| two concurrent `/api/aggregate` | not protected | ⚠ |
| WS broadcast vs DB write order | broadcast fires after DB write completes | ✅ |
| live hook arriving during full re-index | watcher disabled during cold start? **No.** | ⚠ |

The split/aggregate races aren't likely (single-user local tool) but a "Split" button double-click would currently fire two split calls. Frontend disables the button (`MapView.tsx:185 disabled={splitting}`), so safe.

### Stages summary

| Pipeline | Stages | Worst stage | Top fix |
|---|---:|---|---|
| Index (cold) | 4 | classify | document new-dir invisibility |
| Index (delta) | 1 | -- | add debounce |
| Aggregation | 3 | LLM call | add timeout |
| Map render | 4 | client buildTree x2 | dedupe |
| View JSONL | 5 | mergeWithProjectScan | cache the scan |
| View live | 4 | turn-start full refetch | rate-limit refetch |

The pipelines are conceptually clean; what's missing is caching at the high-cost edges.
