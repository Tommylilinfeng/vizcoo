# File-by-file audit: `src/core/server/`, `src/core/storage/`, `src/core/plugin-api/`

The HTTP/WS surface, the SQLite schema/wrapper, and the plugin contract types.

CLAUDE.md hard rules for this dir:
- `src/core/server/http.ts` ≤ 150 lines.
- `src/core/server/api/*.ts` one endpoint per file, ≤ 50 lines, **direct SQL** (no service/repo/controller layers).
- No Express/Koa.

---

## Plugin API

### `plugin-api/analyzer.ts` (35 lines)

- **Job**: type contract for language analyzers.
- **Issues**:
  - **major (carried from analyzers audit)**: `ApiCall.kind: 'fetch' | 'axios' | 'route-definition'`. Hardcoding `fetch`/`axios` in a *language-agnostic* interface is a leak from the TS analyzer. A Python analyzer should never have to know about axios. **Fix**: rename `kind: 'http-call' | 'route-definition'`, optionally add a separate `client?: string` for the TS-specific name.
  - **minor**: `extractSymbols` and `extractApiCalls` have no contract docstring. A second-language author cannot know if `class Foo extends Bar` should emit one symbol or two, whether `enum` counts, what "exported" means in Python (`__all__`?). **Add 4-line contract notes per method** as JSDoc.
  - **nit**: `Import` has 6 boolean/string flags. All TS-shaped (`isDefault`, `isNamespace`). For Python this would mean "always set isDefault=false". OK to live with.
- **Verdict**: the contract is the second-most important file in core (after the bin entry). Worth tightening.

### `plugin-api/detector.ts` (21 lines)

- **Job**: type contract for framework detectors.
- **Issues**:
  - **minor**: `confidence: number` with no documented range. Implementations use 0.7, 0.9, 0.95. A `0..1` JSDoc note is enough.
  - **minor**: `keyExports?: string[]` and `dirs?: string[]` on the result are optional — only `monorepo` and the heuristic populate them. Documented by absence. Fine.
- **Verdict**: clean. Document the confidence rubric.

---

## Storage

### `storage/db.ts` (54 lines)

- **Job**: open SQLite, run schema.sql, run migrations.
- **Issues**:
  - **major**: `migrateAddColumns` (line 18) silently adds 4 columns one by one if missing. There's no version table, no migration history. Any DB on disk gets coerced to current shape. **Risk**: if the user opens a vizcoo project across two vizcoo versions with different schemas, the DB silently mutates. For V0.1 this is fine (nobody has a vizcoo collection); for V0.2 a migration version table is the right pattern. Defer with a comment.
  - **major**: `rebuildIfOldOriginCheck` (line 27) parses `sqlite_master.sql` to detect an old CHECK constraint, then does a full table rebuild with `foreign_keys = OFF`. This is a one-time migration for an old `origin` constraint. Worked, but:
    - It's the only place in core that toggles `foreign_keys` to OFF.
    - `try { ... } finally { foreign_keys = ON }` (line 30, 50) — risk if the rebuild throws midway is small (transactional within a single `db.exec` block).
    - **Question to user**: when can this rebuild be removed? If every active project has been migrated, delete the migration. Old code is debt.
  - **minor**: `journal_mode = WAL` is set but `synchronous` isn't. WAL with default `synchronous=FULL` is slow but safe; this is fine for a local dev tool. Note in case of "why are writes slow on this 50K-file project" reports.
  - **nit**: schema and migrations live in two files (`schema.sql` for forward, `db.ts: migrateAddColumns` for upgrade). Splitting in two is fine; could also be one block of conditional `ALTER`s in `schema.sql`. Aesthetic.
- **Verdict**: works. The two migrations are technical debt — track them as such, don't grow them.

### `storage/schema.sql` (33 lines)

- **Job**: declarative schema.
- **Issues**:
  - **minor**: no FK index on `modules.parent_id`. A query like "all children of mega X" does a table scan. With 50 modules this is invisible; with 500 it bites. Add `CREATE INDEX idx_modules_parent ON modules(parent_id)`. One-line fix.
  - **minor**: `edges.kind CHECK (kind IN ('import', 'api-call'))`. As noted in `core-graph.md`, `'api-call'` rows are written but never read by `aggregate.ts`. Either remove the kind, change the consumer, or accept dead data. Schema-level note.
  - **minor**: column names mix snake_case (`module_id`, `content_hash`) and singular-word (`name`, `origin`). That's the SQLite convention; fine.
  - **nit**: `idx_files_module` is duplicated — it's in `schema.sql:33` AND created inside the rebuild migration in `db.ts:48`. Duplicate-but-idempotent (`IF NOT EXISTS`). Harmless.
- **Verdict**: small schema, mostly clean. Add the parent_id index when convenient.

---

## Server

### `server/http.ts` (164 lines) — **OVER BUDGET (≤150)**

- **Severity**: **MAJOR** — violates CLAUDE.md own hard rule.
- **Job**: route registration + startup.
- **Issues**:
  - **MAJOR — file budget**: 164 lines vs. 150 limit. Not far over. Where's the bloat?
    - Static-file serving (lines 33-40 MIME, 140-163 `serveStatic`+`streamFile`) = ~30 lines. **Could move to `server/static.ts`.** Then route registration alone is ~120 lines, well under budget.
    - Or `readJson` / `sendJson` (lines 119-138) ~20 lines. Could move to `server/io.ts`.
    - Picking one move is enough.
  - **major**: `handle` function (lines 50-74) is a 25-line if-chain. CLAUDE.md says functions ≥ 20 lines should consider splitting "because doing two things, not to hit the number". This one *is* doing one thing — dispatch — but it's also doing it via repeated `if (req.method === 'X' && url.pathname === 'Y')` boilerplate. A `routes` table would be 1-2 lines per route, declarative:
    ```ts
    const ROUTES = [
      { method: 'GET',  path: '/api/tree',  handler: (cfg) => sendJson(treeEndpoint(cfg.db)) },
      ...
    ]
    ```
    But that's 20 routes × 2 lines = 40 lines too. The savings are real but modest. **Verdict on this**: keep the if-chain — it's straightforward, all in one place, easy to grep. Don't add abstraction for 20 routes.
  - **minor**: `serveStatic` falls back to `index.html` if the path isn't found (line 145-150). That's correct for an SPA. The double `fs.stat` on the same path is wasteful (could be `fs.stat(file, ...) || fs.stat(index, ...)` flattened). Minor.
  - **minor**: 4 separate `try/catch (err) { sendJson(res, 4xx, { error }) }` blocks in `handleHook`, `handleSplit`, `handleAggregate`, `handleViewTurns/Files`. Same shape. A helper `sendError(res, status, err)` saves 3 lines per use; but the catch+error message format also varies (400 vs 500 vs 404). Marginal.
  - **nit**: status code hygiene is OK — `handleSplit` returns 400 for bad input, `handleAggregate` returns 500 for any failure. The latter could distinguish (bad body = 400, LLM down = 500). For V0.1 this is fine.
- **Verdict**: **break out static file serving to bring under budget.** Then this file is fine.

### `server/ws.ts` (26 lines)

- **Job**: attach a WebSocket server to the http.Server, expose broadcast/close.
- **Issues**: none.
- **Verdict**: clean. Tiny, single-purpose.

### `server/api/tree.ts` (33 lines)

- **Job**: `GET /api/tree` — list modules with file counts.
- **Issues**:
  - **minor**: SQL has `(SELECT COUNT(*) FROM files f WHERE f.module_id = m.id) AS fileCount`. That's a correlated subquery — for N modules, N+1 queries by SQLite's planner. With 50 modules, invisible; with 500, visible. A `LEFT JOIN` + `GROUP BY` would be more efficient. Optimization, not a correctness bug.
  - **minor**: `keyExportsRaw` is parsed JSON. Already noted in `list-for-aggregation.ts` — same shape. Fine.
- **Verdict**: clean. Note the perf for V0.2.

### `server/api/graph.ts` (7 lines)

- **Job**: `GET /api/graph` — return module-level edges.
- **Issues**: none.
- **Verdict**: exemplary thin endpoint.

### `server/api/aggregate.ts` (16 lines)

- **Job**: `POST /api/aggregate` — run aggregation, return status + module count.
- **Issues**:
  - **nit**: `body.force === true` (line 13) — explicit boolean compare. Defensive against non-boolean truthy values. Fine.
- **Verdict**: clean.

### `server/api/conversations.ts` (21 lines)

- **Job**: `GET /api/conversations` and `GET /api/conversations/:id`.
- **Issues**:
  - **minor**: the list endpoint enriches with live status (`alive` / `dead`). The detail endpoint doesn't include status (returns the raw `ConversationDetail`). Asymmetric. Either both should include status, or the response schema should clearly say "status is on the list only". **Recommendation**: include status in the detail response for symmetry.
  - **nit**: alive lookup is O(N×M) — for each conversation, check membership in `aliveIds`. With Set lookup it's O(N) — already correct.
- **Verdict**: clean. Symmetry fix is optional.

### `server/api/hook.ts` (28 lines)

- **Job**: dispatch `POST /hook/:route` to the appropriate handler in `core/view/live.ts`.
- **Issues**:
  - **minor**: `asBody` cast at line 25 is liberal — `Parameters<typeof handleHookPre>[0]` is `HookBody` from `live.ts`, and we're casting `unknown` to it. Inside `live.ts` every field is then re-checked with `String(body.x ?? '')`. The double-defense is fine; the cast is just shutting up the type checker.
  - **minor**: `session-start` uniquely needs the `claude_pid` query param — handled inline (line 10-13). Clean.
  - **nit**: `ROUTES` is a record. Adding a route is one line. Good shape for this pattern.
- **Verdict**: clean.

### `server/api/hookStatus.ts` (16 lines)

- **Job**: 3 thin wrappers around `core/hooks/install.ts`.
- **Issues**: none.
- **Verdict**: clean.

### `server/api/projectInfo.ts` (47 lines)

- **Job**: 3 endpoints: project info, session storage stats, hooks preview.
- **Issues**:
  - **minor**: 3 endpoints in 1 file. CLAUDE.md says *"one file per endpoint, under 50 lines each"*. We're at 47 lines for 3 endpoints, so technically violates the "one per file" rule. Splitting into `projectInfo.ts`, `sessionStorage.ts`, `hooksPreview.ts` would be 3 × ~15 lines. Mild trade-off — if these are conceptually all "settings-modal supporting endpoints", grouping makes sense.
  - **minor**: `sessionStorageEndpoint` walks `~/.claude/projects/<dashed>/` synchronously (line 32-37). For a long-running CC user with thousands of sessions across many projects, this is noticeable. Async-ify if a perf complaint arises.
  - **minor**: `try { fs.realpathSync(root) } catch { return root }` (line 26) — silent fallback. CLAUDE.md disallows. Realpath fails when the path is a removed symlink; falling back to the literal `root` is reasonable. Add a 1-line comment to mark it as intentional.
  - **nit**: same `realpathSync` + dashed-path conversion is duplicated in `core/view/conversations.ts:26-29` (`projectsDirFor`). Two implementations. Move to one of: a `core/claude-paths.ts` helper, or import the existing `projectsDirFor` here. **Action**: delete the local copy, import `projectsDirFor`. Saves 4 lines, removes duplication.
- **Verdict**: clean except for the duplicated `projectsDir` helper.

### `server/api/split.ts` (20 lines)

- **Job**: validate `moduleId`, call `splitModule`.
- **Issues**: none beyond the inline body validation, which is correct (CLAUDE.md: "Validate only at system boundaries"). Clean.
- **Verdict**: clean.

### `server/api/view.ts` (22 lines) — LEGACY

- See dead-code report (`01-dead-code.md` item #7). Either delete with the puppeteer tests or keep as a thin compatibility layer.
- **Verdict**: KEEP-OR-DELETE.

---

## Cross-cutting

1. **`http.ts` is the only file in the codebase over its budget**. Splitting out `static.ts` is a 5-minute job.
2. **`projectsDir` helper duplicated** in 2 files — easy fix.
3. **`projectInfo.ts` houses 3 endpoints** vs. the "one per file" rule — judgment call (related endpoints, all small). Defensible.
4. **No service/repository/controller layers anywhere** — discipline holds. ✅
5. **No Express/Koa** — using `node:http` natively. ✅

The server layer is one of the cleanest parts of the codebase. The only real cleanup is the `http.ts` file size and the `projectsDir` duplication.
