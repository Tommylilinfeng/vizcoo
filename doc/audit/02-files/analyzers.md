# File-by-file audit: `src/analyzers/typescript/`

This is the only language analyzer plugin. Per CLAUDE.md, core never imports from here — only the bin wires it in. The audit checks: does each file pull its own weight, are there hardcoded assumptions that should be options, and does this set up clean extension to a second language?

Severity: **blocker / major / minor / nit**.

---

## `index.ts` (24 lines)

```ts
export const typescriptAnalyzer: LanguageAnalyzer = {
  id: 'typescript',
  frameworkDetectors: [monorepoDetector, nextjsDetector, expressDetector],
  init: initParser,
  canHandle: ...,
  extractImports, extractSymbols, extractApiCalls,
}
```

- **Job**: assemble the analyzer record. Pure wiring.
- **Issues**:
  - **nit**: detector ordering matters (first match by confidence). The list is sorted alphabetically by name in code (`monorepo, nextjs, express`) but `classifyProject` picks by max confidence regardless — so order doesn't actually matter. Fine.
  - **nit**: `EXTENSIONS` set hardcoded to 6 extensions. Defensible — TS file extensions are stable. Fine.
- **Verdict**: clean. Good sample for what a second analyzer should look like.

## `parser.ts` (61 lines)

- **Job**: lazy-load tree-sitter WASM grammars (TS, TSX, JS), expose `withTree(source, path, fn)`.
- **Issues**:
  - **nit**: `langOf` falls through to `'javascript'` for `.mjs` and `.cjs`. Correct, but worth noting in a one-line comment if any future maintainer wonders. Actually no — CLAUDE.md says "no comments to compensate for bad names". The names are fine. Skip.
  - **minor**: `parsers` is module-global mutable state. This is the only place in the analyzer that holds state, and it's exactly the case CLAUDE.md says is OK ("Classes only for state. A registry holding a Map is a class. A pure resolver is a function."). Could be a class, but a memoized init function is fine — keep.
- **Verdict**: clean.

## `imports.ts` (99 lines)

- **Job**: walk import statements via tree-sitter, emit `Import[]`.
- **Issues**:
  - **minor**: `hasTypeKeyword` is called twice — once on the import statement (line 19), once per specifier inside `collectNamedImports` (line 81). The cost is trivial but the duplicated walk is a slight smell. A reader has to verify the inner call is checking the *specifier*, not the statement. Acceptable as-is but renaming the inner one to `specifierIsTypeOnly` would help.
  - **minor**: `findChild` (line 86) is a one-shot helper. It's used exactly once (`namespace_import → identifier`). Could inline. Five lines saved.
  - **nit**: `stripQuotes` is duplicated almost verbatim in `api-calls.ts`. Three near-identical implementations across this dir. CLAUDE.md threshold says "Two: usually still duplicate. Three: consider it." We're at 2.5. Hold off.
- **Verdict**: solid. The tree-sitter walking is verbose but necessary; no abstraction to add.

## `symbols.ts` (60 lines)

- **Job**: extract top-level declarations + their export status. Used only by `splitModule` (LLM context).
- **Issues**:
  - **major**: `walkTopLevel` only handles 5 node types. Misses `enum_declaration`, `module_declaration` (TS namespaces), `abstract class` (parsed as `class_declaration` but the modifier is on a sibling, so the *kind* is correct but `abstract` info is lost — fine since the contract just says "class"). Enums and namespaces silently disappear.
  - **major**: only walks direct children of `program`. A `declare module 'foo' { export const x = 1 }` block would have its export missed. Probably acceptable for V0.1 — we're feeding the LLM a summary, not building a full bindings DB.
  - **nit**: dead `isNamespace` field in the `Import` interface? No — that's in `analyzer.ts`, irrelevant here.
- **Verdict**: works for the LLM-summary use case. **Document the limits in `analyzer.ts` as a contract note** — otherwise, a second analyzer author will have no idea what "extract top-level symbols" means precisely.

## `api-calls.ts` (108 lines)

- **Job**: spot `fetch(...)`, `axios.get(...)`, etc. with literal string URL → emit edges to API routes.
- **Issues**:
  - **major**: `firstStringArg` accepts `template_string` and substitutes `${...}` literally (line 97). A URL like `` `/users/${id}` `` becomes `"/users/${...}"`. Then `edgesFromImports` (`graph/edges.ts:24`) only keeps edges whose pattern starts with `/`. So this gets through. **But** the matching to a route definition is by exact string — `${...}` won't match anything. Net effect: silent no-op for templated URLs. Either match against route patterns (with parameter substitution) or drop template support. Right now it builds dead data.
  - **minor**: the `route-definition` kind is in the `ApiCall` type (`analyzer.ts:22`) but **never emitted anywhere**. The express detector recognizes route folders, but the *call site* of `app.get('/users', ...)` is never extracted. So this audit kind exists in the type but not in the implementation. Either drop the kind or add a `route-definition` extractor (express path is hardest, since `app` is a variable name — would need scope analysis).
  - **minor**: hardcoded `'fetch'` and `'axios'` (lines 35, 43, 58). What about `ky`, `got`, `node-fetch`, `superagent`? Each backend project picks one. This is fine for V0.1 if the contract is "best-effort URL discovery", but a comment in `analyzer.ts` would set expectations. Or extract a `KNOWN_HTTP_CLIENTS` set so adding one is one line.
  - **nit**: `axiosMethodOf('axios')` returns `'get'` (line 58) — that's wrong. `axios('/path')` is a generic dispatch; the method depends on the second-arg config. Setting it to `'get'` is a guess. Either return `undefined` (caller already handles missing method) or remove the special case.
- **Verdict**: works in the happy case, has a few wrong-but-silent edge cases. The `route-definition` kind is the worst smell — type fields that no producer fills in are anti-patterns.

## `frameworks/deps.ts` (12 lines)

- **Job**: read `dependencies + devDependencies + peerDependencies` from `package.json` into a `Set<string>`.
- **Issues**: none. Tiny, correct, reusable.
- **Verdict**: clean. Exemplary helper.

## `frameworks/express.ts` (35 lines)

- **Job**: classify Express-like backends into 5 buckets (Routes, Services, Models, Middleware, Other).
- **Issues**:
  - **major**: silent fallback to `'Other'` (line 34, `categorize`). CLAUDE.md says: *"Silent fallbacks are forbidden. If a detector fails, throw; do not degrade to a generic 'Unknown' bucket."* The bucket is literally called `'Other'`. This is the exact pattern the project's own rules forbid.
    - **Counter-argument**: this isn't a "detector failed" case; it's a "file doesn't fit the 4 named patterns". The detector already returned `null` if dependencies didn't include a backend pkg. So the bucketing is the *output*, not the dispatch.
    - **Resolution**: the rule is about *detector dispatch*, not bucket fallout. But "Other" is still a smell — a Next.js project wouldn't run this detector at all (Next is checked first), and an Express project's "Other" is genuinely heterogeneous. I'd accept it but rename the bucket to something less wishy-washy (`Helpers`, `Misc`) or make it conditional (only emit if `Other.length > 0` and `< 30%` of total).
  - **minor**: hardcoded `BACKEND_PKGS` of 5 names. Like the `KNOWN_HTTP_CLIENTS` smell above — a single source of truth would be nice if a third detector eventually wants the same list.
  - **minor**: `confidence: 0.7` is a magic number. There's no rubric explaining why 0.7 vs 0.9 (Next) vs 0.95 (monorepo). Either codify this in a comment in `detector.ts` or document in `doc/architecture.md`. (The order of preference *is* monorepo > nextjs > express, so the values match — but no future detector author can pick a sane value without the table.)
- **Verdict**: works; "Other" bucket and confidence values need either justification or convention.

## `frameworks/monorepo.ts` (33 lines)

- **Job**: detect npm/pnpm/turbo workspaces, bucket files by `packages/<name>/` or `apps/<name>/`.
- **Issues**:
  - **minor**: `packageOf` only handles `packages/*` and `apps/*`. Misses `services/*`, `libs/*`, custom workspace roots. For pnpm `pnpm-workspace.yaml` could declare anything. **Better**: parse the workspace globs and use them. Higher-effort for V0.2; for V0.1 the hardcoded prefixes catch ~90% of monorepos.
  - **nit**: `confidence: 0.95` — same magic-number issue.
- **Verdict**: works for the common case. Document the limit.

## `frameworks/nextjs.ts` (49 lines)

- **Job**: classify Next.js files into Pages / API Routes / Components / Lib / Config.
- **Issues**:
  - **same "Other"-style smell**: the final bucket is `'Config'` — anything that doesn't match `app/`, `pages/`, `components/`, `lib|utils|hooks|server` ends up here. Files like `next.config.js` or `tailwind.config.js` legitimately go here, but so does `random-helper.ts` at the root. Rename to `Misc` or add explicit config-file detection.
  - **minor**: `isLib` regex is `^(src/)?(lib|utils|hooks|server)/`. Hardcoded folder vocabulary. A consistency between this and the heuristic discoverer is missing — the heuristic doesn't know about Next conventions. Might be fine.
  - **minor**: order of checks in `categorize` matters: `isApi` before `isPage` because API routes are under `app/` too. Documented by virtue of being in the right order, but a comment costs a line and saves a future bug.
- **Verdict**: works. The "Config" bucket needs a rename.

---

## Cross-cutting findings (analyzer plugin overall)

1. **Three "X-or-Other" classifiers** (express, nextjs, heuristic) all have the same pattern: a name list + a fallback bucket. If a fourth detector lands, this is the duplicate that says "abstract me". Hold off — but watch for it.
2. **Magic confidence numbers**. Need either a rubric in `doc/architecture.md` or a constant table in `detector.ts`.
3. **`extractSymbols` and `extractApiCalls` contracts are under-specified.** A second-language analyzer author cannot tell from `analyzer.ts` what's in scope. Add 4-5 lines of contract notes per method to that interface.
4. **`stripQuotes` duplication**: 2 copies, ~3 lines each. Acceptable until a third copy lands.

## Top-level extension readiness

If we add `pythonAnalyzer`:
- `LanguageAnalyzer` interface is concrete enough — yes, this would work.
- `Import` interface assumes ES-module semantics (`isDefault`, `isNamespace`). Python doesn't have a "default import" concept. Fine — Python analyzer can leave them all `false`.
- `ApiCall.kind` enumerates `'fetch' | 'axios' | 'route-definition'`. **Hardcoded TS-stack values in the cross-language interface.** This is a leak. A Python analyzer would never emit `'fetch'`. Either:
  - Make `kind: string` (loose).
  - Make it `'http-call' | 'route-definition'` (loose enough, captures the architectural fact).
  - Move client-name into a separate field.
  - **My pick**: rename to `'http-call'` / `'route-definition'`. Drop the client name to a sub-property. This is a `MAJOR` issue if you actually plan a second analyzer.

This last point is the only **architectural** issue in this dir; everything else is local cleanup.
