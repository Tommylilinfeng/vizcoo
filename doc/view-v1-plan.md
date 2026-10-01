# View V1 — Plan

The **View** is vizcoo dashboard's second top-level feature (sibling to **Map**). V1
replays a JSONL session fixture into a 3D scene where each file is a node that
pulses when Claude edits it. Zero live-CC dependency; proves the stack end-to-end.

## Contracts

### ViewEvent (`src/core/view/types.ts`)

```ts
interface ViewEventBase { timestamp: number; sessionId: string; toolUseId: string }
interface EditEvent  extends ViewEventBase { kind: 'edit';  filePath: string; linesBefore: number; linesAfter: number }
interface WriteEvent extends ViewEventBase { kind: 'write'; filePath: string; lines: number }
type ViewEvent = EditEvent | WriteEvent
```

V1.1 will widen the union with `think | text | read`. Consumers must default-ignore
unknown kinds.

### JSONL schema consumed (Anthropic format, read-only)

Lines with `type === 'assistant'`. From each:
- `timestamp` (ISO → ms), `sessionId` (string)
- `message.content[]` entries where `type === 'tool_use'` and `name ∈ {Edit, Write, MultiEdit}`:
  - Edit: `input.{file_path, old_string, new_string}` → `linesBefore/After = split('\n').length`
  - Write: `input.{file_path, content}` → `lines = split('\n').length`
  - MultiEdit: `input.{file_path, edits[]}` → collapse to single `'edit'` with summed line deltas

### HTTP

- `POST /api/view/replay` — body `{ fixture: string, speed?: number }` → `202 { jobId, eventCount, firstTimestamp }`. Starting a new replay cancels any in-flight one.
- `POST /api/view/replay/stop` — body `{ jobId? }` → `200 { stopped: number }`

`fixture` resolves under `fixtures/session-replay/`. Absolute paths rejected.

### WebSocket (existing `/ws`)

```ts
type WsMessage =
  | { type: 'hello' }                // existing
  | { type: 'update' }                // existing, Map re-fetch trigger
  | { type: 'view-start'; jobId: string; eventCount: number; firstTimestamp: number }
  | { type: 'view-event'; jobId: string; event: ViewEvent }
  | { type: 'view-end';   jobId: string; reason: 'completed' | 'stopped' | 'error' }
```

### Frontend store (Zustand, `src/ui/view/viewStore.ts`)

```ts
interface FileNodeState { filePath: string; lastTouchMs: number; intensity: number; totalEvents: number; lastKind: 'edit' | 'write' }
interface ViewStore {
  files: Map<string, FileNodeState>
  replay: { jobId: string; eventCount: number; emittedCount: number; firstTimestamp: number } | null
  onWsMessage(msg: WsMessage): void
  tick(dtMs: number): void         // called each r3f frame; exp-decays intensity
}
```

## Decisions (baked in)

- **Backward compat:** ViewEvent without `turnId` in V1; add later as optional.
- **MultiEdit** collapses to a single `'edit'` event with summed line deltas.
- **filePath** stays absolute on the wire; UI displays `path.basename`.
- **Replay speed:** default 300× real time (a 22-hour session → ~4 minutes). Configurable per request.
- **Single active replay.** Starting a new one cancels the old.
- **Layout:** hash-grid (fnv1a of filePath → XY cell). Not module-clustered in V1.
- **Decay:** `intensity *= exp(-dt / DECAY_TAU_MS)`. Event sets `intensity = 1.0` (replace, not accumulate).
- **Visual V1:** scale + emissive only. No bloom, DoF, content ghost, camera motion.

## Tunables (one constants file per layer, no inline magic numbers)

- `src/core/view/constants.ts` — `DEFAULT_SPEED = 300`, `FIXTURES_DIR` relative path
- `src/ui/view/scene-constants.ts` — `DECAY_TAU_MS = 1500`, `GRID_SIZE = 20`, `GRID_SPACING = 1.5`, base/active scale, color palette

All numeric / color choices live in these two files. No magic numbers in components.

## File budget

| File | ~lines |
|---|---|
| `core/view/types.ts` | 25 |
| `core/view/constants.ts` | 10 |
| `core/view/jsonl-events.ts` | 60 |
| `core/view/replay.ts` | 50 |
| `core/server/api/replay.ts` | 45 |
| `core/server/http.ts` diff | +8 |
| `core/server/ws.ts` | unchanged (generic) |
| `ui/view/scene-constants.ts` | 20 |
| `ui/view/viewStore.ts` | 70 |
| `ui/view/layout.ts` | 20 |
| `ui/view/FileNode.tsx` | 40 |
| `ui/view/ViewScene.tsx` | 45 |
| `ui/Sidebar.tsx` | 40 |
| `ui/App.tsx` diff | +25 |

All within the two-minute rule.

## Order of work

1. `types.ts`, `constants.ts`, `jsonl-events.ts`, `replay.ts` — backend parsing/playback, no HTTP yet
2. `scripts/dump-events.ts` — local smoke test for steps above
3. `api/replay.ts` + wire into `http.ts` + pass broadcaster via `ServerConfig`
4. Smoke test: `curl POST` + `wscat` watches `/ws`
5. (stop here, confirm before UI) `viewStore`, `layout`, r3f components, sidebar, App routing

Phases 1–4 run to completion before stopping. Phase 5 expects visual iteration, so
each sub-step reports back.

## Out of scope (V1.1+)

- Proxy mode / token-level streams / thinking animation — V1.1
- Read / Bash / any non-file-edit events — V1.2+
- Module-clustered layout, bloom, DoF, content ghost — post-V1 polish
- Live hook wiring — V1.1 (the replay event shape is already the hook shape)
- Event-log text sidebar — V2
- Multi-session, timeline scrubber, any interactivity — V2
