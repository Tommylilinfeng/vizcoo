# Embed-Terminal Plan

vizcoo absorbs the live `claude` TUI into its own window via PTY + xterm.js, so a single browser tab contains both the structured visualizations (drawer-cabinet, timeline, map) and the CC terminal itself. Hooks remain the structured side-channel for visualization联动; the terminal panel is the user's actual input/output surface.

Pivot decided 2026-04-26 (see `memory: project_view_embedded_terminal`).

---

## 0. Decisions

**Resolved 2026-04-26:**
- **D1 = L1-variant: terminal replaces Stage; Map kept.** Final layout: `Sidebar | Map | Terminal | Timeline`. Stage/drawer-cabinet is removed from the main view (or becomes a Map tab later if needed).
- **D2 = B (V1):** CLI launches → forks to background daemon → menubar icon for lifecycle. Tauri/Electron deferred.
- **D3 = `which claude` discovery, install prompt on miss.** Confirmed.

Original options preserved below for reference.

### D1. Layout — where does the terminal panel live?

Current 3-column: `Sidebar | MapView + Stage | Timeline`.

| Option | What it looks like | Trade-off |
|---|---|---|
| **L1. Stage-replaces-Map** | Stage and MapView become tabs; terminal panel takes the right half full-height | Map disappears unless tab-switched; least intrusive |
| **L2. Stage-shares-with-terminal** | Right-of-sidebar splits vertically: top = Stage (3D), bottom = terminal | Stage gets squeezed; terminal panel only ~40% height |
| **L3. Four columns** | Sidebar \| Map \| Stage \| Terminal+Timeline merged | Each column < 400px on a 1440 screen — terminal too narrow for CC's TUI |
| **L4. Terminal-as-primary** | Terminal panel becomes the main center; Map/Stage tucked into a collapsible drawer; Timeline unchanged on the right | Reframes vizcoo around the terminal — most aligned with the pivot's spirit |

**Recommended: L4.** The pivot says vizcoo wraps the terminal; the layout should reflect that. Map + Stage are slow-cognition surfaces (peripheral); terminal is the fast-cognition surface (active input). Putting terminal in the middle and viz in a drawer matches user attention reality. **Need confirmation before proceeding.**

### D2. Launch model

| Option | UX | Cost |
|---|---|---|
| **A. CLI, terminal stays open** | `vizcoo path` runs in user's terminal; that terminal must remain (server host) | Awkward — user has a dead terminal hanging out |
| **B. CLI + detach to daemon + menubar icon** | `vizcoo path` forks to background, menubar icon controls lifecycle | Need menubar integration; daemon log/debug story |
| **C. macOS .app via Tauri/Electron** | Launch from Spotlight/Dock; no terminal involved | Build pipeline + signing; fixes drag-drop image-path issue too |

**Recommended: B for V1, C as the post-V1 target.** B keeps `npx vizcoo` flow alive while removing the dead terminal. C is correct end state but heavy. **Need confirmation.**

### D3. CC binary discovery

How does vizcoo find the user's `claude` binary to spawn?

- Try `which claude` → if found, use that absolute path.
- If multiple installs exist (npm global vs Homebrew vs ~/.claude/local), pick first on PATH.
- If none found, terminal panel shows install instructions instead of erroring.
- Pass through `process.env` (so user's `ANTHROPIC_API_KEY` / OAuth tokens / `CLAUDE_CODE_*` env vars work).

This is non-controversial; documented for completeness.

---

## 1. Architecture

```
┌─ Browser tab (single window) ─────────────────────────────────────┐
│ Sidebar     │ Terminal panel (xterm.js)        │ Drawer  Timeline │
│ - identity  │ ┌──────────────────────────────┐ │  open?           │
│ - convs     │ │  $ claude                    │ │ - Map            │
│ - settings  │ │  > /usage                    │ │ - Stage          │
│             │ │  ...                         │ │                  │
│             │ └──────────────────────────────┘ │                  │
└─────────────┴──────────────────────────────────┴──────────────────┘
       ▲                       ▲                        ▲
       │                       │                        │
       │              WebSocket /pty/<id>               │
       │              (binary frames, both directions)  │
       │                                                │
       │              WebSocket /ws (existing)          │
       │              hook events for viz联动           │
       │                                                │
┌──────┴─────────────────┴────────────────────────────────────────┐
│ vizcoo node server                                              │
│   ├─ http.ts              (existing, +pty session routes)       │
│   ├─ ws.ts                (existing /ws broadcaster)            │
│   ├─ pty/                 (NEW)                                 │
│   │    ├─ session.ts      spawn + manage one PTY                │
│   │    ├─ registry.ts     Map<sessionId, Session> (state)       │
│   │    ├─ ws.ts           /pty/<id> WebSocket relay             │
│   │    └─ paste-image.ts  POST /api/pty/<id>/paste-image        │
│   └─ tmp/                 NEW dir for image paste blobs         │
└─────────────────────────────────────────────────────────────────┘
       │                                                
       │ spawn (node-pty)
       ▼                                                
┌─────────────────────────┐
│  claude (subprocess)    │   ← CC's TUI renders ANSI to PTY stdout
│  pty stdin ↔ stdout     │   ← User keystrokes flow back via PTY stdin
└─────────────────────────┘
```

### Boundaries

- **Terminal panel knows nothing about CC's semantics.** It just renders ANSI bytes and forwards key/mouse events. No parsing of slash commands, no detection of "CC is asking permission" — that's all CC's drawing.
- **Hook → viz pipeline is unchanged.** Drawer-cabinet / Map / Timeline still consume hook events from `/ws`. Terminal panel is a separate WebSocket on `/pty/<id>`.
- **One PTY per browser tab.** No multi-tab session sharing in V1; reload spawns a fresh CC. (Reconnection is an explicit non-goal for V1.)

---

## 2. Data flow

### 2.1 Spawn

1. Browser opens vizcoo; mounts `<TerminalPanel/>`.
2. Panel sends `POST /api/pty/spawn` with `{ cols, rows }` (computed by xterm.js fit-addon).
3. Server: `node-pty.spawn(claudeBin, [], { name: 'xterm-256color', cols, rows, cwd: cfg.root, env: process.env })` → returns `{ sessionId }`.
4. Panel opens `WebSocket /pty/<sessionId>`.
5. Server starts piping `pty.onData(buf) → ws.send(buf)` (binary frames) and `ws.on('message', buf) → pty.write(buf)`.

### 2.2 Resize

- xterm fit-addon recomputes `cols/rows` on container size change → panel sends `{type:'resize', cols, rows}` text frame on the same WS.
- Server distinguishes binary (PTY data) vs text (control) frames → calls `pty.resize(cols, rows)` on resize.
- Debounce 80ms on the client to avoid spamming during drag.

### 2.3 Image paste

1. xterm `attachCustomKeyEventHandler` intercepts Cmd/Ctrl+V; reads `navigator.clipboard.read()`.
2. If a `ClipboardItem` has `image/png` (or `image/*`), browser POSTs the blob to `POST /api/pty/<id>/paste-image` with `Content-Type: image/png`.
3. Server saves to `<vizcoo-tmp>/paste-<sha>.png`, returns `{ path }`.
4. Browser injects `path + '\n'` into PTY via the same WS (or types via xterm's `paste()`).
5. CC sees the path string → its existing attachment-detection grabs the file.

For drag-drop from Finder onto the panel: `dragover/drop` handler reads `e.dataTransfer.files[0]` (File object), POSTs to the same endpoint. Same downstream behavior.

### 2.4 Exit

- User types `/exit` (or `Ctrl+D`) → CC exits → `pty.onExit` fires → server closes WS.
- Browser shows "Session ended — click to restart" placeholder. New click triggers another spawn.

---

## 3. New files (with budgets)

All under `src/core/server/pty/` and `src/ui/terminal/`. Strict file-size discipline per CLAUDE.md.

### Server

| File | Purpose | Budget |
|---|---|---|
| `src/core/server/pty/session.ts` | wraps one `IPty`; exposes `write/resize/onData/onExit/dispose` | < 60 lines |
| `src/core/server/pty/registry.ts` | `Map<sessionId, Session>`; create/get/delete; cleanup on close | < 40 lines |
| `src/core/server/pty/ws.ts` | upgrades WS on `/pty/<id>`; binary relay both ways; resize-control parse | < 80 lines |
| `src/core/server/api/pty-spawn.ts` | `POST /api/pty/spawn` → `{ sessionId }` | < 40 lines |
| `src/core/server/api/pty-paste-image.ts` | `POST /api/pty/<id>/paste-image` → `{ path }` | < 50 lines |

`http.ts` gets +3 route lines; `ws.ts` (existing) gets a path-discriminator added so it doesn't double-handle `/pty/*`.

### Frontend

| File | Purpose | Budget |
|---|---|---|
| `src/ui/terminal/TerminalPanel.tsx` | mounts xterm, opens WS, forwards bytes; hosts paste/drop handlers | < 150 lines |
| `src/ui/terminal/xterm-setup.ts` | xterm.js + addons (fit, web-links, webgl) instantiation; theme | < 80 lines |
| `src/ui/terminal/clipboard-image.ts` | clipboard/drag-drop image extraction → POST → return path | < 80 lines |
| `src/ui/terminal/keybinds.ts` | `attachCustomKeyEventHandler`; preventDefault list (Cmd+W/R/T/L); pass-through for everything else | < 60 lines |

### Dependencies (npm)

- `node-pty` (server) — native build, prebuilt binaries available for macOS/Linux/Windows.
- `xterm` (browser) + `xterm-addon-fit`, `xterm-addon-web-links`, `xterm-addon-webgl`.

Lock to recent stable versions. Runtime is Node ≥20 (tsx for dev, tsc for build per `package.json`); `node-pty` ships prebuilt binaries for Node 20+ on macOS, so the runtime risk noted in §7 is much smaller than originally feared.

---

## 4. Phased implementation

Each phase ends with a verifiable demo. **Do not start phase N+1 until N is approved.**

### Phase 1 — PTY echo (1 hr)

- Add `node-pty` dep; verify it builds under bun on macOS.
- New file `src/core/server/pty/session.ts` spawning `bash` (not `claude` yet) with hardcoded cols/rows.
- Throwaway script `scripts/test-pty-echo.ts` writes `ls\n` to stdin, prints stdout to console.
- **Done when:** running the script prints a real `ls` output of the project root.

### Phase 2 — WebSocket relay (2 hr)

- Add `src/core/server/pty/ws.ts`, mount on `/pty/test` (no registry, hardcoded session).
- Add throwaway HTML page at `dev/pty-test.html` with raw xterm.js connecting to `ws://localhost:<port>/pty/test`.
- **Done when:** typing in the browser xterm runs commands in the PTY-hosted bash, output renders correctly, `htop` displays without corruption.

### Phase 3 — Spawn `claude`, mount in vizcoo (3 hr)

- Replace bash with `claude` discovery (`which claude`); pass `cwd: cfg.root`, `env: process.env`.
- Add registry + spawn endpoint.
- Build `TerminalPanel.tsx`, mount somewhere temporary (e.g. replace `<Stage>` for now).
- **Done when:** opening vizcoo shows a working CC session; `/help`, `/usage`, slash-command dropdown, long-text-paste compaction all work without writing dropdown/paste code.

### Phase 4 — Resize + keybinds (1 hr)

- fit-addon + ResizeObserver on the panel container.
- `attachCustomKeyEventHandler` blocking the browser-hijacked shortcuts that conflict with CC.
- **Done when:** dragging the panel border smoothly resizes CC without box-drawing breakage; Ctrl+L clears CC (not browser address bar); Cmd+W is blocked.

### Phase 5 — Image paste & drag-drop (2 hr)

- `clipboard-image.ts` (Cmd+V image branch + drop event branch).
- `POST /api/pty/<id>/paste-image` → save to `~/.vizcoo/tmp/`, return path.
- Inject path via xterm `paste()`.
- **Done when:** copying a screenshot in macOS and Cmd+V into the panel makes CC attach it; dragging an image from Finder also works.

### Phase 6 — Layout integration (size depends on D1)

- Per D1 decision, reshuffle `App.tsx` columns.
- Terminal panel gets its real home; remove the temporary placement from Phase 3.
- **Done when:** the chosen layout renders cleanly at 1280x800 and 1920x1080, no overlap, terminal cols ≥ 80.

### Phase 7 — Launcher (size depends on D2)

- If B: add detach + menubar (use `menubar` npm or a thin Swift helper); update `bin/vizcoo.ts`.
- If A (deferred): document the "leave terminal open" UX in README.
- **Done when:** `vizcoo path` works per chosen launch model end-to-end; user-facing onboarding doc updated.

### Phase 8 — Hook coexistence verification (0.5 hr)

- With terminal embedded, run a real CC session that triggers Edit/Write tools; confirm the existing hook → drawer-cabinet pipeline still fires (PTY-hosted CC and direct-CLI CC behave identically wrt hooks since hooks live in `~/.claude/settings.json` not the binary).
- **Done when:** opening a file in the embedded CC causes the drawer-cabinet plate to fly forward, same as before.

---

## 5. Risk mitigation

Tied to known UX risks in `memory: project_view_embedded_terminal`.

| Risk | Mitigation in this plan |
|---|---|
| IME 1-cell drift on CJK | Use webgl renderer (better cursor sync than canvas); accept residual drift; document as known limitation |
| Browser shortcut hijack | `keybinds.ts` `attachCustomKeyEventHandler` with explicit allowlist of preventDefault keys; tested per Phase 4 |
| Resize → box drawing break | Debounced fit-addon → resize control frame; tested per Phase 4 |
| Image paste path differs from native | Tmp file path is documented; surface a "from drop" badge under the path so user knows; revisit when Tauri/Electron lands |
| Tab close kills session | V1 accepts this; show "session ended" placeholder. V1.x can add `--detach` PTY survival |
| OSC 52 / 1337 unsupported | Disabled by default in xterm.js; document; CC's image-preview output (if it adds one) won't render in V1 |

---

## 6. Out of scope (V1)

- Multi-tab / multi-session per browser. One PTY per tab.
- Reconnect-after-reload. Reload = fresh CC.
- Tauri/Electron packaging (deferred until B is proven).
- Mobile / tablet xterm (CC isn't usable there anyway).
- Session recording / replay.
- Per-project terminal state persistence.

---

## 7. Total estimate

D1, D2, D3 all resolved (see §0). **Roughly 10 hours of implementation + 2 hours testing + 1 hour onboarding doc = 1.5 working days.** `node-pty` runs on plain Node 20 (prebuilt) so the original bun-fallback risk is dropped.
