# Working Principles

This is the contract for how we work on vizcoo. When I break a rule, cite it back at me.

## Project

**Goal:** Live architecture visualization for TypeScript projects. `npx vizcoo <path>` opens a browser showing an auto-classified module map that updates as the project's code changes. Target audience is non-technical users ("vibe coders") and solo developers.

**Scope boundary:** read-only visualization. All writes (module rename, file reassignment) are deferred past V0.1. AI-driven module splitting is the only user-controlled mutation.

**Architecture:** three layers — browser UI, language-agnostic core, and pluggable language analyzers. Core never imports from a specific analyzer.

## Code cleanliness

**Every line earns its place.** No "just in case" parameters. No helpers used once. No `util/`, `common/`, or `shared/` dumping grounds.

**Two-minute rule.** A new reader understands any single file in two minutes. Files under 100 lines; over 200 means the file does too much. Target functions under 20 lines with early returns. Beyond 50 means it should probably split — but split because the function is doing two things, not to hit the number.

**Deletion-friendly.** Removing any piece is easy because dependencies are explicit. No re-export barrel files — callers import the source directly.

**High bar for abstraction.** One use case: never abstract. Two: usually still duplicate. Three: consider it, but often still duplicate. "Extensibility" is not a reason.

**Classes only for state.** A registry holding a Map is a class. A pure resolver is a function.

**Names carry meaning.** Files are nouns, functions are verbs. Avoid `Service`, `Manager`, `Handler`, `Processor` suffixes. Avoid `do`, `handle`, `process` verbs. No comments to compensate for bad names.

## Collaboration

**Confirm plan before implementing.** Any task touching more than one file or changing interfaces: write the plan (file changes, interface deltas, scope), end with an explicit "OK to proceed?", and stop. Do not start coding. Single-file edits, rollbacks, and obvious cleanups can proceed directly. A `respond with action only` system reminder removes filler text — it does NOT remove the confirm-first rule.

**No unilateral decisions.** Schema fields, default values, directory structure — if you wouldn't immediately see why, ask first. When copying from another project, mark what is theirs versus what I am adding.

**Acknowledge design holes upfront.** Plugin boundary leaks, module tree stale state, concurrent WebSocket pushes, error recovery granularity — list these before you hit them.

**Honest verification.** "Verified" comes with what was tested and what was not.

**No unrequested features.** Implement exactly what was asked. Do not smuggle in improvements.

## Code style

- TypeScript strict mode (including `noUncheckedIndexedAccess`).
- Zero comments by default. Comment only when "why" is non-obvious.
- No emoji in code or docs.
- Validate only at system boundaries (CLI args, HTTP request bodies, LLM output). Trust internal code.
- Silent fallbacks are forbidden. If a detector fails, throw; do not degrade to a generic "Unknown" bucket.
- No `try/catch` that rethrows. Let exceptions bubble.

## Visual

All UI changes follow `doc/design-language.md`. Read it before touching any `.tsx` file. It defines the typography scale, color palette, component primitives (Toggle, Slider, Tab, Drawer), and the anti-patterns we reject.

This doc wins on visual decisions. CLAUDE.md wins on architecture and code structure.

## Architecture boundaries

**Plugin discipline.** Nothing in `src/core/` imports from `src/analyzers/`. Core receives the analyzer registry at startup and dispatches via `canHandle(filePath)`. Violating this is a review-stop.

**File-level edges only.** Edges between files are persisted. Edges between modules are always computed on the fly by aggregation. Module re-splitting must never require edge recomputation — only re-lookup.

**Server file budgets.** `src/core/server/http.ts` stays under 150 lines (route registration + startup only). `src/core/server/api/*.ts` one file per endpoint, under 50 lines each, with direct SQL. No service / repository / controller layers.

**No Express / Koa.** Use `node:http` natively, or `hono` if justified. No middleware zoo.

**Frontend stack.** React + Tailwind, bundled with Vite. Map view uses D3 + SVG for isometric 3D rendering; View uses Three.js (`@react-three/fiber`) + zustand for the file-cabinet live scene. One styling approach (Tailwind). No CSS-in-JS. Per-feature viz library is allowed where the data model demands it; default to the lightest tool (SVG before D3, D3 before Three.js). Visual quality is a first-class concern (see `memory: feedback_visual_priority`).

**Localhost only, no auth.** Local dev tool.

**Precision over recall for edges.** When `resolveImport` is ambiguous, return [] over guessing. Wrong edges mislead users (建错 mental model on the visualization); missing edges leave gaps users can fill from the import statement. Pipeline `secondary` resolver is for disagreement signal only, not final output. Build-tag aware filtering (Go `_<os>.go`/`_<arch>.go`) defaults ON. Type-only imports excluded. Conventions learn conservatively. Confirmed by Phase D bench against CodeQL on 12 real repos.

## Communication

- Answer the question first, context after.
- Say "I do not know" when I do not.
- Tradeoffs, not just benefits, when recommending.
- Response length matches question complexity.
- Chinese questions get Chinese answers. Technical terms stay in English.

## Anti-patterns we're avoiding

- A 5000-line `server.ts` routing every endpoint (context-chain's prior failure mode).
- Storing module-level edges — makes re-splitting expensive and introduces consistency bugs.
- Re-running an LLM call when nothing relevant changed. Cold start is allowed to call the LLM (for module aggregation), but only when the heuristic fingerprint differs from the cached one. Subsequent restarts with unchanged structure replay from cache. User-triggered split is also LLM-driven.
- Multiple language analyzers that reach into each other's internals instead of going through the plugin API.
- Framework detectors that silently fall back to "looks like generic Node" instead of returning null.
