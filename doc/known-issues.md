# Known Issues

What's wrong, incomplete, or silently dropped. Grouped by layer, roughly ordered by
how much they affect real-world accuracy. High-impact items are marked **[H]**.

## scan

- **Subdirectory `.gitignore` is ignored.** Only the project root's `.gitignore` is
  read. Monorepos where packages have their own `.gitignore` will leak files.
- **No way to exclude `fixtures/` / `examples/` by convention.** vizcoo ingesting a
  project's own test fixtures bloats the module graph with isolated islands. Needs
  either a convention list in `DEFAULT_IGNORES` or a `--ignore` CLI flag.
- **Symlink loops not guarded.** `readdirSync` with a self-referential symlink would
  recurse forever.

## extract

- **Each file parses three times** — once per extractor (imports, symbols, api-calls).
  tree-sitter is fast enough that this is not yet a bottleneck but will be noticeable
  on large projects. Fix: fold into a single `extractAll(source, path)` method on
  `LanguageAnalyzer`, or cache the parsed tree per file per pipeline tick.
- **No CommonJS `require()` support.** ESM only. CJS `require` calls become bare
  identifiers in the call tree, silently dropped. Out of scope for V0.1 but worth
  noting.
- **No dynamic `import()` support.** Lazy-loaded chunks are invisible to the graph.
- **Template literals with interpolation degrade.** `fetch(\`/api/users/${id}\`)` is
  recorded as `/api/users/${...}` — a placeholder string, not a resolvable path.

## resolve **[H]**

- **No `tsconfig.json` `paths` support.** Almost every modern TS project uses `@/...`
  style aliases. Those imports resolve to `null` and **silently disappear from the
  graph**. This is the single biggest accuracy gap on real-world projects.
- **No `package.json` `exports` support.** Monorepo packages that expose subpath
  entry points (`import x from 'pkg/sub'`) resolve to `null`.
- **No barrel re-export following.** `export * from './a'` + `import { foo } from './index'`
  means `foo` resolves to `index.ts`, not `a.ts`. Same limitation inherited from
  context-chain (documented as scope limit).

## edges

- **`api-call` edges are stored but never displayed.** `moduleEdges` in
  `graph/aggregate.ts` joins against `files` on both ends, and api-call targets are
  URL patterns, not file paths — so they fall out of the inner join. Either render
  api-call edges in the UI (dashed lines labeled with the pattern), or stop storing
  them.
- **Cross-project imports are visible as misleading targets.** If `resolve` ever
  returned a path outside the project root, that file would never match a row in
  `files` and the edge would orphan. Currently resolve can't produce such paths, but
  the table has no FK to enforce it.
- **No self-loops reported.** An aggregate edge where source and target are the same
  module is filtered out by `WHERE sf.module_id != tf.module_id`. That's a UI
  choice, not stored data — worth revisiting if "intra-module density" becomes a
  signal.

## classify

- **Every cold start wipes `heuristic` modules.** `replaceHeuristic` is called on
  every `indexProject` run, regardless of whether the file set changed. In V1 when
  users can rename modules manually, this is the cliff we fall off.
- **Detectors don't look at code.** Only `package.json` + file paths. A React app
  that doesn't declare `next` but uses the `app/` convention won't be detected as
  Next.js.
- **Express detector is regex-based and lossy.** `/services?\//` matches
  `services/` and `service/` but also any file whose path contains the substring
  elsewhere. Accept: V0.1, fix with more specific anchors later.
- **Monorepo detector only scans `packages/` and `apps/`.** Other conventions (`libs/`,
  workspace entries in arbitrary paths) aren't covered.

## modules

- **Hierarchy is schema-only.** `parent_id` exists but is always `NULL`. V1's
  drill-down view needs either (a) every split keeps `parent_id` pointing at the
  original module, and the UI walks it, or (b) a separate "history" table. Not
  decided.
- **No module rename / drag / merge / delete in V0.1.** Deferred by design, but the
  product feels incomplete without it once users try real projects.

## split (AI)

- **No sub-module name deduplication.** If the LLM returns two sub-modules both
  named "Helpers", they both insert and co-exist. Not a correctness bug (ids are
  distinct) but a UX bug.
- **No undo.** Splitting is destructive — the parent module row is deleted. To undo
  the user would have to reload and wait for the next classify pass.
- **Prompt has no project-level context.** The LLM sees only file summaries, not
  the project's broader purpose or sibling modules' names. This produces decent
  groupings but sometimes generic names.
- **Single-provider.** Only Claude Code CLI. Anthropic direct / OpenAI / local — the
  `AIProvider` interface supports them but they're not implemented.
- **Split blocks the endpoint.** `POST /api/split` holds the HTTP connection open
  for the full LLM round-trip (3–15 seconds). No progress indication beyond the
  button's disabled state.

## live / watch

- **New files are silently invisible.** A newly added file is written to `files`
  with `module_id = NULL`. The aggregate view's INNER JOIN filters it out. User
  adds a file, sees nothing change, wonders if vizcoo is broken.
- **No debounce.** Saving a file 10 times in 2 seconds triggers 10 `processFile`
  runs and 10 WS broadcasts. The UI re-fetches and re-runs Dagre on each, causing
  visible node jitter.
- **Dagre re-runs on every update.** Even when only a single edge changed, the
  layout recomputes from scratch, and nodes can jump far from their prior positions.
- **WebSocket has no reconnect.** If the server restarts while the UI is open, the
  socket stays closed and live updates are lost until the user refreshes.
- **IGNORED regex in watch is hand-duplicated from scan's `DEFAULT_IGNORES`.** Any
  change to the ignore list has to be made in two places.

## server

- **No CORS, no rate limiting, no auth.** Intentional for localhost-only dev tool.
  If vizcoo ever runs behind a proxy or on a shared machine, this is all wide open.
- **SPA fallback is `index.html`.** Good enough for a React SPA; would mask legitimate
  404s in the `/assets/` path. Minor.
- **POST body limit is unbounded.** Not a practical issue today since only `split`
  takes a body and that body is tiny, but worth nailing down.

## direct manipulation

- **No "group under new parent" gesture or button.** Current drag matrix covers
  reparent (drag onto board), merge (shift+drag onto sibling), move-tier (drag
  onto tier band), and orphan (drag onto blank). The case of "take two top-level
  modules A and B, group them under a *new* top-level parent C" has no path —
  you can only reparent A into B (which loses A's identity) or merge them
  (which destroys one). Two candidate fixes: (a) `Group with…` button in
  DetailPanel that opens a sibling picker + name prompt, (b) modifier drag
  (alt/option+A onto B) creating a new parent containing both. Backend can
  compose from existing endpoints (`createModule` + `patchModule × N`) or get a
  new atomic `POST /api/modules/group`. Decision deferred — first surfaced
  2026-04-26.

## UI

- **Dagre layout on small graphs looks sparse** (3–5 nodes in a line). Real projects
  with 15+ modules look much better. A small-graph special case (force-directed or
  circular) might help demos.
- **Inter font is loaded from `rsms.me` CDN.** No offline mode.
- **Error toast disappears with no way to reopen.** If the split endpoint fails
  mid-flow and the user clicks away, the message is gone.
- **Tier-less top-level modules are invisible on the Map.** When `split` produces a
  module with `tier_id = NULL` (or any pre-existing orphan top-level), the
  force-directed layout filters it out because tier determines Z. The module
  exists in the DB and `/api/tree`, but the user can't see it to drag-assign a
  tier. Workaround: query `/api/tree` directly to find it, then PATCH its tier.
  Tried two fixes (render at synthetic Z below lowest tier; add gravity to keep
  orphans from flying away) but both broke camera fit because orphans without
  any relation gravitate too far. Needs a real solution: probably either
  (a) inherit tier from parent on split, (b) auto-assign to a default "unsorted"
  tier the user can clean up later, or (c) a second mini-panel listing orphans
  for explicit tier assignment.

## DX / tooling

- **UI and server are built separately.** `npm run build` runs both, but editing a
  UI file during development requires a manual `vite build` — there's no dev-mode
  where Vite's HMR talks to the server's API.
- **No tests beyond `scripts/verify.ts`.** The verify script only covers the
  Next.js fixture happy path. No unit tests for extractors, resolvers, split
  parsing, or edge aggregation.
- **WASM path resolution uses `createRequire`.** Works today; might break under
  bundlers that don't preserve `require.resolve` semantics for WASM assets.

## Three things to fix before showing real users

1. **`tsconfig.json` `paths` support in resolve.** Without this, most real-world
   projects show a dramatically incomplete edge graph.
2. **Debounce + incremental layout on the watcher.** Current flicker under real
   editing (save every few seconds) is physically uncomfortable.
3. **Surface new files somewhere.** Either auto-classify into a visible
   "Unassigned" module, or flag in the UI ("3 new files not yet placed"). Silent
   invisibility is the worst failure mode.
