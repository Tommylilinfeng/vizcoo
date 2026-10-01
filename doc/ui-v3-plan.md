# vizcoo UI v3 Plan

Refining v2 with the design philosophy in `doc/ui-design-philosophy.md`. The
mandate is wholeness over local optimization. Everything below is filtered
through companion / glanceability / less-but-better / opinion / patterns / wholeness.

## Layout

Three columns, no top bar.

```
┌──────────────┬──────────────────────────────────┬───────────────────┐
│   Sidebar    │            Stage (3D)            │     Timeline      │
│   240 px     │              flex                │      360 px       │
└──────────────┴──────────────────────────────────┴───────────────────┘
```

Three orthogonal axes:
- Sidebar = **identity** (project, conversations, settings)
- Stage = **space** (project's spatial state, glanceable peripheral display)
- Timeline = **time** (turn-by-turn temporal log, terminal-style auto-tail)

## Sidebar (240 px expanded · 40 px collapsed)

Expanded, top to bottom:

```
┌──────────────────────────┐
│ V  my-blog            ‹  │   project identity
│ ● live                   │   project-level status (dot + text)
│ ────                     │
│ CONVERSATIONS            │
│ ◉ add dark mode          │   selected = bold + ring
│   viewing turn 5         │     subtitle when reviewing
│ ─ refactor schema        │
│   18t · 1d ago           │
│ ...                      │
│ ────                     │
│ ⚙ Settings               │
└──────────────────────────┘
```

Collapsed:
```
┌──┐
│ V│
│ ●│   single status dot (green=live / yellow=hooks-bad / grey=idle)
│  │
│ ⚙│
│ ›│
└──┘
```

Status dot meaning (project-level):
- **green** — at least one conversation is alive AND hooks installed
- **yellow** — hooks not installed (or port mismatch)
- **grey** — hooks ok, no alive conversations

Project identity row click → copy project path to clipboard (briefly shows "copied").

## Stage (flex, screenfit)

3D drawer cabinet, unchanged in internals.

The user explicitly excluded stage internals from this redesign. We only
remove the right-top "● LIVE" badge that was proposed for v2 — its function
is already conveyed by sidebar status dot + plate motion + timeline header.

Reviewing-state indicator and "back to live" affordance moved to Timeline
(see below).

Hover diff card unchanged.

## Timeline (360 px, new component)

```
┌────────────────────────────┐
│ "add dark mode toggle"     │   sticky header
│ ● live · 23 turns          │
├────────────────────────────┤
│ viewing turn 5  back live →│   reviewing banner (only when reviewing)
├────────────────────────────┤
│ TURN 1            3f       │   card
│ "理解一下这个 project"      │
│ Header.tsx App.tsx +1      │
│                            │
│ TURN 2            0f       │
│ "测试一下"                  │
│                            │
│ ...                        │
│                            │
│ ↓ tail                     │
└────────────────────────────┘
```

Sticky header:
- Conversation title in quotes
- Status dot + status text + turn count

Cards:
- Header line: `TURN N` + file count (e.g. `5f`)
- User prompt truncated to ≤40 chars (no show-more — terminal handles long text)
- File chip row: basename + edit/write color; truncate to 4 chips + `+N`
- No Claude long replies (companion principle)

Auto-tail behavior (terminal style):
- Default: scrolled to bottom; new turns appended → keep at bottom
- User scrolls up >30px → unlock; position fixed
- User scrolls back to bottom → re-engage tail

Reviewing banner:
- Appears only when `selectedTurnIndex !== null`
- "viewing turn N" + "back to live →" link
- "back to live →" calls `selectTurn(null)`

Card click → selectTurn(N), enter reviewing.

## Settings Modal (cleanup, not rewrite)

Cuts:
- "View · 视觉 — Coming in v2" placeholder (no future promises)
- Map placeholder (not a V1 concept)

Keeps unchanged:
- Project metadata, Hooks (with show-config collapsed by default), Sessions storage, version footer.

## Empty / error states

When `conversations.length === 0` (no claude conversations under this project):
- Stage shows centered card: project basename + "No conversations yet — `cd ${root} && claude` in another terminal."
- If hooks not installed, the card adds a yellow line: "Hooks not installed — install hooks first" with an install button.

When sidebar is collapsed AND hooks not installed:
- Sidebar collapsed dot is yellow, ensuring visibility.

## Wholeness checks (from philosophy doc §4)

| State | Sidebar | Stage | Timeline |
|---|---|---|---|
| current conversation | bold ring | files rendered | sticky header title |
| live activity | top dot green | plate motion | header dot |
| reviewing turn N | "viewing turn N" subtitle on conv item | plates narrowed | reviewing banner |
| hooks broken | top dot yellow | empty-state line | (none — sidebar covers it) |

Attention budget at any moment: only one motion source.
- Live: plate flying = focal motion. Sidebar dot static. Timeline static.
- Reviewing: no motion. User is in slow cognition.
- Hooks broken: yellow dot static.

## Component graph

Modify:
- `src/ui/Sidebar.tsx` — restructured: project identity at top, no Map/View nav, no nested TurnList, no bottom stats
- `src/ui/App.tsx` — three-column layout (sidebar | stage | timeline); always shows view; settings as modal
- `src/ui/view/ConversationList.tsx` — drop nested TurnList; add "viewing turn N" subtitle
- `src/ui/view/ViewScene.tsx` — keep, ensure no LIVE badge
- `src/ui/SettingsModal.tsx` — remove placeholders
- `src/ui/view/EmptyState.tsx` — add hooks fallback message

New:
- `src/ui/view/Timeline.tsx` — sticky header + scroll auto-tail + cards + reviewing banner

Delete:
- `src/ui/view/TurnList.tsx` — replaced by Timeline cards

Keep but no longer routed:
- `src/ui/MapView.tsx` — preserved for V2 reintroduction

## Implementation order (one pass, end-to-end)

1. Sidebar.tsx — rewrite (expanded + collapsed)
2. ConversationList.tsx — drop TurnList; add reviewing subtitle
3. delete TurnList.tsx
4. Timeline.tsx — new (sticky header, cards, auto-tail, reviewing banner)
5. EmptyState.tsx — add hooks fallback
6. SettingsModal.tsx — cut placeholders
7. App.tsx — three-column wiring + project + hooks fetch
8. tsc + vite build
9. Run all tests; update assertions where layout/behavior changed
10. Restart server, smoke test in headless

## Test impact

Existing tests likely affected:
- `test:settings` — looks for "Settings" aria-labeled button. Still present.
- `test:turns` — uses `selectTurn` directly via window store. Unaffected.
- `test:view`, `test:hover`, `test:view-live` — don't touch sidebar; should pass.

Anticipated update:
- Possibly tighten `test:settings` to assert no Map placeholder text.
