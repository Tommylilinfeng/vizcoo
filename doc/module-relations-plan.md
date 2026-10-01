# Module Relations Plan

Curated, AI-summarized relationships between **top-level modules** on the Map. Replaces the file-level edge spaghetti as the default visual, while keeping file edges as evidence for "drill in" later.

Decided 2026-04-26 (with user). Built on top of the hover-expand model.

---

## 1. Goal

For ~6 top-level modules, draw at most one **labeled line per pair** that explains in plain language how they relate. Non-tech users should be able to scan the Map in 5 seconds and answer "how does this codebase fit together at a high level?".

## 2. Design

### 2.1 Schema

New table `module_relations` (in `src/core/storage/schema.sql`):

```sql
CREATE TABLE module_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_a_id INTEGER NOT NULL,    -- canonical: smaller id always in a
  module_b_id INTEGER NOT NULL,
  direction TEXT NOT NULL,         -- 'a_to_b' | 'b_to_a' | 'both' | 'shared'
  category TEXT NOT NULL,          -- 'depends' | 'shares' | 'observes' | 'contracts'
  label TEXT NOT NULL,             -- ≤6 words, human-readable
  summary TEXT NOT NULL,           -- 1–2 sentences, hover tooltip
  evidence_files TEXT NOT NULL,    -- JSON array of file paths
  fingerprint TEXT NOT NULL,       -- hash of input snapshot
  fingerprint_current TEXT,        -- recomputed each load; null until first sync
  manual_override INTEGER NOT NULL DEFAULT 0,  -- 1 if user edited label/direction
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(module_a_id, module_b_id),
  FOREIGN KEY (module_a_id) REFERENCES modules(id) ON DELETE CASCADE,
  FOREIGN KEY (module_b_id) REFERENCES modules(id) ON DELETE CASCADE
);
```

`fingerprint` = sha256 of the input that was used to generate this row.
`fingerprint_current` = sha256 of the **current** snapshot, recomputed every time vizcoo refreshes module structure. If they differ → the relation is **stale**.

### 2.2 Fingerprint formula

For a pair (A, B):
```
fingerprint = sha256(
  sorted(A.file_paths) + '|' +
  sorted(B.file_paths) + '|' +
  sorted(cross_edges_between_A_and_B)
)
```

`cross_edges` = file-level edges where source ∈ A and target ∈ B (or vice versa). Already in `edges` table.

### 2.3 Generation (LLM call, one per pair)

Per-pair LLM call. Provider = existing `claudeCliProvider`.

**Input given to model:**
- Module A: `{ id, name, displayName, description, file_count, top 5 files by edge degree }`
- Module B: same shape
- Cross edges: `[{ from_file, to_file, kind: 'import' | 'call' | 'extends' }]` (top 20 by frequency)

**Required output (JSON, schema-validated):**
```json
{
  "direction": "a_to_b" | "b_to_a" | "both" | "shared",
  "category": "depends" | "shares" | "observes" | "contracts",
  "label": "frontend renders model output",
  "summary": "Module A consumes structured events emitted by B's WebSocket broadcaster, then renders them as DOM updates.",
  "evidence_file_paths": ["src/ui/api.ts", "src/core/server/ws.ts"]
}
```

If the LLM returns `category: "none"` (no meaningful relationship), the row is **not** inserted — no line is drawn for that pair.

### 2.4 Staleness — the user's explicit constraint

**Vizcoo never auto-reruns** the LLM after the first cold start. When module structure changes (split / merge / file reassignment / re-analyze):

1. Recompute `fingerprint_current` for every existing relation row.
2. Update `fingerprint_current` in DB.
3. **Do not regenerate.** The line stays drawn with its old label.
4. UI shows a **stale badge** (small `↻` glyph at the line midpoint, dimmer color) for any pair where `fingerprint != fingerprint_current`.
5. User clicks the badge (or a top-corner banner "3 relations need refresh") → triggers regeneration for stale pairs only.

**Rationale (the user's point):** top-level architectural relationships are stable across most file changes. Cheap function-level edits shouldn't burn LLM budget or change the visual every refresh. The user decides when re-analysis is worth it.

### 2.5 Pre-filter (no LLM call needed)

Before any LLM call, the orchestrator computes:
- `pairs_with_zero_cross_edges` → no relation at all, never inserted.
- For 6 modules = 15 pairs, after filter typically **5–8 pairs need LLM**.

Cold start ≈ 5–8 sequential LLM calls. ~20 seconds total for the user's project.

### 2.6 Where relations live in the UI

Relations are **only drawn between top-level (root) modules** on the Map.

- **Default (nothing hovered):** Map shows top-level boards only. Lines = relations. File-level edges are hidden.
- **Hover-expanded board:** that board reveals its inner chips; **file-level edges within that board** become visible (existing behavior). Relation lines to other top-level boards stay drawn.
- **Click on a relation line:** shows the summary in a side panel; lists evidence_files; offers "regenerate this relation" button.
- **Manual override:** double-click the label to edit. Sets `manual_override=1`. Regeneration skips this row unless user explicitly clicks "force regenerate".

## 3. API surface

```
GET  /api/relations
  → { relations: [...], stale_count: N, pending_first_sync: bool }

POST /api/relations/sync
  body: { force?: boolean }
  → recomputes fingerprint_current for all pairs, returns { stale_count, generated_count? }
  Without force: only updates fingerprint_current and stale flag.
  With force=true: regenerates all stale pairs.

POST /api/relations/regenerate
  body: { pair_ids?: number[] }   // omit = all stale
  → runs LLM for specified pairs, returns updated relations

PATCH /api/relations/:id
  body: { label?, summary?, direction?, category? }
  → manual edit, sets manual_override=1
```

The `sync` endpoint is called automatically on `/api/re-analyze` and after every split/merge — but **only updates the staleness marker**, never spends LLM budget.

## 4. Phased build

### Phase 1 — schema + storage layer (1 hr)
- Add `module_relations` table, migration script.
- `src/core/relations/store.ts`: CRUD wrapping the table.
- `src/core/relations/fingerprint.ts`: sha256 computation from modules + edges.
- Done when: fingerprint of a synthetic pair is deterministic + reproducible.

### Phase 2 — generation pipeline (2 hr)
- `src/core/relations/generate.ts`: takes (A, B, cross_edges, ai_provider) → returns parsed JSON.
- Schema-validate LLM output. Throw on malformed (no silent fallback per CLAUDE.md).
- `src/core/relations/sync.ts`: orchestrator with two modes (`mark` / `regenerate`).
- Done when: running `sync({force:true})` on the vizcoo project produces 5–8 valid rows.

### Phase 3 — HTTP API (30 min)
- 4 endpoints in `src/core/server/api/relations.ts` (under 50 lines each).
- Wire into `http.ts`.

### Phase 4 — Map render (2 hr)
- `src/ui/arch/relations-layer.tsx`: replaces current `EdgesLayer` for top-level rendering.
- For each relation, draw a quad-curve from board center A to board center B.
- Color by `category` (depends=blue, shares=green, observes=amber, contracts=violet).
- Direction arrow at the midpoint when not 'shared'.
- Label rendered above the curve apex (small typography, chip-like background).
- Stale badge: `↻` glyph next to label when `fingerprint != fingerprint_current`.
- `EdgesLayer` keeps rendering, but only inside the currently-hover-expanded board.

### Phase 5 — sidebar + interactions (1.5 hr)
- Click a relation line → opens existing right-side panel (or new lightweight overlay) with summary + evidence_files list.
- Double-click label → inline edit + PATCH.
- "Regenerate this" + "Regenerate all stale" buttons.

### Phase 6 — auto-sync hooks (30 min)
- After `/api/re-analyze`, after split, after merge, after module-create/delete: call `sync({force:false})` to update stale flags.
- After successful split/merge, also delete relations whose endpoints no longer exist as top-level modules (cascade should handle, but verify).

### Phase 7 — first-run banner (30 min)
- If table is empty on Map load: show banner "No module relationships analyzed yet — [analyze now]" → triggers first sync with force=true.
- Progress indicator while LLM calls run (5–8 calls × ~3s each).

**Total: ~8 hours** assuming the existing `claudeCliProvider` works.

## 5. Out of scope (V1)

- Pair-level chat (drill into details with LLM Q&A) — V1.x.
- Tech-doc extraction (function signatures, API contracts) — V1.x; static analysis layer.
- Showing relations between **non-top-level** modules (e.g. inside an expanded board) — V1 only top-level.
- Auto-rerun on structural change — explicitly forbidden by user.
- Showing "new pair" auto-generation when split creates new pairs — even those need user trigger; they appear as "stale: not yet analyzed" until clicked.
- Multi-language relation aggregation — V1 only TS/JS edges.

## 6. Open design questions

1. **Direction arrow style** — proposed: small triangle at midpoint, color = relation color. OK?
2. **Where does the regenerate button live** — line midpoint badge, sidebar panel, or top-corner "N stale, refresh all"? Probably all three.
3. **What if the user's Claude Code is offline** — the sync just no-ops with a "couldn't reach AI" toast? Yes, fail soft on user-triggered sync; never retry silently.
4. **Color palette tuning** — 4 categories × 1 color each. Any color clash with existing tier palettes? Pick desaturated tones to differentiate from tier blocks.

Decided: pre-filter zero-edges pairs (no LLM call). Decided: never auto-rerun. Decided: relations only at top level.
