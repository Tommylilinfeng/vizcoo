# Architecture audit — Naming and Shape

CLAUDE.md is opinionated about names:

> **Names carry meaning.** Files are nouns, functions are verbs. Avoid `Service`, `Manager`, `Handler`, `Processor` suffixes. Avoid `do`, `handle`, `process` verbs. No comments to compensate for bad names.

And about shapes:

> **Two-minute rule.** A new reader understands any single file in two minutes. Files under 100 lines; over 200 means the file does too much. Target functions under 20 lines with early returns. Beyond 50 means it should probably split — but split because the function is doing two things, not to hit the number.

> **Classes only for state.** A registry holding a Map is a class. A pure resolver is a function.

This audit checks each rule against the codebase.

---

## 1. File names — nouns

**Test**: list every `.ts`/`.tsx` file in `src/` and ask "is the basename a noun, an action verb, or ambiguous?"

| Path | Verdict |
|---|---|
| `analyzers/typescript/index.ts` | noun (registry) ✅ |
| `analyzers/typescript/parser.ts` | noun ✅ |
| `analyzers/typescript/imports.ts` | noun ✅ |
| `analyzers/typescript/symbols.ts` | noun ✅ |
| `analyzers/typescript/api-calls.ts` | noun ✅ |
| `analyzers/typescript/frameworks/deps.ts` | noun ✅ |
| `analyzers/typescript/frameworks/express.ts` | noun (proper) ✅ |
| `analyzers/typescript/frameworks/monorepo.ts` | noun ✅ |
| `analyzers/typescript/frameworks/nextjs.ts` | noun (proper) ✅ |
| `core/ai/provider.ts` | noun ✅ |
| `core/ai/claude-cli.ts` | noun (proper) ✅ |
| `core/graph/aggregate.ts` | **verb** ❌ |
| `core/graph/edges.ts` | noun ✅ |
| `core/graph/resolve.ts` | **verb** ❌ |
| `core/hooks/install.ts` | **verb** ❌ |
| `core/index-project.ts` | **verb** ❌ |
| `core/modules/aggregate-and-apply.ts` | verb ❌ |
| `core/modules/classify.ts` | verb ❌ |
| `core/modules/discover-heuristic.ts` | verb-noun ⚠ |
| `core/modules/discover-llm.ts` | verb-noun ⚠ |
| `core/modules/list-for-aggregation.ts` | verb-phrase ❌ |
| `core/modules/llm-prompt.ts` | noun ✅ |
| `core/modules/meta.ts` | noun ✅ |
| `core/modules/persist-aggregation.ts` | verb ❌ |
| `core/modules/split.ts` | verb-as-noun ⚠ |
| `core/modules/static-fallback.ts` | noun ✅ |
| `core/modules/tree.ts` | **noun, but file isn't a tree** ❌ |
| `core/plugin-api/analyzer.ts` | noun ✅ |
| `core/plugin-api/detector.ts` | noun ✅ |
| `core/project/scan.ts` | **verb** ❌ |
| `core/project/watch.ts` | **verb** ❌ |
| `core/server/http.ts` | noun ✅ |
| `core/server/ws.ts` | noun ✅ |
| `core/server/api/*.ts` | varies (tree, graph, aggregate, conversations…) — mostly nouns ✅ |
| `core/storage/db.ts` | noun ✅ |
| `core/view/conversations.ts` | noun ✅ |
| `core/view/file-tree.ts` | noun ✅ |
| `core/view/live.ts` | adjective (≈ noun) ⚠ |
| `core/view/project-files.ts` | noun ✅ |
| `core/view/turns.ts` | noun ✅ |
| `core/view/types.ts` | noun ✅ |
| `ui/api.ts` | noun ✅ |
| `ui/App.tsx` | noun ✅ |
| `ui/MapView.tsx`, `Sidebar.tsx`, `SettingsModal.tsx` | nouns ✅ |
| `ui/layout.ts` | noun ✅ (but dead) |
| `ui/main.tsx` | noun (entry) ✅ |
| `ui/arch/{ArchScene,Overlays,SettingsPanel}.tsx` | nouns ✅ |
| `ui/arch/{edges,iso,layout,settings,tree,types}.ts` | nouns ✅ |
| `ui/view/{ViewScene,Timeline,FileNode,HoverCard,ConversationList,EmptyState,dev-probes}.tsx` | nouns ✅ |
| `ui/view/{layout,scene-constants,viewStore}.ts` | nouns ✅ |

**Tally**: ~10 verb-named files, ~58 noun-named, ~5 ambiguous.

**Worst offenders**:
- `core/modules/tree.ts` — **wrong noun**. Not a tree.
- `core/index-project.ts` — verb. Should be `indexer.ts` (noun: the indexer).
- `core/modules/list-for-aggregation.ts` — verb-phrase. Could be `aggregation-input.ts` (the things-to-aggregate). Or rename to match its function: `heuristic-modules.ts`.
- `core/modules/aggregate-and-apply.ts` — long verb-phrase. Could be `aggregation.ts` (the noun for the whole orchestrator).
- `core/modules/persist-aggregation.ts` — verb. Could be `aggregation-store.ts`. Or `mega-rows.ts`.
- `core/hooks/install.ts` — verb. Could be `installer.ts`. Or move to `hooks.ts` since that's the only file.
- `core/project/scan.ts`, `watch.ts` — verbs. Could be `scanner.ts`, `watcher.ts`. Minor.
- `core/graph/aggregate.ts`, `resolve.ts` — verbs. Could be `aggregator.ts`, `resolver.ts`.

**The CLAUDE.md rule isn't ironclad** — `react`'s own files use verb names sometimes. But the project picked the rule. **Recommendation**: rename the worst 3-4 (`tree.ts`, `list-for-aggregation.ts`, `aggregate-and-apply.ts`, `persist-aggregation.ts`). The rest are plausible enough as-is.

---

## 2. Function names — verbs

**Test**: scan exported function names for `do*`, `handle*`, `process*`, or noun-shaped functions.

`Grep "export function (do|handle|process)" src/` →

```
src/core/server/api/hook.ts:dispatchHook
src/core/server/http.ts:(internal handle, handleHook, handleViewTurns, handleViewFiles, handleSplit, handleAggregate)
src/core/index-project.ts:processFile
src/core/view/live.ts:handleHookPre/Post/SessionStart/SessionEnd/TurnStart/Stop
```

**Findings**:

- **`processFile` in `index-project.ts`**: forbidden by CLAUDE.md. The function indexes a file. Rename: `indexFile`. Same for `deleteFile` (which is fine: `deleteFile` *is* what it does).
- **`handleHookPre`, `handleHookPost`, `handleHookTurnStart`, `handleHookStop`, `handleHookSessionStart`, `handleHookSessionEnd`** in `live.ts`: 6 `handle*` functions. Forbidden. Rename to verbs:
  - `handleHookPre` → `recordPendingEdit` (what it does: builds a pending change record).
  - `handleHookPost` → `finalizeEdit` (resolves disk context + broadcasts).
  - `handleHookTurnStart` → `beginTurn`.
  - `handleHookStop` → `endTurn`.
  - `handleHookSessionStart` → `registerSession`.
  - `handleHookSessionEnd` → `markSessionDead`.
  
  Each new name is a verb that *describes the effect*. Also: when split into `live/sessions.ts`, `live/edits.ts`, etc., the names lose the `Hook` prefix anyway since context is in the file path.
- **`dispatchHook`** in `core/server/api/hook.ts`: `dispatch*` is fine — it's a verb. Acceptable.
- **`handle`** in `http.ts`: internal, the request dispatcher. Could be `route(req, res, cfg)`. Aesthetic.

**Action**: rename the 7+ violating functions during the `live.ts` split.

---

## 3. Suffixes (`Service`, `Manager`, `Handler`, `Processor`)

**Test**: `Grep -rn "Service|Manager|Handler|Processor" src/`.

Results:
- `processFile`/`deleteFile`/etc. — already covered.
- No `*Service`, `*Manager`, `*Handler`, `*Processor` *types* or *classes* anywhere.

**Verdict**: ✅ rule held — except for the function-name `*handle*` cases.

---

## 4. Two-minute rule (file size)

| File | Lines | Verdict |
|---|---:|---|
| **HARD VIOLATIONS (> 200)** | | |
| `ui/arch/ArchScene.tsx` | 451 | ❌ |
| `ui/view/Timeline.tsx` | 290 | ❌ |
| `ui/MapView.tsx` | 271 | ❌ |
| `core/view/live.ts` | 267 | ❌ |
| **TARGET VIOLATIONS (100-200)** | | |
| `ui/arch/SettingsPanel.tsx` | 177 | ⚠ |
| `core/server/http.ts` | 164 | ⚠ (also rule-violation) |
| `ui/arch/layout.ts` | 165 | ⚠ |
| `ui/SettingsModal.tsx` | 157 | ⚠ |
| `ui/Sidebar.tsx` | 138 | ⚠ |
| `core/modules/split.ts` | 137 | ⚠ |
| `core/view/conversations.ts` | 121 | ⚠ |
| `core/view/turns.ts` | 119 | ⚠ |
| `core/modules/discover-llm.ts` | 108 | ⚠ |
| `core/modules/discover-heuristic.ts` | 101 | ⚠ |
| `analyzers/typescript/api-calls.ts` | 108 | ⚠ |

**Out of ~70 source files, ~14 are over the 100-line target. Of those, 4 violate the 200-line hard limit.**

The hard limit must be addressed: `ArchScene.tsx`, `Timeline.tsx`, `MapView.tsx`, `live.ts`. **All 4 splits are described in earlier audit files.**

The target violations are mostly UI (panels with many controls) and the LLM-flow files. UI panel files at 138-177 lines are reasonable for what they are (forms with many inputs); CLAUDE.md is "target", not "must". Acceptable.

The two LLM files (`discover-llm.ts`, `split.ts`) are 108-137 lines, doing prompt + parse + validate + truncate. They're each the third copy of "extractJson" (already noted). Splitting them by phase (prompt / parse / validate / truncate) would honor the rule but adds 4 small files for one flow. Marginal value.

`turns.ts` and `conversations.ts` at 119-121 are single-purpose; reading top-to-bottom is fine. **Don't split.**

---

## 5. Function size (target < 20 lines, > 50 should probably split)

I'll spot-check the largest functions:

- `ArchScene.tsx:ArchScene` — 156 lines. Well over.
- `MapView.tsx:MapView` — ~110 lines. Over.
- `live.ts:readDiskContext` — 47 lines. At the threshold.
- `live.ts:handleHookPost` — 32 lines. Over target.
- `viewStore.ts:handleLive` — 46 lines. Over target.
- `Timeline.tsx:Card` — ~50 lines. At the threshold.
- `conversations.ts:loadDetail` — 17 lines. ✅
- `discover-heuristic.ts:discoverHeuristic` — 28 lines. Slightly over.

**The big component bodies are the worst.** When `ArchScene.tsx` and `MapView.tsx` get split per the file-budget audit, the child components will naturally be smaller.

Inside `live.ts`, the handlers are 30-50 lines each because they do "guard, parse, build payload, broadcast, update state". Splitting each into smaller helpers wouldn't help readability — the flow is linear.

**Verdict**: split the big components; accept the medium handlers.

---

## 6. Classes vs functions

**Test**: where are classes used?

`Grep "^class " src/` → **zero hits**.

`Grep "= class" src/` → **zero hits**.

**No classes.** Everything is functions and modules. CLAUDE.md says "Classes only for state. A registry holding a Map is a class."

The project has *exactly one* state-holding pattern that would qualify:
- `core/view/live.ts` — module-globals `pending` (Map) and `sessions` (Map).

**This is exactly the case CLAUDE.md endorses for class shape.** Currently it's a module-global Map. The "rule" says it could be a class, but doesn't forbid the module-global form.

**Trade-off**:
- Module-global: simpler, no instantiation, one less concept.
- Class: testable in isolation (each test gets fresh state), easier to mock, signals "this owns state".

For V0.1, the module-global is fine. For testability of `live.ts` (currently zero unit tests), wrapping into a `LiveState` class would help. **Defer.**

---

## 7. Comments

CLAUDE.md: *"Zero comments by default. Comment only when 'why' is non-obvious."*

**Test**: `Grep "// " src/ | wc -l` → **~80 comment lines** total.

Spot-check what they say:
- `core/storage/db.ts`: comments on the migration logic (one-time rebuild). **Why** comments. ✅
- `core/view/live.ts`: comments on `CONTEXT_LINES = 4` (no), on `disk-context` cases (no — but should). Mixed.
- `analyzers/typescript/parser.ts`: zero comments. ✅ clean.
- `core/server/api/view.ts`: leading 4-line comment explaining "legacy, kept for tests". ✅ why-comment.
- `ui/view/dev-probes.tsx`: leading comment marking it test-only. ✅ why-comment.
- `core/view/viewStore.ts`: comments at line 91 ("default: 'all turns' — every file ever edited"). **What** comment, redundant with code. Remove.
- `core/hooks/install.ts:71`: comment explaining the `$PPID` shell trick. ✅ why-comment.
- `core/modules/llm-prompt.ts`: zero comments. The prompt's intent is encoded in the prompt itself. ✅
- `ui/view/scene-constants.ts`: each constant has a 1-line comment ("Bigger than V0 so highlighted plates are readable"). **Why** comments. ✅
- `core/index-project.ts`: zero comments.
- `ui/view/dev-probes.tsx:1`: header comment justifying the file's existence. ✅
- `bin/vizcoo.ts`: zero comments.

**Verdict**: ✅ mostly compliant. Two cases I noticed where `what`-comments could be removed (already-obvious-from-code comments), and a few places where adding a `why` would help (e.g., `live.ts:readDiskContext` cases). **Net: clean.**

---

## 8. Names that mislead

This is a separate concern from "verb vs noun" — a name that *exists* but is wrong.

| Name | Why misleading | Fix |
|---|---|---|
| `core/modules/tree.ts` | no tree inside | rename `persist-heuristic.ts` |
| `core/server/api/hookStatus.ts` | actually status + install + uninstall | rename `hooks-settings.ts` |
| `core/server/api/hook.ts` | actually hook event router | rename `hook-events.ts` |
| `LanguageAnalyzer.id` | a string, not "language id" — could be `'typescript'` or `'python'` | acceptable; lowercase string is normalized |
| `Module.origin` | string `'heuristic' | 'ai-mega' | 'ai-split'` | fine; the values explain |
| `core/graph/edges.ts: edgesFromApiCalls` | currently emits unused edges | acceptable name; the issue is whether to keep emitting at all |
| `effectiveFileCount` in `arch/layout.ts` | dead parameter, dead code | fix the function |

---

## 9. Cross-cutting names

### Verb-phrase variations for the same operation

- `discoverHeuristic`, `aggregateModules`, `applyAggregation`, `applyStaticFallback`, `splitModule`. Each is a verb. ✅
- `replaceHeuristic` (in misnamed `tree.ts`) — verb. ✅
- `processFile` — forbidden by CLAUDE.md. ❌

### Type names

`LanguageAnalyzer`, `FrameworkDetector`, `AIProvider` — all "thing-that-does-X" nouns. ✅

`HeuristicModule`, `AggregatedDetail`, `AggregatedMega` — adjective-noun. ✅

`ArchNode`, `PositionedNode` — adjective-noun. ✅

`ConversationSummary`, `ConversationDetail` — noun-noun. ✅

`Edge`, `Module`, `Turn`, `FileChange` — pure nouns. ✅

**Verdict**: type names are uniformly clean.

### Inconsistent capitalization

- `ArchSettings`, `archSettings` — settings are typed `ArchSettings`. The instance variables in code are `settings: ArchSettings`. Consistent.
- `claudeCliProvider` (lowercase first) — instance, ok.
- `typescriptAnalyzer` (lowercase first) — instance, ok.
- `TIER_PALETTES` — constant, SCREAMING_CASE. ok.
- `DEFAULT_SETTINGS`, `DEFAULT_CAMERA`, `DEFAULT_LAYOUT` — three "default" constants. Consistent.

**Verdict**: capitalization is consistent.

---

## Top naming/shape findings

1. **One file is wrong-named** (`core/modules/tree.ts`). Rename.
2. **~10 files use verb names** (CLAUDE.md prefers nouns). Worst 4-5 should rename.
3. **7 functions use forbidden `handle*` / `process*` prefixes**. Rename during `live.ts` split.
4. **4 files violate the 200-line hard limit**. Split per file-budget audits.
5. **~10 more files violate the 100-line target** but are single-purpose; mostly fine.
6. **Zero classes** — all module-functions. Add 1 class (`LiveState`) when testability becomes a priority.
7. **Comments are mostly clean** — about 80 total, mostly justified.
8. **Type names are exemplary**.

The naming smell is real but not pervasive. A morning's renaming + the file splits already mandated by the file-budget audit would close 80% of these issues.
