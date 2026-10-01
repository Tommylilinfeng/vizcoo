# Architecture audit — Boundaries

CLAUDE.md is explicit about the boundaries that matter:

1. **Plugin discipline**: nothing in `src/core/` imports from `src/analyzers/`. Core receives the analyzer registry at startup and dispatches via `canHandle(filePath)`.
2. **File-level edges only**: edges between files are persisted; module-level edges are computed on-the-fly.
3. **Server file budgets**: `http.ts` ≤ 150 lines; api/*.ts one endpoint per file under 50 lines, with direct SQL.
4. **No Express/Koa**.

This audit checks each boundary against the code, then looks for less-explicit boundaries that the codebase *also* enforces (or fails to).

---

## 1. Plugin discipline (core ↔ analyzer)

**Test**: `Grep "from ['\"](\\.\\./)+analyzers"` in `src/core/`.

**Result**: zero matches.

**Inverse test**: `Grep "from ['\"]\\.\\./\\.\\./core"` in `src/analyzers/`.

**Result**: 16 imports — analyzer files import contract types (`LanguageAnalyzer`, `Import`, `CodeSymbol`, `ApiCall`, `FrameworkDetector`) from `src/core/plugin-api/`. **All of them are types.** No analyzer imports a function from core.

**Verdict**: ✅ **discipline holds.** The flow is right: analyzer depends on core's contracts, core never depends on analyzer's implementation.

**Wiring point**: `bin/vizcoo.ts:11` is the *only* place that imports a concrete analyzer. From there it's passed as a list into `indexProject(...)`, `startServer(...)`, `watchProject(...)`. Each consumer then dispatches via `analyzers.find(a => a.canHandle(filePath))`.

**Discovered concern**: the contract leak in `ApiCall.kind: 'fetch' | 'axios' | 'route-definition'`. The interface lives in core but encodes TS-stack vocabulary. A Python analyzer would either misuse `'fetch'` or have to extend the type. This is the only boundary leak in the plugin contract. **Action**: rename to `'http-call' | 'route-definition'` (already noted in `02-files/analyzers.md`).

---

## 2. File-level edges only

**Test**: where do module-level edges come from?

- `src/core/graph/edges.ts` — operates on file paths exclusively.
- `src/core/storage/schema.sql` — `edges (source_file, target_file, kind)`. **File-level.** No `module_id` on edges.
- `src/core/graph/aggregate.ts` — runs the SQL aggregation `JOIN files ... GROUP BY module_id`. **Computed on demand.** Returns `(sourceId, targetId, count)` for the dashboard.

**Verdict**: ✅ **discipline holds.** When a module re-splits, the only thing that changes is `files.module_id`. Edges stay untouched. `aggregate.ts` re-runs the GROUP BY and produces fresh module edges. Exactly the design intent.

**Discovered concern**: `edges` table has `kind = 'api-call'` rows. Those rows are *not* aggregated by `aggregate.ts:14` (`WHERE e.kind = 'import'`). So `'api-call'` edges are **stored but unused**. Either:
- Delete them (return `[]` from `edgesFromApiCalls`).
- Aggregate them too — but then "module-edges" would mix imports with HTTP calls. Probably fine if the dashboard distinguishes.
- Use them for a separate feature (e.g., highlight Page → API-Route flows).

**Action**: pick a story before V0.2.

**Discovered minor concern**: the SQL in `aggregate.ts` filters out same-module edges (`sf.module_id != tf.module_id`). Correct. If we want a "self-loops" view (module's internal connectedness), we'd need a different query. Not required for V0.1.

---

## 3. Server file budgets

**Tests**:

- `src/core/server/http.ts`: **164 lines** vs 150 limit. ❌ **violates by 14 lines.**
- `src/core/server/api/*.ts`: one file per endpoint, ≤ 50 lines each.
  - `tree.ts`: 33 ✅
  - `graph.ts`: 7 ✅
  - `aggregate.ts`: 16 ✅
  - `conversations.ts`: 21 ✅ (2 endpoints — borderline rule violation)
  - `hook.ts`: 28 ✅ (multiple hook routes via dispatch table — defensible)
  - `hookStatus.ts`: 16 ✅ (3 endpoints in one file — borderline rule violation)
  - `projectInfo.ts`: 47 ✅ (3 endpoints — borderline)
  - `split.ts`: 20 ✅
  - `view.ts`: 22 ✅ (legacy)

**Verdict**: ⚠ **mostly holds.** `http.ts` over-budget. Three files house multiple endpoints (`hookStatus`, `projectInfo`, `conversations`). Each is small.

The "one endpoint per file" rule is **strictly violated** in three places, but since the alternative is 5 files of 5 lines each, this is a sensible bend of the rule. Still, the rule is a rule. Pick:
- **Strict**: split into `hookInstall.ts`, `hookUninstall.ts`, etc. Adds 6 files.
- **Pragmatic**: keep as-is, document the bend.

I lean pragmatic but acknowledge the rule-vs-reality tension.

**No service / repository / controller layer**. ✅ Direct SQL or direct module import in every endpoint.

---

## 4. No Express/Koa

`Grep "express"`, `"hono"`, `"koa"`, `"fastify"` in `package.json` and `src/`:

- `express`: appears only in **detector code** (`analyzers/typescript/frameworks/express.ts`) — looking for *user projects'* dependencies, not vizcoo's. ✅
- `hono`: appears only in `BACKEND_PKGS` (same detector). ✅
- Others: zero hits.

`src/core/server/http.ts` uses `node:http` natively. ✅

**Verdict**: ✅ **clean.**

---

## 5. UI viz library boundary

CLAUDE.md: *"One viz library (React Flow), one styling approach (Tailwind), no state-management library, no CSS-in-JS library, no animation library beyond what React Flow ships."*

Memory file: *"Visual quality is top priority — visuals trump code volume/perf; CLAUDE.md stack limits apply to arch-map only, not new features."*

**Test (arch only)**:

- `src/ui/arch/`: uses **SVG** (custom iso projection), `d3-hierarchy` (treemap layout). **No React Flow used in arch.**
- `package.json`: `@xyflow/react` is a dep. Imported only in `src/ui/main.tsx` for its CSS. **Zero React Flow components rendered.**

**Verdict**: ❌ **arch does NOT use React Flow.** The CLAUDE.md rule is broken. Two interpretations:
1. The rule was aspirational; actual choice was custom SVG.
2. Memory's exemption was retroactive.

Either way, the *current* state is: vizcoo has no React Flow code, only the CSS import. The dep can be dropped, OR the arch view should be ported to React Flow.

**Action items**:
- Delete `@xyflow/react/dist/style.css` import from `main.tsx`.
- Decide: drop `@xyflow/react` dep, or commit to porting arch to it (V0.2 work).
- Update CLAUDE.md to reflect reality.

**Test (view)**:

- `src/ui/view/`: uses **Three.js** (`@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`), **react-spring** (`@react-spring/three`), **zustand**.

This is allowed by memory ("CLAUDE.md stack limits apply to arch-map only, not new features"). ✅

But the consequence: **two completely different rendering stacks coexist**. SVG in arch, Three.js in view. They share no rendering code. The cost is bundle size + cognitive overhead. The benefit is each stack is well-suited to its task (SVG for stacked iso, Three.js for animated 3D plates).

**Verdict for view**: ✅ permitted, well-chosen.

---

## 6. Read vs. write boundaries

CLAUDE.md: *"read-only visualization. All writes (module rename, file reassignment) are deferred past V0.1. AI-driven module splitting is the only user-controlled mutation."*

**Test**: what mutations does the system perform?

1. `bin/vizcoo.ts` → `indexProject` writes files + edges + heuristic modules. ✅ scan-write.
2. `bin/vizcoo.ts` → `aggregateAndApply` writes mega + display_name + description. ✅ aggregation-write.
3. `watch.ts` → `processFile` updates one file's edges. ✅ delta-write.
4. `POST /api/aggregate` (manual re-aggregate). ✅ user-triggered.
5. `POST /api/split` → `splitModule` writes new sub-modules, deletes parent. ✅ AI-controlled mutation per CLAUDE.md.
6. `POST /api/hooks/install`, `/uninstall` → mutate `~/.claude/settings.json`. ✅ explicit setting.

No "rename module" endpoint. No "reassign file" endpoint. No frontend write affordance other than the **Split** button. ✅

**Verdict**: ✅ **boundary holds.** V0.1 scope respected.

---

## 7. Frontend ↔ backend wire format

**Test**: how many times is the same shape declared on both sides?

- `Module`/`ModuleEdge`: declared in `src/ui/api.ts` AND in `src/core/server/api/tree.ts:ModuleRow` (different field types — `keyExports` vs `keyExportsRaw`). **Diverged.**
- `WsMessage` types: declared in `src/ui/view/viewStore.ts` AND emitted from `src/core/view/live.ts`. **Diverged shape descriptions.**
- `Turn`/`FileChange`/`FileNode`: declared in `src/core/view/types.ts`, imported by frontend (`src/ui/view/viewStore.ts:2`). **Shared.** Good.

**Verdict**: ⚠ partial. The View pipeline shares types correctly. The Map pipeline (api.ts vs tree.ts) duplicates. The WS message shapes duplicate.

**Action**:
- Move `ModuleRow` shape into a shared module, used by both `tree.ts` and `api.ts`.
- Move WS message shapes into `core/view/wire.ts` (or a sibling), used by both `live.ts` (writer) and `viewStore.ts` (reader).

Cost: 2 small new files; benefit: drift impossibility.

---

## 8. Storage ↔ rest of system

CLAUDE.md doesn't mention storage explicitly. Looking at usage:

- `Database` instance is created in `bin/vizcoo.ts` and passed everywhere. ✅
- All SQL is inlined at the call site (no ORM, no query builder). ✅
- Schema defined in one file. ✅
- Migration logic centralized in `db.ts`. ✅

**One smell**: SQL strings are scattered across:
- `core/index-project.ts:63` (INSERT files).
- `core/index-project.ts:78-79` (DELETE edges + files).
- `core/graph/edges.ts:31-34` (DELETE/INSERT edges).
- `core/graph/aggregate.ts:10-19` (SELECT module edges).
- `core/modules/{tree,persist-aggregation,static-fallback,split,list-for-aggregation,meta}.ts` (each has its own SQL).
- `core/server/api/tree.ts:15-26` (SELECT modules).

That's ~13 separate SQL hotspots. Each is appropriate to its file's job. **No service/repository layer** — by design. CLAUDE.md endorses this.

**Risk**: when the schema evolves (e.g., add `files.size` column), 4-5 INSERT/SELECT statements need updating. Currently we'd find them by grep. Acceptable for V0.1.

---

## 9. Layering: who orchestrates whom?

The implicit layering, top to bottom:

```
┌─────────────────────┐
│ bin/vizcoo.ts       │  CLI entry — composes everything.
├─────────────────────┤
│ core/server/        │  HTTP route registration.
│ ├── http.ts         │
│ └── api/*           │  Each endpoint = thin SQL or thin call.
├─────────────────────┤
│ core/index-project  │  Top-level "do an index pass".
│ core/project/watch  │  Live "do a delta".
├─────────────────────┤
│ core/modules/*      │  Discovery / aggregation / split.
│ core/graph/*        │  Edge construction.
│ core/view/*         │  Conversation pipeline.
│ core/hooks/*        │  Hook installer.
│ core/ai/*           │  LLM provider.
├─────────────────────┤
│ core/storage/db.ts  │  SQLite wrapper.
│ core/plugin-api/*   │  Pure type contracts.
├─────────────────────┤
│ analyzers/*/        │  Pluggable language analysis.
└─────────────────────┘
```

**Test**: do any imports cross layers in the *wrong* direction?

- `core/storage` imports? Only `node:fs`, `node:path`, `better-sqlite3`. ✅
- `core/plugin-api` imports? Each other. ✅
- `core/graph` imports? `node:fs`, `node:path`, `better-sqlite3`, `core/plugin-api`. ✅
- `core/ai` imports? `node:child_process`, `core/ai/provider`. ✅
- `core/hooks` imports? `node:fs`, `node:path`, `node:os`. ✅ (no other core imports — installer is pure file manipulation)
- `core/modules` imports? `core/ai`, `core/plugin-api`, `core/graph`/'tree', other `core/modules`. ✅
- `core/view` imports? Each other, `node:fs`. ✅
- `core/project` imports? `core/index-project`, `core/plugin-api`. ✅ — but **note**: `watch.ts` imports `processFile`/`deleteFile` from one level UP (`core/index-project.ts`). The watch is in `core/project/`, the processor is at `core/`. This is an upward dependency.
- `core/index-project` imports? `core/storage`, `core/plugin-api`, `core/ai`, `core/project/scan`, `core/graph/edges`, `core/modules/classify`, `core/modules/aggregate-and-apply`. ✅ orchestrator.
- `core/server` imports? Everywhere — endpoints reach into the right module. ✅
- `bin` imports? Same as server, plus CLI deps. ✅

**Verdict**: ✅ layers respected. The one quirk — `core/project/watch.ts` reaching up to `core/index-project.ts` — is conceptually fine: watch is *part of* the indexer and reuses its delta processor.

---

## 10. UI route boundaries

The two routes (`view`, `map`) live in:

- `view`: `src/ui/view/` + `Sidebar.tsx` + `ConversationList.tsx`.
- `map`: `src/ui/MapView.tsx` + `src/ui/arch/`.

**Shared**:
- `App.tsx` (composition root).
- `Sidebar.tsx` (lists conversations from view-store, regardless of route).
- `SettingsModal.tsx`.
- `api.ts` (Map's API helpers — only used by Map).
- `main.tsx`, `index.html`, `style.css`.

**Test**: does Map import from view?

- `MapView.tsx` imports: arch internals, `api.js`. **Zero view/ imports.** ✅
- `ArchScene.tsx` and arch siblings: zero view/ imports. ✅

**Test**: does View import from arch?

- `ViewScene.tsx` and view/ siblings: zero arch/ imports. ✅

**Cross-imports between routes**: only via `App.tsx` (composition) and `Sidebar.tsx` (which uses `view/viewStore.ts` for conversation listing — view-only, but the sidebar shows up on both routes including Map). That's a deliberate cross — the Sidebar shows live status for both routes.

**Verdict**: ✅ clean route isolation. Even shared shell components don't reach into each route.

---

## Cross-cutting boundary findings

| Boundary | Status | Top issue |
|---|---|---|
| Plugin discipline (core ↔ analyzer) | ✅ holds | rename `ApiCall.kind` enum |
| File-level edges only | ✅ holds | dead `'api-call'` rows |
| `http.ts` ≤ 150 lines | ❌ 164 | extract static-file serving |
| `api/*.ts` one endpoint per file | ⚠ 3 violations | document or split |
| No Express/Koa | ✅ | — |
| Single viz library | ❌ broken from day 1 | drop @xyflow/react or commit |
| Read-only V0.1 | ✅ | — |
| Wire-format DRY | ⚠ partial | share Map types, share WS types |
| Layering | ✅ | watch.ts reaches up — by design |
| Route isolation | ✅ | — |

**Two real boundary issues**: `http.ts` size, and the React-Flow lie. Everything else is intact.
