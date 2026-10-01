# Architecture audit — Extensibility

The codebase is at V0.1; the user said *"未来要要继续做"*. This pass asks: where will the next 6 months of features land, and is the current shape ready?

The known extension axes (from CLAUDE.md, doc/, and inferred from memory):
1. **Multi-language analyzers** — Python, Go, Rust, etc.
2. **AI provider** — beyond Claude CLI; Anthropic SDK direct, OpenAI, etc.
3. **View pipeline evolution** — token-level streaming via proxy (memory mentions ANTHROPIC_BASE_URL); more turn-detail viz; multi-conversation overlays.
4. **Module operations** — beyond `split`, eventually `merge`, `rename`, `move-files`.
5. **Module re-aggregation cadence** — currently cold-start only; live re-aggregation on structural shift.
6. **Output targets** — currently localhost dashboard; future maybe export, embed, share.

Each axis is evaluated for: how easy to add, what would block, what to fix now to unblock.

---

## 1. Multi-language analyzers

**Adding a `pythonAnalyzer`** would need:

- A new `src/analyzers/python/index.ts` exporting a `LanguageAnalyzer`.
- A way to parse Python — `tree-sitter` already has a Python grammar; the existing `parser.ts` pattern (load WASM, expose `withTree`) is a clean template.
- Import resolution — Python's resolution differs (no `import './foo'` — uses absolute or relative-via-package). The existing `core/graph/resolve.ts` is TS-specific. **Either**:
  - Move resolution into the analyzer interface (`analyzer.resolveImport(specifier, importingFile, root)`). This is the cleaner approach: each language knows its own resolution rules.
  - Add a parallel Python resolver in `core/graph/`.
- Framework detection — Python doesn't really have "framework detectors" the same way; might be Django/Flask/FastAPI. Add to `analyzers/python/frameworks/`.
- Wiring — `bin/vizcoo.ts:39` becomes `[typescriptAnalyzer, pythonAnalyzer]`.

**Blockers right now**:

1. **`core/graph/resolve.ts` is TS-specific but lives in `core/`.** When adding Python, you'd either:
   - Add `resolveImportPython` next to it (two functions for one concern).
   - Move resolve into the analyzer (cleaner — one function lives where the language lives).
   
   **Recommendation**: refactor `LanguageAnalyzer` to add `resolveImport(spec, fromFile, root): string | null`. Move `resolve.ts` content into the TS analyzer. Then `edges.ts:edgesFromImports` calls `analyzer.resolveImport` instead of the imported helper.
   
   **Effort**: ~1 hour. Removes the TS assumption from core.

2. **`ApiCall.kind` enum is TS-stack-specific** (already noted). Rename to language-agnostic.

3. **`discover-heuristic.ts:EXPORT_REGEX`** is TS/JS regex. For Python, exports work very differently (`__all__`, no syntactic export keyword). **Currently this regex would silently produce `[]` keyExports for Python files** (no match) — which is "graceful" but useless. **Fix**: move `extractExportNames` into the analyzer (as suggested in core-modules audit). Each analyzer knows what "key exports" mean for its language.

4. **`scan.ts:DEFAULT_IGNORES`** doesn't know Python's `__pycache__`, `venv`, `.tox`, etc. Currently relies on `.gitignore`, which Python projects usually have. Acceptable.

5. **`storage/schema.sql`** is language-agnostic — `files.path`, `edges.source_file`. ✅ no change needed.

**Verdict**: extensibility is **mostly there but not quite**. Three changes (resolveImport in analyzer, kind enum, extractExportNames in analyzer) make a Python analyzer a clean drop-in. Without those, you'd duplicate logic in core for each new language.

**Severity**: MAJOR. Without these fixes, language #2 forces ugly compromise.

---

## 2. AI provider

**Adding `anthropicSdkProvider`** (the Anthropic SDK directly instead of `claude` CLI):

- Implement `provider.ts:AIProvider` shape: `{ id, complete(prompt, options): Promise<string> }`.
- Wire in `bin/vizcoo.ts` — currently hardcodes `claudeCliProvider`. Either:
  - Env-driven: `process.env.VIZCOO_AI_PROVIDER === 'sdk'` switches.
  - Config file: `~/.vizcoo/config.json`.
  - Auto-detect: try SDK if `ANTHROPIC_API_KEY` set, else fallback to CLI.
- `CompleteOptions.maxTokens` and `temperature` would actually be used — currently those fields exist but `claudeCliProvider` ignores them. **Implement when adding the SDK.**

**Blockers**:

- None major. The interface is small, the wiring is one line in `bin/`.

**Concerns**:

- **No retry / timeout / rate-limit logic** in either the interface or the provider. `claudeCliProvider` has no timeout — if `claude -p` hangs, vizcoo hangs. For V0.1 with local CLI this is OK; for SDK calls (network-bound), needs `AbortSignal` support. **Add `AbortSignal` to `CompleteOptions` when introducing SDK provider.**
- **No streaming.** `complete()` returns a `Promise<string>` after the LLM finishes. Memory mentions token-level streaming via proxy as a goal — that's a separate "Pulse" feature, not the aggregation/split flow. The aggregation/split prompts produce JSON; streaming JSON is awkward; staying with batch makes sense for these flows.
- **One global provider** in `bin/vizcoo.ts`. If you ever want different providers for different tasks (e.g., a fast model for split, a smart model for aggregation), the current single-provider shape doesn't support it. **Defer.**

**Verdict**: ✅ ready. Adding a second provider is a 30-line file + 1 line of wiring. The AbortSignal addition is the only forward-looking improvement.

---

## 3. View pipeline evolution

The View is the youngest part of the codebase (per memory: redesigned 2026-04-24). Future angles:

### Token-level streaming via proxy (memory: "Pulse" feature)

- The plan is `ANTHROPIC_BASE_URL → vizcoo proxy → real Anthropic`. Tee SSE stream.
- **Where would the proxy live in this codebase?** Two options:
  - New top-level `src/proxy/` module that runs alongside the http server.
  - Same `src/core/server/` with a new `/proxy/...` route, intercepting and replaying.
- The captured token deltas would broadcast over the existing WS channel. ✅ no schema change.
- The View store (`viewStore.ts`) would need a new message type (`live-token-delta`).

**Blockers**:
- No proxy infrastructure exists; this is a net-new module.
- The current `live.ts` already broadcasts `live-pending` and `live-done` events tied to file edits. Adding token deltas is parallel; no rewrites needed.
- **Wire format isolation** (already noted): WS message shapes are duplicated between `live.ts` and `viewStore.ts`. **If you fix that now, adding a new message type is 1 line in 1 file.**

### Multi-conversation overlays

- "Show all alive conversations on one timeline." Current `viewStore` tracks one selected conversation. Extending requires either:
  - A `selectedIds: string[]` instead of `selectedId: string | null`.
  - A new "all conversations" view-mode.
- **Blockers**: zustand state shape is small enough to refactor in an hour. The Three.js scene already animates per-file plates; no fundamental restriction.

### Per-file disk diff over the JSONL replay

- Already implemented for live mode (`live.ts:readDiskContext`). Replay mode currently just shows the recorded `oldString`/`newString` without disk reconciliation.
- **Blockers**: none. `turns.ts:changeFromToolUse` produces `oldString`/`newString`; a future enhancement re-runs disk-context resolution on the replay path.

**Verdict**: ✅ extensible. The biggest win for future View work is **deduplicating WS shapes** (action item from boundaries audit).

---

## 4. Module operations beyond split

CLAUDE.md says: *"Scope boundary: read-only visualization. All writes (module rename, file reassignment) are deferred past V0.1. AI-driven module splitting is the only user-controlled mutation."*

Future operations:

- **Rename**: change `modules.display_name`. Minimal impact — already a column.
- **Re-describe**: change `modules.description`. Same.
- **Manual file reassignment**: change `files.module_id`. Single UPDATE.
- **Merge two modules**: pull files from B into A, delete B.
- **Reset to heuristic**: re-run `classifyProject` (already idempotent).

**Blockers**:

- The `aggregate-and-apply` cache fingerprint hashes module *names* (`meta.ts:6`). After a manual rename, the fingerprint changes, but the cached aggregation is stale (different names). **Cache invalidation works but produces a stale-replay then re-aggregate cycle.** Acceptable.

- The schema has no audit trail. After a user manually reassigns 50 files and the indexer re-runs, the watcher doesn't know which assignments were manual — it would call `replaceHeuristic` and overwrite. **Either**:
  - Add `files.assignment_origin` (`'heuristic' | 'manual'`).
  - Don't re-run `classifyProject` on incremental changes — only on cold start. Currently this is the case (`watch.ts` calls `processFile`, not `classifyProject`). **Already works.** ✅
  - Document: "manual edits survive incremental updates; cold restart re-runs heuristic and wipes them" — a UX choice the user can opt into via a "preserve manual" flag.

**Verdict**: ⚠ extensible **with one schema decision**. Adding `files.assignment_origin` is the simplest unlock for V0.2. Pre-emptive: do it now while the schema is small.

---

## 5. Re-aggregation cadence

Currently:
- Cold-start: full classify + aggregate.
- Watch: per-file edge update only. **No re-classify, no re-aggregate.**

Memory says CLAUDE.md "Calling an LLM on cold start" means heuristic-only on cold start; LLM only on user-requested split. But `aggregateAndApply` IS called on cold start by `bin/vizcoo.ts:41` — it does call the LLM. **Reading CLAUDE.md again**: *"Calling an LLM on cold start. Cold start is heuristic only; LLM is invoked only when the user asks to split a module."*

**This is a real conflict.** Cold-start LLM aggregation is happening despite the rule. Two interpretations:

1. The rule was *aspirational* and `aggregate-and-apply` represents a deliberate change.
2. The rule is *current intent* and the implementation drifted.

**The cache** (`meta.ts:fingerprint`) means cold start usually hits cache (no LLM call). First-run on a project still calls LLM — once. Subsequent cold starts within the same heuristic shape: cached, no LLM call.

**Fixed?** Mostly. **But**: a brand-new project (no cache) on cold start *does* call the LLM. CLAUDE.md says no.

**Decision needed**:
- Update CLAUDE.md to reflect "first-time aggregation runs LLM; subsequent restarts use cache; user can re-run via `/api/aggregate`."
- OR change cold start to skip LLM and always use static fallback initially, with the user clicking a button to invoke LLM aggregation.

I lean *update CLAUDE.md*. The cached behavior is exactly what users want, and the static fallback's mega-module names are clearly worse than the LLM's. But it's a documentation-vs-code mismatch that should be resolved.

---

## 6. Output targets

V0.1: localhost dashboard. Future:

- **Export to static HTML**: dump current state as a self-contained HTML file. Current `dist/ui/` is the static build; bundling current data into it is a small endpoint + a build step.
- **Share via URL**: requires hosting (out of V0.1 scope).
- **Embed in Claude Code itself**: would require an in-CC API, a different problem.

**Blockers for export**: none meaningful. The current `treeEndpoint` and `graphEndpoint` JSON outputs are sufficient state to reconstruct the visualization.

**Verdict**: ✅ ready when needed.

---

## Cross-cutting extensibility findings

### What blocks growth

1. **Language-specific code in core** (`graph/resolve.ts`, `discover-heuristic.ts:EXPORT_REGEX`, `ApiCall.kind`). Three places where TS assumptions are baked into core. Each new language exposes them.

2. **No way to swap AI providers without a code change**. Single source of `claudeCliProvider` in `bin/`. Adding env-or-config switching is a 10-line fix.

3. **CLAUDE.md vs reality**: cold-start LLM aggregation, single viz library claim. Fix the doc.

4. **Wire-format duplication** between server and ui (Map types, WS types). Each future feature that adds a message duplicates again.

5. **Schema audit-trail**: no `files.assignment_origin`. Pre-emptive add for V0.2 manual operations.

### What's well-prepared

1. **Plugin discipline**: clean. Adding analyzer #2 doesn't touch core (after the 3 fixes above).
2. **AI provider interface**: small, swap-friendly.
3. **Storage layer**: thin, easy to extend.
4. **Server layer**: single `http.ts` route registration; new endpoints land cleanly.
5. **Edge model**: file-level + on-the-fly aggregation. Module operations don't touch edges.

### Priority order for "extensibility-debt" cleanup

1. **Move `resolveImport` into `LanguageAnalyzer` interface.** Removes TS assumption from core.
2. **Move `extractExportNames` into the analyzer.** Replaces regex with proper symbol extraction.
3. **Rename `ApiCall.kind` enum.** Drops TS-stack vocabulary from core.
4. **Add `files.assignment_origin` column.** Pre-empts V0.2 schema change.
5. **Share wire formats** (Map types + WS types in shared files). Pre-empts duplication for future endpoints/messages.
6. **Add `AbortSignal` to `CompleteOptions`.** When SDK provider lands, no breaking change.
7. **Make AI provider selectable via env.** Drop-in for SDK.

Items 1-3 are tightly related (they're all "make `core` not assume TS"). They're best done as one PR.

Items 4-7 are independent, can land any time.

**None of these are urgent for V0.1.** All are "do them before V0.2 starts" items.
