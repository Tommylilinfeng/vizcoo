# File-by-file audit: `src/core/view/`, `src/core/ai/`, `src/core/hooks/`, `src/core/project/`, `bin/`, `src/core/index-project.ts`

The View pipeline (CC conversation → turns → file overlays), the AI provider, the hook installer, the project scanner/watcher, the CLI entry, and the indexer.

---

## `bin/vizcoo.ts` (115 lines)

- **Job**: CLI entrypoint — parse args, open DB, index, start server, prompt to install hooks, open browser.
- **Issues**:
  - **minor**: `main()` is 64 lines (lines 19-83), longer than the 20-line target. It's doing one thing (boot the system), but in many sequential phases. A reader can follow it top-to-bottom — that's the right shape for an entrypoint. Don't split for split's sake.
  - **minor**: line 39 `const analyzers = [typescriptAnalyzer]`. Hardcoded single analyzer. When a second analyzer (Python?) lands, this list grows to 2. That's fine — `bin/` is the wiring point, by design. Just note that this is *the* place where new analyzers register.
  - **minor**: `vizcooVersion` IIFE (line 48-51) reads `package.json` at runtime. Cute — but if `dist/` is the published shape, the relative path `'..'+'/package.json'` resolves correctly. If the published bin is anywhere else, this breaks. Test: does `npm pack && npm install -g .` still find `package.json`? Likely yes. Document the relative-path assumption.
  - **minor**: `process.on('SIGINT')` cleans up watcher → ws → server → db (line 72-78). Order matters: closing watcher first stops file events; closing ws first stops broadcasting; closing server stops new connections; closing db last stops writes. Correct order. Good.
  - **nit**: `maybePromptInstallHooks` (line 85) blocks on stdin readline. If the user passes `<` redirection or runs in CI without TTY, the `process.stdin.isTTY` check skips the prompt. Good defensive code.
  - **nit**: `openBrowser` uses platform-specific `open`/`start`/`xdg-open`. Standard. No issue.
- **Verdict**: clean entrypoint. Wiring is concentrated here as it should be.

## `src/core/index-project.ts` (84 lines)

- **Job**: scan files, build edges per file, classify, optionally aggregate. Re-exports `processFile` and `deleteFile` for the watcher.
- **Issues**:
  - **minor**: `processFile` and `deleteFile` export the *internals* of the indexer. They're consumed by `project/watch.ts`. The flow is:
    - `bin` → `indexProject` (full scan)
    - `bin` → `watchProject` → `processFile`/`deleteFile` (delta)
    Both go through the same shared module. That's appropriate.
  - **minor**: `processFile` calls `crypto.createHash('sha256')...` per file (line 62). The hash is stored, but **nowhere is it read**. `Grep "content_hash"` confirms only the INSERT uses it. So we compute and persist a hash that nobody consumes. The hash *would* be useful for "skip files whose content hasn't changed" — but the watcher always re-runs the analyzer. **Either delete the hash field (one column drop, one INSERT change) or use it (skip parsing if hash unchanged). Currently dead data.**
  - **minor**: `IndexOptions.ai` defaults to `null` (`options.ai ?? null` at line 42). The CLI always passes `claudeCliProvider`. The null path is for tests. Document.
  - **nit**: `aggregation: 'skipped'` literal type clashes with `AggregateStatus` (`'cached' | 'llm' | 'fallback' | 'noop'`). The union type at line 17 is `AggregateStatus | 'skipped'`. Slightly awkward but precise.
- **Verdict**: clean. The dead `content_hash` column is an item for the schema audit.

## AI

### `core/ai/provider.ts` (11 lines)

- **Job**: `AIProvider` interface.
- **Issues**:
  - **minor**: `CompleteOptions.maxTokens?` and `temperature?` are declared but `claudeCliProvider` doesn't pass either to the CLI. Forward-looking placeholders. Either implement now or delete and re-add. Per CLAUDE.md *"No 'just in case' parameters"* — delete these two for now.
- **Verdict**: clean after the JIC trim.

### `core/ai/claude-cli.ts` (23 lines)

- **Job**: spawn `claude -p <prompt>` and collect stdout.
- **Issues**:
  - **minor**: spawning a subprocess per LLM call is slow (cold start ~500ms-1s). For interactive splits, fine. For batch usage (split 10 modules), it's a problem. Switching to the Claude API SDK is the V0.2 path. Document.
  - **minor**: `maxTokens` / `temperature` from `CompleteOptions` are ignored. See above.
  - **nit**: stderr is captured but only used in error message — if claude prints progress to stderr, it's lost. Acceptable.
- **Verdict**: minimal viable provider. Document the spawn cost.

## Hooks

### `core/hooks/install.ts` (89 lines)

- **Job**: read/write `~/.claude/settings.json` with vizcoo's hook entries.
- **Issues**:
  - **minor**: silent JSON parse error fallback (line 21: `catch { return {} }`). If user has a corrupt `settings.json`, vizcoo silently ignores it and writes a fresh one. **Risk**: user loses unrelated config. **Fix**: throw with a clear message, "your settings.json is invalid: ..., refusing to overwrite". Better UX.
  - **minor**: `mergeGroup` (line 85-89) replaces any group with the same `matcher` that has at least one `command.includes('/hook/')` entry. So a group with vizcoo *and* an unrelated hook with the same matcher would lose the unrelated one. **Edge case** — most users won't have this — but possible. Better filter: only remove `vizcoo`'s hook within the matcher's hook list, keep others. Tightening this is ~5 lines.
  - **minor**: `previewEntries` (line 63) flattens `entriesFor(port)` for display. Correct shape, just verbose.
  - **minor**: hardcoded route names `('pre', 'post', 'turn-start', 'stop', 'session-start', 'session-end')` here AND in `core/server/api/hook.ts:5-15`. **String coupling across two files.** Fix: export a `HOOK_ROUTES` const from one of them, import in the other. Or accept the string-coupling and rely on integration tests.
  - **nit**: line 73 SessionStart command embeds shell `$(ps -o ppid= -p $PPID)` — robustness depends on `ps` syntax. macOS/Linux compat OK, Windows would break. Acceptable for V0.1 (no Windows users likely).
- **Verdict**: works. The silent JSON-parse fallback is the worst smell.

## Project

### `core/project/scan.ts` (49 lines)

- **Job**: walk the project, respect `.gitignore` + default ignores, return relative paths the analyzer can handle.
- **Issues**:
  - **minor**: `DEFAULT_IGNORES` (line 10-20) and `core/view/project-files.ts:5` (`IGNORE_DIRS`) overlap heavily but aren't identical. Two separate ignore lists with subtly different membership. **Fix**: import one from the other. Saves drift.
  - **minor**: only reads root `.gitignore`. Nested `.gitignore` files (in subdirs) are ignored. Most projects work fine with root-only; some don't. Documented in `doc/architecture.md`?
  - **minor**: walk is synchronous recursive. For 50K files this blocks the event loop. Acceptable for V0.1 (target is "vibe coder" projects, typically under 5K files).
  - **nit**: `ignore` package imported via `createRequire` because it's a CJS package (line 7-8). Standard ESM-CJS dance.
- **Verdict**: clean. The two ignore lists should be unified.

### `core/project/watch.ts` (47 lines)

- **Job**: chokidar watcher → re-process changed files → emit `onChange()`.
- **Issues**:
  - **minor**: `IGNORED` regex (line 7) is a third copy of the ignore list. Three places now (`scan.ts`, `project-files.ts`, `watch.ts`), each in a different shape (regex vs Set vs string array). **Definite consolidation candidate.**
  - **minor**: each file change triggers a single `processFile` + `onChange()`. If 100 files change in a burst (`git checkout`), 100 broadcasts. Should debounce. Fix: 250ms tail debounce. ~5 lines.
  - **minor**: `add` and `change` events both call `processFile`. Correct — semantically the same for our purposes. `unlink` calls `deleteFile`. Three handlers, all correct.
  - **nit**: doesn't re-classify or re-aggregate after changes — just updates per-file edges. New modules don't appear, names don't refresh. **This is by design for V0.1** (re-classify on cold start), but should be documented. A reader of `watch.ts` doesn't know `classifyProject` won't run.
- **Verdict**: works. Fold ignore lists into one. Add debounce when burstiness becomes a complaint.

## View (Conversation pipeline)

### `core/view/types.ts` (39 lines)

- **Job**: shared types for the conversation pipeline.
- **Issues**:
  - **minor**: `FileChange` has 6 conditional/optional fields (`oldString`, `newString`, `content`, `status`, `contextStartLine`, `contextLines`, `toolUseId`). It's a sum type implemented as an unioned record — `kind: 'edit' | 'write'` discriminator with disjoint optional fields. Idiomatic TS would be:
    ```ts
    type FileChange =
      | { kind: 'edit'; path: string; oldString: string; newString: string; ... }
      | { kind: 'write'; path: string; content: string; ... }
    ```
    Two-arm discriminated union. Currently the type lets you write `{ kind: 'edit', content: '...' }` which is meaningless. **Fix**: introduce the union. Frees readers from "is this populated for my kind?" guesswork.
  - **minor**: `status?: 'pending' | 'done'` and the live-only fields are conditionally present. Same union split would help: a base `FileChange` extended by `LiveFileChange = FileChange & { status, toolUseId, ... }`.
  - **nit**: `FilesResponse`, `TurnsResponse` — only used by the legacy `/api/view/*` endpoints (see dead-code item #7). If those go, these go too.
- **Verdict**: types could be tightened. Functional today.

### `core/view/turns.ts` (119 lines)

- **Job**: parse a Claude Code JSONL conversation file into `Turn[]`.
- **Issues**:
  - **major - file size**: 119 lines. Above the 100-line target. Looking at the structure:
    - `parseTurns` (~35 lines) — the main loop.
    - 7 helpers (`isUserText`, `extractUserText`, `getMessageContent`, `getMessageStringContent`, `changeFromToolUse`, `lineCount`, `parseTs`, `safeParse`, `isRecord`) — most are 3-line guards.
    The helpers add up. Could split:
    - `turns.ts` (parseTurns + tool→change logic) ~70 lines.
    - `turns-validate.ts` (the type guards) ~30 lines.
    But honestly, the type guards are JSON parse hardening, not a separate concern. **Verdict**: leave at 119; the file is single-purpose and reads top-to-bottom. The 100-line rule is a target not a hard limit (vs the 200-line "too much" hard limit, which we're well under).
  - **minor**: `changeFromToolUse` knows about Claude Code tool names (`'Write'`, `'Edit'`, `'MultiEdit'`). Hardcoded. If CC adds a `Patch` tool, this is silent (returns null). Fine for now — these tool names are stable.
  - **minor**: `MultiEdit` aggregation joins all old/new strings with `'\n\n'` (line 97). For diff context resolution downstream, this loses positional info. The hover card will show all edits as one block. Acceptable for the visualization, less so for the "live diff against disk" path. Document.
  - **nit**: `safeParse` swallows JSON errors (line 113-115). Sanity-check: a corrupt JSONL file produces partial turns, not a crash. Defensive at the system boundary. Correct.
- **Verdict**: works. Slightly over budget but justifiable.

### `core/view/file-tree.ts` (51 lines)

- **Job**: take parsed turns → unique file list + relativized paths.
- **Issues**:
  - **minor**: `commonPrefix` (line 34) walks all paths to find the longest common prefix. For 200 files in 4 different roots, the prefix is `/`. The function returns `''` in that case (line 41). Edge case: a single-file conversation. Then prefix is the file's full path minus its basename — tiny edge case, handled.
  - **nit**: `byFolderThenBasename` is the same comparator used in `conversations.ts:94` and `project-files.ts:12`. Three copies of "sort by folder then basename". Move to `view/sort.ts` or to `types.ts` as `compareFileNodes`. Saves 9 lines.
- **Verdict**: clean.

### `core/view/conversations.ts` (121 lines)

- **Job**: list/get conversations from `~/.claude/projects/<dashed>/*.jsonl`. Fixture mode for tests.
- **Issues**:
  - **major - file size**: 121 lines, above target. Structure:
    - `projectsDirFor` (5 lines) — already noted as duplicate (with `projectInfo.ts`).
    - `listConversations` (~25 lines).
    - `getConversation` (~10 lines).
    - `loadDetail` + `mergeWithProjectScan` (~30 lines).
    - `summarize` (~17 lines).
    - `makeTitle` (~5 lines).
    Tight. Splitting `loadDetail`+`mergeWithProjectScan` into a separate `enrich.ts` would be cosmetic. **Verdict**: leave at 121.
  - **minor**: `summarize` (line 97) wraps `parseTurns` + `buildView` in a `try { ... } catch { return null }` (line 112). Silent fallback per CLAUDE.md. Same defensive boundary as `safeParse` — corrupted JSONL files shouldn't crash the listing. Reasonable.
  - **minor**: dual mode (fixture vs live) — control flow at lines 33-40 and 57-64 is non-trivial. `if (fixturePath)` branches. Functional, but a reader has to track which mode they're in. Could split into `listConversationsFromFixture` and `listConversationsFromDir`. Marginal.
  - **minor**: `makeTitle` truncates with `…`. If the user prompt starts with a prompt-comment (e.g., `<command-name>...</command-name>`), the title is the comment. Visual bug, not data bug. Could strip well-known prefixes; minor.
- **Verdict**: works. The file does borderline 2 things (listing + detail loading). Acceptable.

### `core/view/project-files.ts` (32 lines)

- **Job**: scan project for files (the View's "cabinet" view, separate from the indexer's analyzer-filtered scan).
- **Issues**:
  - **minor**: third ignore-list copy (`IGNORE_DIRS`, `INCLUDE_EXT`). See cross-cutting note.
  - **minor**: `MAX_FILES = 500` cap. Magic number — not in CLAUDE.md or anywhere else. Why 500? Probably "the cabinet UI looks bad above this". Document the rationale.
  - **minor**: hidden file rule: `if (e.name.startsWith('.') && e.name !== '.gitignore') continue` (line 22). Inconsistent with `scan.ts` which respects gitignore but doesn't filter dotfiles. Two scanners, two policies. Either unify or document the difference.
- **Verdict**: simple file. Same ignore-list cleanup needed.

### `core/view/live.ts` (267 lines) — **OVER 200 LINES (HARD LIMIT)**

- **Severity**: **MAJOR — violates the 200-line hard limit (CLAUDE.md: "over 200 means the file does too much")**.
- **Job**: receive Claude Code hook events, broadcast live updates over WS, track session liveness via PID polling, build pre/post diff context.
- **Issues**:
  - **MAJOR - file size**: 267 lines. The file does several things:
    1. Session record state + PID polling (`startSessionPoller`, `isPidAlive`, `handleHookSessionStart`, `handleHookSessionEnd`, `listSessions`, `touchSession`) — **session lifecycle**.
    2. Pre/Post tool-use lifecycle for Edit/Write (`handleHookPre`, `handleHookPost`) — **per-edit broadcasting**.
    3. Turn-start/stop lifecycle (`handleHookTurnStart`, `handleHookStop`) — **turn lifecycle**.
    4. Diff context resolution from disk (`readDiskContext`, `rawDiff`) — **disk reconciliation**.
    5. Line-counting helpers (`estimateLinesAdded`, `estimateLinesRemoved`, `lineCount`).
    
    That's 4 concerns. **Recommendation**: split into:
    - `live/sessions.ts` (lifecycle, polling, listSessions) ~80 lines.
    - `live/edits.ts` (Pre/Post + line counting) ~70 lines.
    - `live/turns.ts` (turn-start/end) ~30 lines.
    - `live/disk-context.ts` (readDiskContext + rawDiff) ~70 lines.
    Each file 30-80 lines, single concern, easy to read.
  - **major**: `pending` and `sessions` are module-globals (lines 46, 59). State that lives across requests. Each handler reads/writes them. This makes the file hard to test in isolation and conflates state with behavior. **Better**: make a `LiveState` class (CLAUDE.md: "Classes only for state. A registry holding a Map is a class.") that the server passes around. Each handler is then a method or a function taking state. The `attachWebSocket` and `startSessionPoller` would be methods.
  - **minor**: `handleHookTurnStart` swallows the prompt and broadcasts `userText: prompt` (line 184). This means turn ordering relies on `UserPromptSubmit` arriving *before* the first tool call's `PreToolUse`. CC's hook ordering does guarantee this, but it's worth noting.
  - **minor**: `readDiskContext` is 47 lines (lines 212-259). It's already the longest function in core. It's doing one job (build a diff context) but in many cases (write, edit-not-found, edit-no-match, edit-match). A short comment block at the top explaining the four cases would help. CLAUDE.md says "comment only when WHY is non-obvious" — the case structure is non-obvious here.
  - **minor**: `rawDiff` (line 261) caps at 6 lines. Magic number. Match it to `CONTEXT_LINES = 4` somehow (currently 4 vs 6 — different scales: CONTEXT_LINES is half-window, rawDiff is hard cap). Document why they differ.
- **Verdict**: **MUST be split.** This is the worst file-budget violation in the codebase. Also, the module-globals are testability debt.

---

## Cross-cutting

1. **Three ignore lists** (`scan.ts:DEFAULT_IGNORES`, `watch.ts:IGNORED`, `project-files.ts:IGNORE_DIRS`). Unify into `core/project/ignore.ts` exporting both array and regex form.
2. **Three "sort by folder then basename"** comparators across `file-tree.ts`, `conversations.ts`, `project-files.ts`. Pull into one helper.
3. **Two `projectsDirFor`** (`view/conversations.ts` and `server/api/projectInfo.ts`). One should import the other.
4. **`live.ts` is the only > 200-line file in the codebase** — must be split.
5. **`split.ts` (137 lines), `turns.ts` (119), `conversations.ts` (121), `live.ts` (267)** are the four files over the 100-line target. Only `live.ts` violates the 200-line hard limit.

The worst smell here is `live.ts`. Everything else is moderate cleanup.
