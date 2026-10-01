# vizcoo UI Design Philosophy

This document is the constitutional reference for vizcoo's UI/UX decisions.
Every design decision should be checked against it. When two principles
collide, this document tells us how to resolve the tradeoff.

It is **not** a style guide (colors, fonts, spacing) — it is a philosophy
guide (what we're building, how it should feel, what we refuse to do).

It was synthesized from six external sources on 2026-04-25 because vizcoo's
ad-hoc design accumulation was producing locally-good but globally-bad
results. The user explicitly asked: "我们要要求完整性，不要每个模块是最优的
但是合起来不对了" — wholeness over local optimization.

---

## 1. What vizcoo is

vizcoo is a **peripheral companion to terminal+claude**.

The vibe coder's primary surface is the terminal where they talk to Claude.
vizcoo is on the other half of their screen. They glance at it occasionally.
They never *work* in vizcoo — they work in the terminal. vizcoo's job is to
let them *see* what their project is doing in space and time, in a way the
terminal cannot show.

Three things vizcoo is **not**:
- **Not a chat client**. Claude's text is in the terminal. vizcoo doesn't repeat it.
- **Not an IDE**. vizcoo doesn't edit files, doesn't run tests, doesn't replace VSCode.
- **Not a control surface**. vizcoo never tells Claude what to do. It only watches.

This framing is non-negotiable. If we ever ask "should vizcoo do X?", the
test is: does X let the user see something terminal can't show? If no, X is
a bad idea regardless of how cool.

---

## 2. The six external pillars

### 2.1 Companion app philosophy (Sam Thibault — *Companion App Design Guidelines*)

A companion app is the secondary surface paired with a primary device. Watches
pair with phones, smart-home hubs pair with sensors, cars pair with infotainment
systems. vizcoo pairs with terminal+claude.

Three rules from this tradition:

- **Map responsibilities**. What lives on primary, what lives on companion?
  Active alerts and instant feedback → primary (claude's TUI handles those).
  Trends, context, spatial memory → companion (vizcoo's job).
- **Companion never duplicates primary**. If terminal already shows a piece
  of information, vizcoo must NOT show it again. Redundancy is friction.
- **Companion has a persona**. Coach? Friend? Witness? Ours is **silent witness**.
  vizcoo never alerts, never demands attention, never controls. It only
  reveals when looked at.

### 2.2 Glanceability (Berkeley peripheral display research, Julian Scaff)

Glanceability is the property of an interface where a user gets value from a
**fleeting look**. Not "the user reads it and understands" — "the user *feels* it".

- **Pre-attentive vision** processes color, position, motion, size, and orientation
  *before* conscious reading. A red dot vs green dot is a sub-second signal;
  reading "alive" vs "dead" is half a second slower. Use the pre-attentive layer
  for state. Reserve text for *slow cognition* — when the user has decided to
  focus.
- **Two cognition speeds** must coexist. Fast: color + position tell you what.
  Slow: hover, zoom, panel reveals tell you why.
- **Peripheral position**. The display is at the edge of the user's attention.
  If it tries to grab the center, it's no longer peripheral — it's an
  interruption.
- *"The brain doesn't read a visual scene; it feels it first."*

vizcoo's 3D stage is, by construction, a peripheral display. Plates at rest
*feel* still; a plate flying forward *feels* like something just happened. No
reading required.

### 2.3 Dieter Rams — Less, but better

Of Rams's ten principles, five matter intensely for vizcoo:

- **Useful**. Every element must justify itself by function, not by style.
- **Understandable**. Self-explanatory. No instruction manual, no tooltip
  required to grasp the basic state.
- **Unobtrusive**. White space. Don't overwhelm.
- **Honest**. Don't fake activity. Don't pretend something is alive when it
  isn't. Don't manipulate the user toward a feeling.
- **As little design as possible**. When in doubt, cut.

Rams's habit was to ask repeatedly: "Is this last detail really necessary?"
We must ask the same about every UI element: timeline card, sidebar entry,
status chip, mode badge.

### 2.4 Linear / Notion / Slack — Opinion over flexibility

These three modern tools share an unusual stance: they refuse to give the
user too many knobs. The reasoning:

- **Flexibility creates chaos**. When everyone configures their own
  workflow, no two installs feel the same; new users get lost; teams collide.
- **Opinion > Configuration**. A tool that picks one good way is faster than
  a tool that asks the user to pick.
- **The tool serves the user, not vice versa**. Automate, don't burden the
  user with maintenance.
- **Speed is a feature**. Don't make users spend brainpower on the tool itself.

For vizcoo, this means: zero-config first run; auto-install hooks; auto-detect
project; auto-select most recent conversation; *no* preferences pane other
than hard facts (port, paths, version).

### 2.5 Dashboard design patterns (academic catalog)

A dashboard maps onto a finite set of structural patterns:

- **Screenfit** — primary canvas fits without scrolling. Maximizes glanceability.
  → vizcoo's stage.
- **Overflow with auto-tail** — a time series scrolls; the bottom is "now".
  → vizcoo's timeline (terminal-style).
- **Detail-on-demand** — tooltip / popup reveals more on user request.
  → vizcoo's hover diff card.
- **Stratified hierarchy** — top-down by importance.
  → vizcoo's sidebar (project identity → conversations → settings).
- **Filter and Focus** — user narrows the view to a subset.
  → selecting a turn narrows the highlighted plates.
- **Hierarchical drill-down** — project → conversation → turn → diff.
  → matches the user's mental model.

If a piece of vizcoo's UI doesn't map cleanly to one of these patterns, that's
a design smell.

### 2.6 Command palette (V1.x escape hatch, not V1)

VS Code, Linear, Figma, Notion, Slack all have one — Cmd+K calls a fuzzy
search of every command, every file, every navigable object.

Useful when the object count is large (>50). vizcoo will reach this with
many conversations. **V1 doesn't add it**; V1.x will.

---

## 3. vizcoo's own synthesis

Distilled into one paragraph:

> vizcoo is a peripheral companion to terminal+claude, designed for
> glanceability. It does not replicate Claude's conversation; it surfaces
> what terminal cannot — the project's spatial state and temporal pulse.
> Every pixel is checked: does it serve a specific user scenario? Color,
> position, and motion convey state pre-attentively; text is reserved for
> slow cognition. We default opinionated; we cut over add; we never alert.

Five hard rules derived from this:

1. **Stage is screenfit, always primary, never demoted to a sidebar.**
2. **Timeline is overflow with terminal-style auto-tail; cards must NOT
   reproduce Claude's text replies.**
3. **Sidebar is stratified (project identity → conversations list →
   settings); nothing else lives there.**
4. **Settings holds only hard facts (port, paths, hooks status, version).
   No visual preferences in V1.**
5. **State changes are pre-attentive (color/position/motion) before they
   become text.**

---

## 4. Wholeness — the user's specific concern

The user's most important note:

> 我们要要求完整性，不要每个模块是最优的但是合起来不对了

Each region (sidebar, stage, timeline) can pass its own principle audit and
still produce a bad whole. To prevent that, this document defines four
**cross-region tests**:

### 4.1 The state-coherence test

For every meaningful state in vizcoo, ask: where is it visible? Are the
visualizations consistent across regions, or do they say different things?

| State | Sidebar | Stage | Timeline |
|---|---|---|---|
| current conversation | highlighted entry | files rendered | sticky header title |
| live status | dot (project-level) | plates flying / pulsing | header dot |
| selected turn | TurnList active | narrowed plates | active card |
| hooks broken | warning at top | (no signal) | (no signal) |

If a state appears in only one region and the user can hide that region,
the user can lose state awareness. Bad.

### 4.2 The attention-budget test

How many simultaneous fast-cognition signals does vizcoo emit at peak?

If too many things blink, glow, animate, or change color at once, the eye
has no anchor — glanceability collapses. Budget: at most **one motion source
at a time**. The plate that just flew = the focal animation. Sidebar dot
should be static. Header dot can pulse softly. Toast (V1.x) interrupts the
budget — postpone.

### 4.3 The companion-redundancy test

For every text rendered in vizcoo, ask: is it in the terminal too?

Allowed redundancy:
- Conversation title (anchor for user recognition)
- File path (anchor for hover diff)

Forbidden redundancy:
- Claude's long text replies
- User's full prompt verbatim (truncate aggressively for anchor only)
- Tool result text dumps

### 4.4 The cut-versus-add test

For every UI element, ask: which of the 10 user scenarios does it serve?

If none, cut. If one but rarely (<10% of sessions), demote to settings. If
multiple, keep prominent.

Keep this list in `doc/user-scenarios.md` so we can cross-check at every
new feature proposal.

---

## 5. Application — the structural decisions

These are the consequences of applying §1–4 to vizcoo:

### Layout

```
┌──────────────┬──────────────────────────────────┬───────────────────┐
│              │                                  │                   │
│   sidebar    │           STAGE (3D)             │     timeline      │
│              │                                  │                   │
│   240 px     │              flex                │      360 px       │
│              │                                  │                   │
└──────────────┴──────────────────────────────────┴───────────────────┘
```

No top bar. Three orthogonal regions corresponding to three orthogonal
concepts: **identity** (sidebar) × **space** (stage) × **time** (timeline).

### Sidebar — stratified

From top to bottom:
- Project identity (basename + project-level live status dot)
- Conversations list (sorted by lastActivity desc, alive first; current selected)
- Settings entry (icon at bottom)

No Map/View tabs. No TurnList nested in sidebar (TurnList belongs in timeline).
Folded mode (32px) shows: V logo + status dot + ⚙ + expand chevron.

### Stage — screenfit, peripheral

Always primary, always 3D drawer cabinet. Modes (live / reviewing) communicated
by what's highlighted on the cabinet itself, not by chrome. A small
non-color text label in the corner is acceptable; an animated colored badge
violates the attention budget.

Hover any plate → diff card (slow cognition).

### Timeline — overflow + auto-tail

- Sticky header: conversation title + status + turn count
- Cards: turn number + truncated user prompt + file chip row
- Cards do NOT show Claude's reply text
- Auto-tail to bottom; pause when user scrolls up; resume when scrolled to bottom
- Click a card → enter "review" mode for that turn (stage narrows)
- "Back to live" indicator visible while reviewing

### Settings

Hard facts only: project, hooks, sessions, version. No visual knobs.

---

## 6. Cuts mandated by this philosophy (vs current v2 draft)

The following items in the v2 draft were proposed but the philosophy demands
we cut or demote them:

- **Top status bar** — cut. Identity moves to sidebar top. Wholeness improved by
  not splitting "where am I" across two regions.
- **Toast for other-conversation activity** — cut from V1. Adds attention-budget
  pressure. Reintroduce in V1.x if real users actually open multiple sessions.
- **Stage right-top "● LIVE" badge in live mode** — cut. Already conveyed by
  plate motion + sidebar/timeline status dots. Redundant attention sink.
- **Map view placeholder in Settings** — cut. V2 concept, doesn't belong in V1
  surface area.
- **Per-conversation TurnList nested in sidebar** — already implemented but
  moved from sidebar to right timeline. The sidebar is for conversations only;
  turns belong in time, not identity.
- **"Show config" button revealing raw curl commands in Settings** — keep but
  collapsed by default. Honest principle: technical users can verify; casual
  users not surprised.

---

## 7. Adds mandated by the wholeness audit

- **State synchronization between sidebar TurnList → timeline → stage**: clicking
  a turn in any region must update the other two. (Today: timeline doesn't yet
  exist; turn click only updates stage.)
- **Hooks-broken warning** must surface in stage when sidebar is collapsed —
  otherwise the user can lose the warning by folding the sidebar.

---

## 8. Future considerations (V1.x → V2, NOT now)

- Cmd+K command palette once conversation count grows
- Snapshot system for accurate retro-diffs
- Map view (architecture) — separate route
- AI-generated conversation titles
- User rename / archive / favorite conversations

These exist in writing so we don't accidentally re-design around them later.

---

## 9. Sources

- Sam Thibault — *Companion App Design Guidelines* (Handsome / Medium)
- Tara Matthews et al. — *Designing Glanceable Peripheral Displays* (UC Berkeley EECS-2006-113)
- Julian Scaff — *Design for Glanceable Interfaces* (Bootcamp / Medium)
- Tetiana Sydorenko — *Glanceable UX* (UX Collective)
- Dieter Rams — *Ten Principles for Good Design*; Nightingale dashboard application
- Linear — `linear.app/method`
- Mats Bauer — *What Slack, Notion, and Linear have in common* (Medium)
- Dashboard Design Patterns — `dashboarddesignpatterns.github.io`
- Mobbin — *Command Palette UI Design glossary*
