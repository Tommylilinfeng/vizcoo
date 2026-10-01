# File-by-file audit: `src/core/modules/`

11 files. This is the largest sub-module in `core/`. Job: take the heuristic file-bucketing and either accept it, label it via LLM, or fall back to a static naming. Plus the on-demand `splitModule` flow.

Files: `classify.ts`, `discover-heuristic.ts`, `discover-llm.ts`, `aggregate-and-apply.ts`, `list-for-aggregation.ts`, `llm-prompt.ts`, `meta.ts`, `persist-aggregation.ts`, `split.ts`, `static-fallback.ts`, `tree.ts`.

That's a lot of files for one concern. The module-level audit will revisit organization; this file looks at each.

---

## `classify.ts` (40 lines)

- **Job**: try every framework detector; if none returns a non-zero confidence, fall back to heuristic. Either way, persist the outcome.
- **Issues**:
  - **minor**: `winner` selection picks max confidence. If `monorepo` returns 0.95 and `nextjs` returns 0.9, monorepo wins — but the project might be *both* a monorepo containing a Next.js app. The `frameworks/monorepo.ts` already handles this by bucketing per workspace, so this is fine, but a future detector that's narrower (e.g., "is the *root* of a Next app?") could conflict. Not a current issue.
  - **minor**: heuristic-and-detector are mutually exclusive (line 27-32). When detector wins, `heuristicModules: null` is returned — so `aggregateAndApply` won't run for, say, a Next.js project. That's intentional (LLM aggregation works on heuristic discovery, not on framework buckets), but the `index-project.ts` reader has to know the convention. A field name like `aggregatable: HeuristicModule[] | null` would be clearer.
  - **nit**: `readPackageJson` lives at the bottom (line 36). It returns `unknown` deliberately — the detector reads its own shape. Clean.
- **Verdict**: clean small file. Good.

## `discover-heuristic.ts` (101 lines)

- **Job**: directory-based bucketing with adaptive drill-down.
- **Issues**:
  - **major**: 4 magic numbers:
    - `DRILL_FLOOR = 30` (line 6) — a level-1 dir is "big" if it has > 30 files.
    - `TINY_FLOOR = 4` (line 7) — collapse buckets with < 4 files.
    - `q1 / q3 / 1.5 IQR` (lines 61-63) — Tukey fence for outlier detection.
    - `topExports limit = 8` (line 40).
    Each is reasonable. None has provenance. If we want to tune the heuristic per project size (a 3000-file project may want different floors), we'd need to find every magic number. **Recommendation**: collect them in a `const HEURISTIC_PARAMS = { ... }` block at the top with a 1-line comment per value.
  - **minor**: the IQR-based outlier detection only runs when there are ≥ 4 level-1 dirs. For a small project with 2 dirs, no drilling happens — every dir becomes a bucket no matter how big. Plausible but worth a sentence in `doc/architecture.md`.
  - **minor**: `EXPORT_REGEX` (line 4) is a regex, not a tree-sitter walk. The analyzer dir already has tree-sitter — using a regex here is a layering inversion. The heuristic is in `core`, where `core` doesn't have access to tree-sitter (the analyzer is plug-in). So the regex is a workaround for the layering rule.
    - **Trade-off**: the symbol extraction here is approximate (misses `export { x }`, re-exports, decorators). For "key exports" used by the LLM, the approximation is fine. But if any future feature needs precise exports, you'd duplicate the analyzer's symbol code.
    - **Fix**: move `extractExportNames` here into the analyzer (`extractSymbols` already exists). Then `discoverHeuristic` calls `analyzer.extractSymbols(source).filter(s => s.exported).map(s => s.name)`. Clean, accurate, no regex.
    - **Cost**: `discoverHeuristic` would need an `analyzers` parameter (currently only takes `root, fileList`). The signature change ripples to `classify.ts`. Manageable.
    - **Severity**: MAJOR — this is a layering smell that grows with usage.
  - **nit**: `collapseTinyBuckets` (line 46) mutates the input map while iterating a snapshot (`[...buckets]`). That's safe. Minor: it only collapses one level; a `1-file` bucket inside a `1-file` parent collapses to the parent, but the parent is still 2 files which might still be < `TINY_FLOOR=4`. The single pass leaves it. A `while (changed) { ... }` loop is more correct. Probably never bites in practice.
- **Verdict**: works. Magic numbers and the regex are the two scrub-up points.

## `discover-llm.ts` (108 lines)

- **Job**: send heuristic modules to LLM, parse JSON response, validate.
- **Issues**:
  - **none major**. Validation is strict. Truncation is explicit. Error messages are specific.
  - **minor**: `extractJson` (line 49-58) duplicates the same logic in `split.ts:92-101`. Two near-identical implementations. CLAUDE.md says "two: usually still duplicate". OK to leave at two but if a third LLM-using flow lands, factor.
  - **nit**: `MAX_NAME = 30`, `MAX_DESC = 80` (line 22-23). These match the prompt's hard rules. Magic numbers tied across two files. Consider exporting from `llm-prompt.ts` so they're defined once.
- **Verdict**: clean. Strict validation is the right choice.

## `aggregate-and-apply.ts` (52 lines)

- **Job**: orchestrate cache check → LLM call → fallback.
- **Issues**:
  - **major - tension with CLAUDE.md**: lines 34-37 and 44-48 are both `try/catch ... console.warn(...)` with silent fallback. CLAUDE.md says: *"Silent fallbacks are forbidden. If a detector fails, throw; do not degrade to a generic 'Unknown' bucket."* AND *"No try/catch that rethrows. Let exceptions bubble."*
    - The second rule doesn't apply (this catch doesn't rethrow).
    - The first rule applies in spirit — we ARE silently degrading from "LLM" to "fallback". The user sees a `console.warn`, but the dashboard shows the fallback labels as if they were normal.
    - **Defensible counter**: the CLI surfaces the fallback (`stats.aggregation = 'fallback'`); the user *will* see "fallback" printed. So it's not silent at the surface — only silent in the warning channel.
    - **Recommendation**: this is a judgment call for the project. If the user wants "no LLM = no fancy names, but everything still works", current behavior is right. If "no LLM = error, fix it", switch to throw. Current behavior matches a "vibe coder" target audience, which the project README endorses.
  - **minor**: cache key is `aggregation_fingerprint`/`aggregation_result` — string keys repeat in `persist-aggregation.ts:39-40`. Move to a constant in `meta.ts`.
- **Verdict**: design is intentional but the `console.warn` + fallback should be documented as a deliberate UX choice, not look like an oversight.

## `list-for-aggregation.ts` (22 lines)

- **Job**: pull heuristic modules out of DB into memory shape (`HeuristicModule[]`).
- **Issues**:
  - **minor**: this is a duplicate of the in-memory shape produced by `discover-heuristic.ts`. The "round-trip" (memory → DB → memory) exists because the `/api/aggregate` endpoint runs at user request time, not at index time, and needs to re-read the persisted heuristic. Fine — just unavoidable serialization.
  - **nit**: `JSON.parse(row.dir_paths)` typed as `string[]` (line 14) without runtime validation. If the DB row was tampered, this throws or returns wrong shape. Acceptable inside our own DB.
- **Verdict**: fine. This file justifies its existence.

## `llm-prompt.ts` (55 lines)

- **Job**: build the LLM prompt for aggregation.
- **Issues**:
  - **minor**: `MEGA_MIN = 3`, `MEGA_MAX = 10` are exported, used in `discover-llm.ts` indirectly via `megaRangeFor`. The validation in `discover-llm.ts:78-80` checks `range.min`/`range.max`. So the constants flow correctly. Just a single-source-of-truth note: keep them here.
  - **minor**: prompt is constructed via array `lines.push(...)`. That's fine but a template string with placeholders would be more readable for editing the prompt. Aesthetic.
  - **nit**: `'<= 80 characters'` appears twice in the prompt. If the rule changes, two places.
- **Verdict**: clean. Small file with a clear job.

## `meta.ts` (18 lines)

- **Job**: SHA-256 fingerprint helper + meta KV read/write.
- **Issues**:
  - **minor**: fingerprint hashes only the *names* (`m.name`), not file lists. So if a heuristic module's name is unchanged but its files change, the fingerprint matches and the cached LLM result is reused. **Is that correct?** Probably yes — the LLM's job is naming, not file assignment. But edge case: if the heuristic now buckets differently while keeping the same overall set of names, you'd re-use a stale label. Defensible; document the assumption.
  - **nit**: `slice(0, 32)` truncation. 32 hex chars = 128 bits. Fine.
- **Verdict**: clean.

## `persist-aggregation.ts` (44 lines)

- **Job**: take the validated LLM result, update DB rows.
- **Issues**:
  - **minor**: lines 12-13 mirror lines 7-8 of `static-fallback.ts` exactly (delete + reset of `ai-mega` rows). Two identical blocks. CLAUDE.md threshold says we're at 2 — hold off. But if we ever add a third "apply X" path, factor.
  - **nit**: line 18 inlines the SQL `INSERT INTO modules ... VALUES (NULL, ?, NULL, ?, 'ai-mega', ?, NULL, NULL)`. The same template, with column ordering, appears in `static-fallback.ts:11`. If the schema changes, two places to fix. The `tree.ts:31` insert is for `'heuristic'` and slightly different. Consider a small `insertMega(db, name, description, now)` helper to centralize. Tradeoff: one more layer for a minor DRY gain. Skip for now.
- **Verdict**: clean. Watch for the third copy.

## `split.ts` (137 lines) — exceeds 100-line guideline

- **Job**: when user requests a split, ask LLM, validate, write sub-modules.
- **Issues**:
  - **major - file size**: 137 lines, over the 100-line "two-minute rule" target. Could split into:
    - `split-prompt.ts` (buildPrompt + summarizeFile)
    - `split-parse.ts` (parseSplitResponse + extractJson + validateEntry + validateSplit)
    - `split.ts` (just `splitModule` + `writeSplit`)
    Total per file: ~50 lines. Each readable in one minute. **Recommendation: split.**
  - **minor**: `extractJson` is the third copy (counting `discover-llm.ts`). Now we're at 3 — CLAUDE.md threshold says "consider it, but often still duplicate". I'd factor: a single `parseLLMJson(raw): unknown` helper in a new `core/ai/llm-parse.ts` file, used by both. Three lines saved per call site, plus correctness if the parsing logic ever needs adjusting.
  - **minor**: `summarizeFile` (line 61) uses `analyzer.extractSymbols` — good, this is the right abstraction. But it reads each file from disk synchronously (line 64). For a 30-file split, that's 30 sync reads on the request path. Acceptable for V0.1, less so for V0.2 with multiple users. A simple fix: cache by hash, or batch via worker. Defer.
  - **minor**: validation function `validateSplit` (line 103) is defensive. Good.
  - **nit**: `parseSplitResponse` and the prompt's "respond with single JSON" instructions overlap with `discover-llm.ts`. Same pattern, slightly different shape. The duplication is the LLM-flow plumbing, not the business logic.
- **Verdict**: works correctly, but **needs to be split into 2-3 files** to honor the project's own file-size rule.

## `static-fallback.ts` (37 lines)

- **Job**: when LLM is unavailable, group heuristic modules by their first directory segment, capitalize, treat that as mega-modules.
- **Issues**:
  - **minor**: duplicates the `ai-mega` reset pattern from `persist-aggregation.ts` (see note above).
  - **minor**: `firstSegment` returns `'.'` for files at root, then the cap function turns `'.'` into `'Root'`. Asymmetric handling — `.` is a sentinel from `discoverHeuristic` (line 73). Documented only by reading both files. Add a shared `ROOT_BUCKET = '.'` constant somewhere central.
- **Verdict**: clean for what it does. Coupling to `'.'` sentinel is the only smell.

## `tree.ts` (47 lines)

- **Severity at the file level: WRONG NAME, DEAD EXPORTS.**
- **Job (claimed)**: tree of modules. **Job (actual)**: write heuristic modules + two dead helpers.
- **Issues**:
  - **major**: file is named `tree.ts` but contains:
    1. `replaceHeuristic` — DB writer for heuristic modules. Used by `classify.ts`.
    2. `listModules`, `filesInModule` — DB readers. **No callers anywhere.** (See dead-code report.)
  - There's no actual tree structure here. The real "module tree" building lives in `src/ui/arch/tree.ts` (frontend).
  - **Action**:
    1. Delete `listModules` and `filesInModule` (per dead-code report).
    2. Rename file to `persist-heuristic.ts` (parallel to `persist-aggregation.ts`).
    3. The `Module` interface at the top is also dead (only used by the dead `listModules`). Delete.
  - After cleanup the file would be ~26 lines, all justifying their existence.
- **Verdict**: needs a rename and dead-export removal.

---

## Cross-cutting findings (this directory overall)

1. **Three "apply X to DB" files**: `tree.ts` (heuristic), `persist-aggregation.ts` (mega), `static-fallback.ts` (fallback mega). They all start with the same "delete `ai-mega`, INSERT new" boilerplate. Currently ~3 implementations of the same SQL phrase. **Worth a `clear-mega-rows.ts` helper** at the third copy.
2. **Magic numbers scattered**: `DRILL_FLOOR`, `TINY_FLOOR`, `MEGA_MIN`, `MEGA_MAX`, `MAX_NAME`, `MAX_DESC`, fingerprint slice length. Each in a different file. Recommend gathering into `module-tuning.ts` (or just live with it — they're not changing often).
3. **The directory has 11 files for what is logically 3 phases**: discover (heuristic + framework), aggregate (LLM), split (LLM). That's covered in the module-level audit (`03-modules.md`).
4. **One naming bug**: `tree.ts` doesn't contain a tree.

## Summary table

| File | Lines | Top issue |
|---|---:|---|
| classify.ts | 40 | clean |
| discover-heuristic.ts | 101 | regex-based exports (layering) + magic numbers |
| discover-llm.ts | 108 | clean (extractJson dup at 2/3) |
| aggregate-and-apply.ts | 52 | silent fallback by design — document |
| list-for-aggregation.ts | 22 | clean |
| llm-prompt.ts | 55 | clean |
| meta.ts | 18 | clean |
| persist-aggregation.ts | 44 | clean (small SQL dup) |
| split.ts | 137 | **over budget; split** + extractJson is dup #3 |
| static-fallback.ts | 37 | clean (small SQL dup) |
| tree.ts | 47 | **misnamed; has 2 dead exports** |
