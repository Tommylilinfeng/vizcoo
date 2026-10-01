# Architecture

Two pipelines share the same atomic operations: a one-shot **index** at startup and a
long-running **live** loop driven by filesystem events.

```
  npx vizcoo <path>
         │
         ▼
  ┌──────────────────┐
  │  bin/vizcoo.ts   │  arg parsing, init, start server + watcher
  └────────┬─────────┘
           │
    ┌──────┴────────────────────────────────┐
    ▼                                       ▼
  INDEX (one-shot)                       LIVE (long-running)
    │                                       │
    ├─ 1. scan              (fs walk)      ├─ chokidar watch
    ├─ 2. extract imports  ┐                │     ↓ onChange(file)
    ├─ 2. extract api      │ per file      ├─ processFile() — same atoms
    ├─ 3. resolve imports  │                │     ↓
    ├─ 4. edges → SQLite   ┘                └─ ws.broadcast({type: 'update'})
    ├─ 5. classify                                ↓
    └─ 6. modules → SQLite                   UI refetch /api/tree + /api/graph
```

## Layers

### Entry — `bin/vizcoo.ts`

- Parses the single positional arg (project path).
- Opens the SQLite database at `<project>/.vizcoo/graph.db`.
- Runs `indexProject` once.
- Starts the HTTP server on `VIZCOO_PORT` (default `3721`).
- Attaches the WebSocket broadcaster to the HTTP server.
- Starts the file watcher.
- Opens the browser.
- Handles `SIGINT` — closes watcher, WS, server, DB.

### 1. scan — `src/core/project/scan.ts`

- Input: project root + list of registered `LanguageAnalyzer`s.
- Walks the directory tree, filtering against `DEFAULT_IGNORES` (`node_modules`, `.git`,
  `dist`, `build`, `.ctx`, `.vizcoo`, `coverage`, `.next`, `.turbo`) plus the project
  root's `.gitignore`.
- A file is included only if at least one registered analyzer's `canHandle(path)` returns true.
- Returns relative POSIX paths.

### 2. extract — `src/analyzers/typescript/`

- `parser.ts` lazy-loads three tree-sitter WASM grammars (TS, TSX, JS) on first use.
  Subsequent calls are synchronous.
- `withTree(source, filePath, fn)` is the resource-management helper: parses, runs the
  visitor, and deletes the tree in a `finally` block. Each extraction call parses the
  file once.
- Three independent extractors:
  - `extractImports(source, path)` — top-level `import` statements; handles default,
    named, namespace, and type-only imports.
  - `extractSymbols(source, path)` — top-level functions, classes, variables, types,
    interfaces; marks `exported` when wrapped by `export_statement`.
  - `extractApiCalls(source, path)` — detects `fetch('...')`, `axios.get('...')`,
    etc., plus static template literals.

### 3. resolve — `src/core/graph/resolve.ts`

- Input: `specifier + importingFile + projectRoot`.
- Skips bare specifiers (npm packages) by returning `null`.
- For relative specifiers, tries candidate suffixes: `.ts .tsx .js .jsx .mjs .cjs`
  followed by `index.*` variants, then the raw path.
- Returns the resolved relative path (POSIX) or `null`.
- Does **not** read `tsconfig.json` `paths`, `package.json` `exports`, or barrel
  re-exports.

### 4. edges — `src/core/graph/edges.ts`

- `edgesFromImports`: skips `isTypeOnly` imports; resolves each to a target file;
  emits `{sourceFile, targetFile, kind: 'import'}`.
- `edgesFromApiCalls`: keeps only URL patterns starting with `/`; emits
  `{sourceFile, targetFile: urlPattern, kind: 'api-call'}` — note the target is a
  URL string, not a file path.
- `replaceEdgesForFile` runs `DELETE FROM edges WHERE source_file = ?` followed by
  `INSERT OR IGNORE` for each new edge, inside a single transaction. This is the
  per-file atomic rewrite that keeps re-indexing idempotent.

### 5. classify — `src/core/modules/classify.ts` + `src/analyzers/typescript/frameworks/`

- Runs every registered `FrameworkDetector`, picks the highest-confidence non-null
  result.
- Three TS detectors:
  - `monorepo` (0.95) — triggers on `workspaces`, `pnpm-workspace.yaml`, or `turbo.json`.
    Each package directory under `packages/*` or `apps/*` becomes a module.
  - `nextjs` (0.9) — triggers on `next` in any dependency field. Buckets: `Pages`,
    `API Routes`, `Components`, `Lib`, `Config`.
  - `express-like` (0.7) — triggers on `express` / `fastify` / `hono` / `koa` /
    `@nestjs/core`. Buckets: `Routes`, `Services`, `Models`, `Middleware`, `Other`.
- No detector matches → folder fallback: top-level folders under `src/` become
  modules; files outside `src/` fall into a `Root` module.

### 6. modules — `src/core/modules/tree.ts`

- `replaceHeuristic` clears all `origin='heuristic'` modules and their file
  assignments, then inserts the new set.
- `origin='ai-split'` modules are untouched by classify; they only appear via the
  split endpoint.
- `modules.parent_id` exists in the schema but is always `NULL` in V0.1.

### 7. server — `src/core/server/`

- `http.ts` is `node:http` with a ~100-line hand-rolled router (budget is 150).
- Endpoints:
  - `GET /api/tree` — `{ modules: [{id, name, parentId, origin, fileCount}] }`
  - `GET /api/graph` — `{ edges: [{sourceId, targetId, count}] }` where edges are
    aggregated from the file-level edge table.
  - `POST /api/split` — body `{moduleId}`; calls `splitModule`.
  - All other `GET` → serves `dist/ui/` (SPA fallback to `index.html`).
- `ws.ts` attaches a `WebSocketServer` on the same HTTP server at path `/ws`.
  The only message format is `{type: 'update'}`.

### 8. split — `src/core/modules/split.ts`

- Gathers each file's relative path, exported symbol names, and external import
  specifiers — **not** the source code.
- Sends a prompt to the configured `AIProvider` asking for 2–5 sub-modules in JSON.
- Parses the response (tolerant to `json`-fenced blocks and leading/trailing prose).
- Validates: every original file appears in exactly one sub-module; no unknown
  files; no duplicate file assignments.
- In a single transaction: deletes the parent module (cascading files to
  `module_id = NULL`), inserts new modules with `origin='ai-split'`, and reassigns
  files.
- Triggers `onAfterSplit` which broadcasts a WebSocket update.

### 9. live — `src/core/project/watch.ts`

- `chokidar.watch(root)` with the same `IGNORED` regex as scan (kept in sync by
  hand).
- Events: `add`, `change` → `processFile`; `unlink` → `deleteFile`.
- Every handled event calls `handlers.onChange()`, which broadcasts a WS update.
- `deleteFile` removes the file row and all outbound edges in a transaction.

## Data model

```
┌──────────────┐      ┌──────────────────────┐     ┌──────────────┐
│   modules    │◄─────│ files.module_id      │     │    edges     │
│   (id, name, │      │ (path, content_hash) │◄──┐ │ (source_file,│
│   origin,    │      └──────────────────────┘   │ │  target_file,│
│   parent_id) │                                 └─│  kind)       │
└──────────────┘                                   └──────────────┘
        │                                                  │
        │ user layer                                       │ atomic layer
        │ (heuristic + ai-split)                           │ (import + api-call)
        │                                                  │
        └──────────────── aggregated on read ──────────────┘
                         (no materialized module_edges table)
```

The atomic layer is the truth. The user layer is the grouping on top. Module-level
edges are always derived on read by joining `edges` → `files.module_id` twice. A
re-classification or AI split never requires recomputing edges.

## Plugin boundary

- `src/core/` never imports from `src/analyzers/`.
- Analyzers are passed as an array into `indexProject`, `processFile`, `watchProject`,
  and the server config. Dispatch happens via `canHandle(path)` returning the first
  match.
- Framework detectors are a property of the `LanguageAnalyzer` object — a TS plugin
  ships TS-relevant detectors (Next.js, Express, monorepo); a future Python plugin
  would ship its own (Django, FastAPI, etc.).

## Frontend

- React + `@xyflow/react` + Tailwind + Dagre, bundled by Vite into `dist/ui/`.
- `src/ui/App.tsx` fetches `/api/tree` and `/api/graph` on mount and on every
  `{type:'update'}` WebSocket message.
- `src/ui/layout.ts` runs Dagre (`rankdir: LR`) to produce `{id: {x, y}}`.
- `src/ui/ModuleNode.tsx` is the custom React Flow node — a card with name,
  origin badge, file count, fan-in / fan-out.
- Edge styling: stroke width scales with `log(count + 1)`; opacity scales with
  count relative to max; arrow markers indicate direction.
- Detail panel on node click lists inbound and outbound modules.
