# Turn Summary Chips Plan

Live, module-local "what is Claude doing right now" summaries. Each top-level module gets a small chip on the Map showing the **purpose** of the file changes happening to it, derived from CC hook events + LLM. Replaces the file-level fly-over noise we hid earlier.

Decided 2026-04-27 with user.

---

## 1. Goal

Non-tech user looks at the Map mid-CC-turn and reads "UI Surface — refactoring components to use new context" instead of "MapView.tsx, Sidebar.tsx, App.tsx changed". The chip updates as more files in the same turn get edited (streaming feel via PreToolUse pending detection, not arbitrary timers).

## 2. Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Prompt fidelity | file paths + diff snippet (200 chars before/after) |
| 2 | Tools tracked | Edit / Write / MultiEdit only (no Bash, no Read) |
| 3 | Multi-turn module reuse | replace (latest turn wins per module) |
| 4 | Persistence | DB-backed (`module_turn_summary` table) |
| 5 | Chip default | always visible, low-contrast |
| 6 | Chip length | 1 sentence ≤ ~25 字, hover for full |
| 7 | Settled chips | disappear from Map on next turn, settle into Timeline |
| 8 | LLM fallback | "N files changed: a.ts, b.ts" if generation fails |
| 9 | Chip click | small popover with full summary + file list (not full sidebar) |
| 10 | External files (`~/.claude/`, etc.) | ignore |
| 11 | LLM call shape | parallel per affected module, each call given a one-line "co-touched modules" context hint |
| 12 | Trigger | PreToolUse counter + 800ms post-PostToolUse debounce + Stop hook force-flush |

## 3. Architecture

```
CC                                            vizcoo server
 │                                              │
 │── PreToolUse hook (Edit/Write/MultiEdit) ──→ orchestrator: pending++
 │── PostToolUse hook ─────────────────────────→ orchestrator: pending--, queue change
 │                                              │   if pending == 0 → schedule 800ms flush
 │── PreToolUse arrives during debounce ───────→ cancel scheduled flush
 │── Stop hook ────────────────────────────────→ force flush (finalize=true)
 │                                              │
 │                                              ↓ flush:
 │                                              ├── group queued changes by module
 │                                              ├── for each affected module: parallel LLM call
 │                                              │     prompt: "files X,Y,Z were modified with these diffs.
 │                                              │              Other modules touched in same batch: A, B.
 │                                              │              Output 1 sentence purpose for THIS module only."
 │                                              ├── upsert into module_turn_summary
 │                                              └── broadcast { type: 'turn-summaries-updated' }

Browser                                         server
 │                                              │
 │── WebSocket: turn-summaries-updated ─────── (via existing /ws)
 │── refetch: GET /api/turn-summaries/current ─→ returns latest summary per module
 │── render TurnSummaryChips on Map             │
```

## 4. Schema

```sql
CREATE TABLE IF NOT EXISTS module_turn_summary (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,        -- CC session id from hook payload
  turn_index    INTEGER NOT NULL,     -- monotonic counter per session
  module_id     INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  summary       TEXT NOT NULL,        -- the 1-sentence purpose
  file_paths    TEXT NOT NULL,        -- JSON array, paths affected this turn
  finalized     INTEGER NOT NULL DEFAULT 0,  -- 1 once Stop hook has fired
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(session_id, turn_index, module_id)
);

CREATE INDEX IF NOT EXISTS idx_turn_summary_recent
  ON module_turn_summary(module_id, turn_index DESC);
```

**Live chip query** = "latest summary per module across all sessions":
```sql
SELECT s.* FROM module_turn_summary s
WHERE s.id IN (
  SELECT MAX(id) FROM module_turn_summary GROUP BY module_id
);
```

## 5. State machine (in-memory)

`src/core/turn-summaries/state.ts` holds a single `TurnTracker` per process:

```ts
class TurnTracker {
  private pendingTools = 0
  private currentTurnIndex = new Map<sessionId, number>()
  private queuedChanges = new Map<sessionId, Map<modulePath, FileChange[]>>()
  private flushTimer: NodeJS.Timeout | null = null

  onPreToolUse(event) { pendingTools++; cancelFlush() }
  onPostToolUse(event) {
    pendingTools--
    queueChange(event)
    if (pendingTools === 0) scheduleFlush(800)
  }
  onStop(event) { cancelFlush(); flushNow(finalize=true) }

  private flushNow(finalize) { /* call orchestrator */ }
}
```

Turn index management: bumped each time we observe a `UserPromptSubmit` hook (which fires at the start of every user turn). Persisted in `meta` table per session_id.

## 6. LLM call

`src/core/turn-summaries/summarize.ts`:

```ts
async function summarizeModuleSlice(opts: {
  ai: AIProvider,
  module: ModuleSnippet,
  filesInThisModule: FileChange[],
  coTouchedModuleNames: string[],
  model?: string,
}): Promise<string>
```

Prompt template:
```
The user is running Claude Code on a TypeScript project. Claude just made changes to module "{module_name}" — {description}.

Files changed in this module:
  - {file_path_1}
    diff snippet (truncated):
    {first_200_chars_of_diff}

  - {file_path_2}
    ...

Other modules also being touched in this same batch: {co_touched_names}

Write ONE Chinese sentence (≤25 characters) summarizing what Claude is trying to accomplish in MODULE "{module_name}" specifically. Mention cross-module collaboration only if it's clearly relevant. Plain language for a non-technical reader. No file names, no jargon.

Output the sentence directly, nothing else.
```

Parallel `Promise.all` over affected modules. Each call independent. Failures fall back to "N files changed: a.ts, b.ts".

## 7. API surface

```
GET  /api/turn-summaries/current
  → { summaries: [{ module_id, summary, file_paths, finalized, updated_at }] }
  Returns one row per module (latest seen).

GET  /api/turn-summaries/by-turn?session_id=X&turn_index=N
  → { summaries: [...] }
  For Timeline integration — fetch all summaries from a specific turn.
```

## 8. UI

### `TurnSummaryChips.tsx` (new, ~120 lines)

- Mounted inside `ArchScene` SVG, on top of all module boxes
- For each `topLevelScreen.get(moduleId)`, render a chip if there's a summary for that module
- Chip = small rounded rect with text, positioned ~30px above the module's top-face center in screen coords
- Animated transitions:
  - New summary: fade in
  - Updated summary (text changed): brief 0.5s border pulse + cross-fade text
  - Settled (next turn touched a different module, or user dismissed): fade out

### `TurnSummaryPopover.tsx` (new, ~60 lines)

- Triggered on chip click
- Floating panel, anchored near the chip
- Shows full summary (no length truncation), file list (clickable to copy path), "from turn N", finalized status
- Click outside → close

### Stage hook (in MapView)

- Subscribe to `/ws` message `type === 'turn-summaries-updated'`
- Refetch `/api/turn-summaries/current`
- Pass to `<ArchScene>` as new prop `turnSummaries`
- ArchScene passes to `TurnSummaryChips`

## 9. Phased build

### Phase 1 — schema + store + state machine (2h)
- `module_turn_summary` table + migration
- `src/core/turn-summaries/store.ts` (CRUD, ~80 lines)
- `src/core/turn-summaries/state.ts` (TurnTracker class, ~120 lines)
- Unit test for state machine: feed a sequence of hook events, verify flush timing

### Phase 2 — LLM summarize (1.5h)
- `src/core/turn-summaries/summarize.ts` with prompt builder + parallel runner (~80 lines)
- Mock-AI test: 3 modules, 5 files → 3 parallel calls → 3 summaries
- Failure mode test: AI returns garbage → fallback string

### Phase 3 — orchestrator + hook wiring (2h)
- `src/core/turn-summaries/orchestrator.ts` (~100 lines)
- Modify `route-handlers.ts handleHook` to dispatch into TurnTracker
- Capture sessionId from hook payload (it's there)
- Trigger broadcast `{ type: 'turn-summaries-updated' }` after each flush
- End-to-end test: simulate hook events via curl → DB rows appear

### Phase 4 — API + frontend fetch (1h)
- 2 endpoints in `src/core/server/api/turn-summaries.ts`
- `src/ui/api.ts`: types + fetch helpers
- MapView state: `turnSummaries`, refetch on WS event
- ArchScene accepts new prop, passes through

### Phase 5 — chip render + lifecycle (3h)
- `TurnSummaryChips.tsx` — SVG chips at module screen positions
- Animations: enter, update, exit
- Z-ordering: chips on top of relations and module boxes

### Phase 6 — popover + Timeline integration (2h)
- `TurnSummaryPopover.tsx` for click detail
- Timeline cards: when turn finalizes, fetch summaries via `by-turn` and render under each turn card

**Total: ~11 hours**

## 10. Out of scope (V1.x)

- Chip drag/reposition (auto-placement only)
- Per-file purpose breakdown (only module-level)
- Edit chip text inline (LLM-only)
- Cross-session aggregation ("last 5 turns total")
- Diff visualization (just the summary, not the actual changes)
- Bash command summaries
- Read tool tracking

## 11. Open uncertainties (will surface during build)

- **Hook payload schema** — need to confirm `sessionId`, `tool_name`, `file_path`, `tool_input` shapes. Already partially wired in `handleHook`; will inspect Phase 3.
- **Turn boundary detection robustness** — Stop hook is reliable; UserPromptSubmit detection for turn_index increment is the riskier signal. Fallback: if a flush sees a much higher pendingTools count after Stop, assume we missed UserPromptSubmit and bump anyway.
- **Module assignment for newly-created files** — if CC writes a brand-new file, vizcoo's `files` table doesn't have it yet (until next index pass). Need a heuristic: match by directory prefix to existing module's file list. If no match → drop into "unassigned" group (no chip).
- **Diff snippet extraction for MultiEdit** — MultiEdit has `edits[]`; concatenate first 200 chars of each `old_string`/`new_string` pair, capped at total 1KB.
