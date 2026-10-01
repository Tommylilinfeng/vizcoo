# Refactor: Tier as a first-class entity

Date: 2026-04-26

## Why

Currently `module.tier` is an integer attribute on each top-level module. This conflates two concepts:

- **Architecture layer** (the horizontal slab in 3D space, "tier 0 = bottom, tier N = top")
- **Module's position within a layer**

Consequence: empty tiers cannot exist (no module → no tier), users can't rename tiers independently, inserting a tier between two existing ones requires bulk updates to all modules ≥ the insert point.

The solution: **make tier a first-class row in its own table**. Modules reference a tier by FK. Tiers exist independently — empty tiers are real, named, persistent.

## User decisions (locked)

| Q | Decision |
|---|---|
| 1 | Tier names are **user-given (default no name)**. LLM does NOT name tiers. UI displays "tier N" until user renames. |
| 2 | Deleting a non-empty tier: **module becomes orphan** (`tier_id = NULL`). User must reassign or accept the unsorted state. |
| 3 | Modules without a tier (`tier_id IS NULL`): **allowed**. Rendered as "unsorted" region or simply not rendered as floors. |
| 4 | First run: LLM outputs N megas → create N tiers (position 0..N-1, no name) → link megas to tiers. |
| 5 | Split semantics unchanged: K new modules inherit original's `tier_id`. |

## Data model

### New table: `tiers`

```sql
CREATE TABLE tiers (
  id          INTEGER PRIMARY KEY,
  name        TEXT,                       -- nullable; user-given
  position    INTEGER NOT NULL UNIQUE,    -- 0 = bottom, larger = higher in 3D
  created_at  TEXT NOT NULL
);
```

`position` is dense by default but can become sparse if user deletes from middle (no automatic re-pack — preserves user mental model "tier 4 was here, I deleted it, gap remains"). We'll re-pack only when user explicitly hits "compact tiers" (V0.2).

Actually re-reading user's earlier request — they want sparse to be possible. So **position can have gaps**. Render sorts by position ASC.

### Modified table: `modules`

- Drop column `tier`
- Add column `tier_id INTEGER REFERENCES tiers(id)` (nullable)

Migration: for each existing module with `tier IS NOT NULL`, find-or-create a tier row with `position = tier`, then set `module.tier_id = found_tier.id`. Then drop `tier` column.

## Code surface

### Backend

| File | Change |
|---|---|
| `src/core/storage/schema.sql` | Add `tiers` table; replace `modules.tier` with `modules.tier_id` |
| `src/core/storage/db.ts` | Migration: create `tiers` table, populate from existing `modules.tier`, add `tier_id` column, copy values, drop `tier` |
| `src/core/modules/persist-aggregation.ts` | When inserting/updating mega rows: create or reuse tier row at position `i` (the array index from LLM); set `mega.tier_id = found_tier.id` |
| `src/core/modules/static-fallback.ts` | Same as above |
| `src/core/modules/split.ts` | When creating K new sibling modules: inherit `target.tier_id` |
| `src/core/server/api/tree.ts` | Return `tier_id` on each module; include `tiers` array in response: `{ modules: [...], tiers: [...] }` |
| `src/core/server/api/tiers.ts` (new) | `GET /api/tiers`, `POST /api/tiers`, `PATCH /api/tiers/:id`, `DELETE /api/tiers/:id` |
| `src/core/server/http.ts` | Register tier routes |
| `src/core/server/api/module-edit.ts` | `PATCH` body accepts `tierId` not `tier` |

### Frontend

| File | Change |
|---|---|
| `src/ui/api.ts` | `Module.tierId`; new `Tier` type; `fetchTree` returns `{ modules, tiers }`; helpers `createTier`, `patchTier`, `deleteTier` |
| `src/ui/arch/types.ts` | `ArchNode.tierId` not `tier` |
| `src/ui/arch/tree.ts` | Include `tierId` in built nodes |
| `src/ui/arch/layout.ts` | `layoutTree` takes `tiers: Tier[]` array; iterates by `tier.position`; for each tier, finds modules with `tier_id = tier.id`; **empty tiers still get a Z slot** (skeleton plate? or just empty space?). Empty tier rendering: show a thin translucent skeleton plate at that Z, no chips, name-only label. |
| `src/ui/arch/ArchScene.tsx` | Pass `tiers` prop; minor; tier label uses `tier.name ?? "tier N"` |
| `src/ui/MapView.tsx` | DetailPanel's tier UI:<br>• tier button group reads from `tiers` (not from module values)<br>• `[+] move to new tier above`, `[+] below` add tier rows + assign module<br>• "between X|Y" later (V0.2) |
| `src/ui/arch/SettingsPanel.tsx` | New section "Architecture Layers":<br>• list all tiers, sorted by position<br>• drag-reorder (changes `position`)<br>• rename (inline edit `name`)<br>• delete (warns if non-empty)<br>• `+ add` |

## Detailed migration

```sql
-- 1. Create tiers table
CREATE TABLE IF NOT EXISTS tiers (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  position    INTEGER NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

-- 2. Backfill: for each distinct tier value among current modules, create a tier row
INSERT INTO tiers (name, position, created_at)
  SELECT DISTINCT NULL, tier, datetime('now') FROM modules WHERE tier IS NOT NULL;

-- 3. Add tier_id column to modules (if not exists)
ALTER TABLE modules ADD COLUMN tier_id INTEGER REFERENCES tiers(id);

-- 4. Link existing modules to their tier rows
UPDATE modules
  SET tier_id = (SELECT id FROM tiers WHERE position = modules.tier)
  WHERE tier IS NOT NULL;

-- 5. Drop modules.tier (SQLite requires table rebuild)
-- handled in db.ts migrate function via the rebuild pattern
```

Note: SQLite doesn't support `DROP COLUMN` cleanly until 3.35, but better-sqlite3 ships SQLite ≥ 3.39, so `ALTER TABLE modules DROP COLUMN tier` works directly. Use that.

## API shapes

### `GET /api/tree`

```ts
{
  modules: [
    { id, name, displayName, description, parentId, tierId, origin, fileCount, ... }
  ],
  tiers: [
    { id, name, position }
  ]
}
```

### `POST /api/tiers`

Body: `{ position?: number, name?: string }`

If `position` not given, defaults to `max(positions) + 1` (top).
If `position` collides with existing, shift all `position >= given` by +1 first.
Returns `{ id, position, name }`.

### `PATCH /api/tiers/:id`

Body: `{ name?, position? }` — if position changes, may need to shift other tiers (or accept gaps).

### `DELETE /api/tiers/:id`

Body: optional `{ promoteOrphans?: number }` — if given, set all `module.tier_id = ?` to that tier id; if not, set to NULL.

Returns `{ orphaned: number }` — how many modules became unsorted.

## UI specifics

### DetailPanel tier section

Replaces the current button group:

```
Tier:
[ tier 0 ] [ tier 1 ] [ tier 2* ] [ Foundation ] [ tier 4 ]
                       ↑ current

Move to:
[ + new tier above ]  [ + new tier below ]
[ unset (orphan) ]
```

Tier buttons show `tier.name ?? "tier ${tier.position}"`. Click → `PATCH module { tier_id }`.
"+ new tier above" → `POST /api/tiers { position: currentTier.position + 1 }` (shifts higher tiers up), then `PATCH module { tier_id: newTier.id }`.
"+ new tier below" → similar, position = currentTier.position (shifts current and higher).
"unset (orphan)" → `PATCH module { tier_id: null }`.

### SettingsPanel "Architecture Layers" section

```
┌── Architecture Layers ──────────────────────┐
│  [+ add layer at top]                        │
│                                              │
│ ↕  pos 5   [Foundation     ]   3 modules  ✕ │
│ ↕  pos 4   [tier 4         ]   1 module   ✕ │
│ ↕  pos 3   [Core           ]   0 modules  ✕ │  ← empty, deletable
│ ↕  pos 2   [tier 2         ]   2 modules  ✕ │
│ ↕  pos 1   [Infrastructure ]   1 module   ✕ │
│ ↕  pos 0   [tier 0         ]   1 module   ✕ │
└──────────────────────────────────────────────┘
```

- `↕` drag handle: drag to reorder (updates `position`)
- name field: inline editable
- module count: live
- `✕` delete: if non-empty, warn ("3 modules will become unsorted"); proceed sets their `tier_id = NULL`

## Empty-tier rendering

When a tier has no modules:
- Skeleton plate: thin (5px thick), translucent, dashed outline
- Label: tier name (or "tier N")
- 50% opacity to fade into background
- Click → opens a "drop module here" target (V0.2 with drag-drop)

For now (no drag-drop), empty tier just renders as a dashed plate with label. User can move modules to it via DetailPanel.

## Phases

### Phase 1 — Schema + migration (30 min)
1. `schema.sql`: add `tiers` table, replace `modules.tier` with `modules.tier_id`
2. `db.ts`: migration steps
3. Restart vizcoo against an existing large-repo DB; verify migration ran clean
4. `sqlite3` inspect: confirm tiers table populated, modules.tier_id linked

### Phase 2 — Backend logic (1 hour)
5. `persist-aggregation.ts`: on first aggregate, create tiers; on subsequent, reuse tiers by position
6. `static-fallback.ts`: same
7. `split.ts`: inherit tier_id from target
8. `module-edit.ts`: accept `tierId` instead of `tier`
9. `api/tiers.ts`: CRUD endpoints
10. `api/tree.ts`: return tiers array
11. Test with curl: re-aggregate, split, edit; check tier_id propagates

### Phase 3 — Frontend types + layout (1 hour)
12. `ui/api.ts`: types, fetchers
13. `arch/types.ts`: ArchNode.tierId
14. `arch/tree.ts`: include tierId
15. `arch/layout.ts`: take tiers prop, iterate by position, render empty-tier skeleton
16. `arch/ArchScene.tsx`: pass tiers, render tier name
17. `MapView.tsx`: pass tiers to ArchScene + DetailPanel

### Phase 4 — DetailPanel tier section (45 min)
18. Replace button group with tier-aware version
19. "+ new tier above" / "+ below" / "unset" actions
20. Visual: highlight current tier, show name

### Phase 5 — SettingsPanel architecture layers (45 min)
21. New section "Architecture Layers" with list
22. Inline rename
23. Drag-reorder (use a simple HTML5 drag handle, position swap on drop)
24. Delete with confirmation
25. Add new

### Phase 6 — Verify (15 min)
26. Restart vizcoo, run regression tests
27. Manual: create empty tier, rename, drag to reorder, verify Map renders
28. Manual: split a module, verify K siblings inherit tier
29. Manual: delete non-empty tier, verify modules become orphan + UI handles

**Total: ~4-5 hours**

## Risks / open questions

- **Position uniqueness vs sparse**: I declared `UNIQUE` on `tiers.position` but need sparse positions allowed. The constraint just means no two tiers share a position. Sparse (gaps) is fine. Drop UNIQUE if it causes friction; deduplicate at INSERT-time if needed. Decision: **keep UNIQUE, gaps allowed** (insert handles shifts).
- **Drag reorder with locked rows**: not relevant — locked is on modules, not tiers. Tier ops are unaffected.
- **Cache replay (aggregate_result JSON)**: when LLM cache replays, it expects a fixed mega→tier mapping. If user manually deleted a tier between runs, the replay needs to handle "tier doesn't exist anymore" — fall back to creating it.
- **Drag-drop tier reorder UI**: I'll use HTML5 drag-and-drop on the SettingsPanel list (not 3D drag). Simpler. The 3D Map doesn't support drag yet.

## Out of scope

- Drag-drop modules between tiers in the Map view itself (P2 task)
- Tier-level metadata beyond name (description, color, etc.) — V0.2
- Auto-naming tiers based on contents — V0.2
- "Compact tiers" button to remove gaps — V0.2

## Done means

- [ ] schema migrated cleanly on an existing large-repo DB
- [ ] tiers table has 6 rows after first aggregate
- [ ] DetailPanel shows tier buttons that read tier names from tiers table
- [ ] SettingsPanel has "Architecture Layers" section with rename/delete/add/reorder
- [ ] Creating an empty tier persists across restart
- [ ] Renaming a tier persists across restart
- [ ] Empty tier renders as skeleton plate in Map (or hidden, depending on Phase 3 detail)
- [ ] Splitting a module: K siblings end up in the same tier
- [ ] regression tests pass (test:map-nav, test:settings)
