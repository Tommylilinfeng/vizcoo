# File-by-file audit: `src/core/graph/`

Three files: `edges.ts` (build & persist file→file edges), `resolve.ts` (specifier → relative path), `aggregate.ts` (file edges → module edges via SQL).

---

## `edges.ts` (40 lines)

- **Job**: convert per-file `Import[]` and `ApiCall[]` into `Edge[]`; replace all edges for one file in one transaction.
- **Issues**:
  - **minor**: `edgesFromApiCalls` filter `if (!call.urlPattern.startsWith('/'))` (line 24) silently drops absolute-URL fetches (`https://api.example.com`). That's correct for an *internal* architecture map — external endpoints aren't nodes — but the silent drop is invisible to the analyzer author. A 1-line note in the function header would help.
  - **minor**: API-call edges use `urlPattern` as the **target file path** (line 25). That's a category error: the target isn't a file, it's a route. It happens to coexist in `edges.target_file` because the schema is permissive. Two consequences:
    1. The downstream `moduleEdges` SQL joins `edges.target_file = files.path` — API-call edges never match, so they're invisible to the module aggregator. (Confirmed by `aggregate.ts:14`: `WHERE e.kind = 'import'`.) So API-call edges are inserted into the DB and then never read for module-level aggregation. Why are they written at all?
    2. If a future feature wants "files that hit `/api/users`", it has to go through `edges.target_file = '/api/users' AND kind = 'api-call'` — which works, but the *name* `target_file` lies.
  - **major architectural**: API-call edges are stored but unused. Either:
    - Delete them (return `[]` from `edgesFromApiCalls`).
    - Use them — e.g., link `Pages` files to `API Routes` files when the URL matches a route definition.
    - Rename schema column to `target_node` and add `target_kind`, then route both file-imports and api-calls through one table cleanly.
  - **nit**: `replaceEdgesForFile` uses `INSERT OR IGNORE` — if a file imports the same target twice (rare but legal: `import { a } from './x'; import type { B } from './x'`), only one row inserts. Correct, but the dedup is implicit. PRIMARY KEY in the schema makes this work.
- **Verdict**: works for imports; api-calls are dead weight. Pick a story.

## `resolve.ts` (43 lines)

- **Job**: resolve a relative TS specifier to an actual file path.
- **Issues**:
  - **major**: ignores TypeScript path mapping (`tsconfig.json` `paths`). A monorepo or aliased project (e.g., `import { Foo } from '@/lib/foo'`) will silently produce no edge. Many projects use this. **Document this limitation in CLAUDE.md or the analyzer docs.** Or implement, which is a half-day's work.
  - **major**: ignores `node_modules` resolution entirely (line 22: `if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null`). For an *internal architecture map* this is correct; we don't want noise from `react`. But the contract is undocumented.
  - **minor**: `CANDIDATES` (line 4-18) is 13 entries hand-written. Could be `EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']` and two loops (direct + `index.<ext>`), saving 6 lines. Aesthetic.
  - **minor**: `stripTsExt` (line 34) is an asymmetric helper — strips known extensions before re-applying them via `CANDIDATES`. So `import './foo.ts'` becomes `'foo'` then tried as `'foo.ts'`. Works, but the "strip then re-add" cycle is a bit roundabout. An explicit "if specifier already has an ext, return that file directly" branch would be clearer.
  - **nit**: last candidate is `(b) => b` (the bare path). That's the case where the specifier already ends in a known extension. Fine.
- **Verdict**: works for vanilla TS. **The two `major` items (path mapping + node_modules awareness) are documented limits, not bugs.** They need to be in `doc/architecture.md` so a user knows why some imports show as missing.

## `aggregate.ts` (22 lines)

- **Job**: SQL roll-up — count file-edges between modules; emit `(sourceId, targetId, count)`.
- **Issues**:
  - **none** at the file level. Five-line query, one purpose, fast. Exemplary.
- **One architectural point** (file-vs-module edge boundary): CLAUDE.md says *"File-level edges only. Edges between files are persisted. Edges between modules are always computed on the fly by aggregation."* This file is the *only* enforcement of that rule. Worth flagging in the architecture audit (boundaries.md).
- **Verdict**: clean.

---

## Cross-cutting

- `Edge.kind` enum is `'import' | 'api-call'`. `aggregate.ts` filters to `'import'` only. The `'api-call'` edges are write-only data — see `edges.ts` major issue.
- The graph layer is the cleanest layer in core. The `module-edges-on-the-fly` rule is enforced exactly once, here, in 22 lines of SQL. That's correct architectural discipline.
