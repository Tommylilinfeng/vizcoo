# Design Language

This is the visual system contract for vizcoo. Read this before writing any UI code.

Companion to `CLAUDE.md`. On conflict: this doc wins on visual decisions, `CLAUDE.md` wins on architecture and code structure.

Audience: AI agents and the developer reviewing AI output. Rules are given as exact tokens (Tailwind classes, hex colors), not philosophy. When in doubt, copy a primitive verbatim.

---

## 0. Hard rules — apply before writing any UI

Reject any code that violates these.

1. **No chromatic accents.** No `text-blue-*`, `bg-blue-*`, `text-purple-*`, `bg-purple-*`, `text-cyan-*`, `text-fuchsia-*`, `text-pink-*`, `text-indigo-*`, `text-violet-*`. Off-black neutrals only. Exception: the Map's `TIER_PALETTES` in `src/ui/arch/ArchScene.tsx` (data visualization, not UI chrome).
2. **No text below 11px.** Body content minimum 13px. Labels minimum 12px. Captions minimum 11px. Never `text-[10px]`, `text-[10.5px]`.
3. **No mono on non-code text.** `font-mono` is reserved for: file paths, code snippets, command tokens, JSON, terminal output. NOT for: numbers, timestamps, file counts, decorative labels, meta info. If unsure, use sans.
4. **No mono below 12px.** Mono fonts degrade fast at small sizes.
5. **No `tracking-wider` ALL-CAPS section headers.** Use sentence-case at normal tracking.
6. **No `text-neutral-600` or `-700` on text content.** -600 is borderline AA; -700 is unreadable. Use only for decorative dots and dividers.
7. **No checkboxes for booleans.** Use the Toggle primitive (§ 8.4).
8. **No `accent-white` on `<input type="range">`.** Creates harsh white rails. Use webkit pseudo-element styling (§ 8.5).
9. **No backdrop-blur on permanent surfaces.** Reserved for modals, popovers, and overlays that are dismissed.
10. **No emoji in product UI.**
11. **No `transition-all`.** Specify exactly what transitions: `transition-colors`, `transition-transform`, `transition-[width]`.
12. **No multiple primary CTAs in one panel.** Inverse-fill white button is for the most important action; everything else is secondary or tertiary.

---

## 1. Influences

These are the references for judgment calls, not slavish imitation.

- **Vercel** — sidebar architecture, sentence-case labels, hairline borders, off-black palette
- **Linear** — keyboard-first density, monochrome muted palette, strict typographic hierarchy
- **Zed** — terminal-coder aesthetic; mono only when content is code
- **Warp** — embedded terminal feel, minimal chrome around the code surface

When a decision isn't covered here, ask: would Vercel ship it? Would Linear? If neither, find another way.

---

## 2. Fonts

### Choice
- **Geist Sans** — all UI text. Default `font-sans`. Inherited from `<html>`.
- **Geist Mono** — code, paths, commands, JSON, terminal output. Use `font-mono`.

### Mono use rules
Mono is justified by content, not styling. The text must be one of:
- A file path (`src/core/server/http.ts`)
- A code identifier (`useArchSettings`)
- A JSON / SQL / CLI fragment (`--dangerously-skip-permissions`)
- Real terminal output

Mono is NOT for: file counts, file sizes, durations, timestamps, version numbers (`v0.1.0`), tier positions, decorative labels.

### Numerics
For tabular numbers (changing values that should not jitter on update), use `tabular-nums` — but on sans, not mono. Example: a slider value `65` next to a label.

```tsx
// Right
<span className="text-[12px] tabular-nums text-neutral-500">{format(value)}</span>

// Wrong (mono is for code, not for decoration)
<span className="font-mono text-[11px] tabular-nums text-neutral-500">{format(value)}</span>
```

---

## 3. Type Scale

Five sizes total. No others appear in the codebase without justification.

| Token | Tailwind | Use |
|---|---|---|
| **Title** | `text-[18px] font-medium` | Panel headings, page titles, dialog titles |
| **Nav** | `text-[15px]` | Sidebar primary navigation items |
| **Body** | `text-[13px]` | Default panel body, button labels in panels, form values, list rows |
| **Label** | `text-[12px]` | Field labels, slider/toggle labels, secondary nav, tab labels |
| **Caption** | `text-[11px]` | Section group titles, metadata, hints, status, footer text |

### Weight
- 500 (`font-medium`) for emphasis (titles, active states, inverse-fill button text)
- 400 default for body
- No 700 (bold) in UI text

### Line height
Default Tailwind. For prose blocks (summaries, replies, long descriptions) add `leading-relaxed`. Inputs and dense data lists use default.

### Forbidden sizes
`text-[10px]`, `text-[10.5px]`, `text-[16px]`, `text-[17px]`, `text-[20px]+`. If you need an outlier, justify in the PR.

### Special: file paths and code
File paths shown to the user use `font-mono text-[12px]` minimum. Don't go lower even when space is tight.

---

## 4. Color Palette

### Background tiers (deepest → most raised)
- `bg-[#0a0a0a]` — page background, sidebar, deepest level
- `bg-[#0f0f0f]` — card/panel/drawer surface
- `bg-[#141414]` — raised element on a card (input, code block, terminal)
- `bg-white/[0.04]` — interactive surface in default state (button background, secondary button)
- `bg-white/[0.06]` — hovered interactive surface
- `bg-white/[0.08]` — active/selected interactive surface

Never nest 4 levels (`[0.04]` inside `[0.06]` inside `[0.08]`). Maximum 3.

### Text tiers (most prominent → least)
- `text-white` — primary content, titles, focused state, inverse-fill button text on dark
- `text-neutral-200` — slightly de-emphasized titles, hover from neutral-300
- `text-neutral-300` — body content, default text in panels
- `text-neutral-400` — secondary content, labels, hover from neutral-500
- `text-neutral-500` — tertiary, captions, metadata, value displays, slider/toggle values
- `text-neutral-600` — separator dots only. NOT text content.
- `text-neutral-700` — never use. Reserved for borders only.

### Inverse text (for white-fill primary buttons)
- `text-black` on `bg-white` — primary CTA only
- Never `text-neutral-800` on light bg (mid-gray on light reads as "broken")

### Semantic accents
Use sparingly. Maximum one semantic color per panel.
- `text-red-400` / `text-red-300` — destructive labels, error messages
- `text-amber-400` — warnings, "stale" states, "in-progress"
- `text-emerald-400` — live state, success indicators, active session

Surface tints for semantic backgrounds: `bg-red-950/40`, `bg-amber-400/10`, `bg-emerald-400/10` — never above `/15` opacity.

### Tier palette (data viz only)
The Map's `TIER_PALETTES` provides 10 colored tier swatches for the architecture visualization. These colors are data-bearing (each color = one tier) and are the only place blue/purple/etc. appear in the codebase. Do not borrow them for UI chrome.

---

## 4.5. Semantic tokens & light theme

vizcoo's palette is exposed through Tailwind as **semantic tokens** that resolve to CSS variables. New code references the token, not the underlying hex. The dark values listed in § 4 remain the default; a light variant activates via `<html data-theme="light">`.

### Token map

| Token | Dark value | Light value | Use |
|---|---|---|---|
| `bg-surface-0` | `#0a0a0a` | `#f5f5f4` | page background, sidebar |
| `bg-surface-1` | `#0f0f0f` | `#ffffff` | card / panel / drawer |
| `bg-surface-2` | `#141414` | `#f5f5f4` | input / code block on a panel |
| `bg-interactive` | `white/[0.04]` | `black/[0.04]` | default interactive surface |
| `bg-interactive-hover` | `white/[0.06]` | `black/[0.06]` | hovered |
| `bg-interactive-active` | `white/[0.08]` | `black/[0.08]` | active/selected, rails |
| `text-fg` | `#ffffff` | `#0a0a0a` | primary, titles |
| `text-fg-muted` | `#d4d4d4` (n-300) | `#404040` (n-700) | body content |
| `text-fg-dim` | `#a3a3a3` (n-400) | `#737373` (n-500) | labels, captions, values |
| `text-fg-faint` | `#737373` (n-500) | `#a3a3a3` (n-400) | tertiary, placeholder |
| `text-fg-deco` | `#525252` (n-600) | `#d4d4d4` (n-300) | separator dots, dividers — NOT text content |
| `border-hairline-subtle` | `white/[0.04]` | `black/[0.04]` | row separators |
| `border-hairline` | `white/[0.06]` | `black/[0.06]` | default hairline |
| `border-hairline-strong` | `white/[0.08]` | `black/[0.10]` | drawer edge, prominent |
| `ring-focus` | `white/[0.14]` | `black/[0.14]` | input focus ring |
| `bg-cta` | `#ffffff` | `#0a0a0a` | primary CTA fill (inverse-fill) |
| `bg-cta-hover` | `#e5e5e5` (n-200) | `#262626` (n-800) | primary CTA hover |
| `text-cta-fg` | `#000000` | `#ffffff` | primary CTA text |

### Elevation inversion (read carefully)

On dark, raised = lighter. On light, the *panel* is the brightest tier (pure white), and inputs inside the panel drop **back down** to the page tier (`#f5f5f4`). This is the standard light-mode inset convention (Linear, Vercel). Do not invent a brighter-than-white "raised" tier.

### Hard-rule override for light

The neutral-index prohibitions in § 0 rule 6 (`text-neutral-600/700` on text content) apply to the **dark theme palette** only. Light-theme components should reference semantic tokens (`text-fg-muted` etc.) — never write `text-neutral-700` directly even in light. The token system is the single source of truth across themes.

### Semantic accent colors per theme

The dark variants of § 4 semantic accents read too faint on white. Use these instead inside `data-theme="light"`:

| Role | Dark | Light |
|---|---|---|
| destructive | `text-red-400` | `text-red-600` |
| warning | `text-amber-400` | `text-amber-600` |
| live/success | `text-emerald-400` | `text-emerald-600` |

These are exposed as `text-accent-danger / -warn / -live` once the token registry lands.

### What does NOT change between themes

- Type scale, weights, spacing, radius, animation durations, density modes
- All § 8 component primitive shapes (Toggle is still pill + circle, Slider is still pill rail + thumb)
- `TIER_PALETTES` data-viz colors — kept identical for now; revisit if saturation reads too hot on white

### Switching

`<html data-theme="light">` triggers the CSS variable swap. A pre-paint inline script in `src/ui/index.html` reads `localStorage.vizcoo-theme` and sets the attribute before first paint to avoid flash-of-wrong-theme. No `prefers-color-scheme` auto-detection in V1 — manual toggle only.

### Migration status

Old code still references raw tokens (`bg-[#0f0f0f]`, `text-neutral-300`, `bg-white/[0.04]`). New code must use semantic tokens. Migration is incremental, file-by-file; see `src/ui/arch/MapSettings.tsx` for the sample. The light theme is not visually correct until migration completes.

---

## 5. Borders

Use these exact tokens. No others.
- `border-white/[0.04]` — subtle row separators (between list items)
- `border-white/[0.06]` — default hairline (panels, sections, cards)
- `border-white/[0.08]` — stronger separation (drawer left edge, prominent borders)

Above `[0.08]` is reserved for focus/selected ring (§ 10).

Always specify direction: `border-t`, `border-b`, `border-l`, `border-r` — never plain `border` unless you actually want all four.

---

## 6. Opacity Surfaces

White-on-dark interactive layer tokens:
- `[0.025]` — barely-there hover hint (use rarely)
- `[0.04]` — default interactive surface (buttons, selects)
- `[0.06]` — hovered surface, hairline borders
- `[0.08]` — active/selected surface, prominent borders
- `[0.10]+` — focus ring exclusively

Black overlays: only on temporary surfaces (modal backdrops, progress overlays). Permanent surfaces are solid colors from § 4.

---

## 7. Spacing & Radius Scale

### Spacing
Use Tailwind 4-pixel scale: `gap-1`, `gap-2`, `gap-2.5`, `gap-3`, `gap-4`, `gap-5`, `gap-6`. Padding follows.

Common groupings:
- Tight cluster: `gap-1.5` (only for icon + tiny label)
- Default cluster: `gap-2` to `gap-3`
- Section separation: `gap-4` to `gap-6`

Avoid `gap-3.5`, `gap-5.5`, etc. Half-step values shouldn't appear.

### Padding presets
- Top-level panel: `p-5` (px-5 py-5)
- Nested card: `p-4`
- Input group: `p-3`
- Tight chip: `px-2 py-1`

### Border radius
- `rounded` (4px) — small badges, chips
- `rounded-md` (6px) — default for buttons, inputs, cards, drawers
- `rounded-lg` (8px) — chat bubbles, large floating cards
- `rounded-full` — pills, circles, slider thumbs, toggles

No custom `rounded-[3px]` etc. unless aligning with a 3rd-party primitive.

---

## 8. Component Primitives

Reproduce these exactly. If you need a variant, justify it.

### 8.1 Button — Primary (inverse fill)

```tsx
<button className="rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-600">
  Send
</button>
```

The most important action per panel. Maximum one visible at a time. Examples: "Send" in chat, "Start session" in launch panel, "Save" in form.

### 8.2 Button — Secondary

```tsx
<button className="rounded-md bg-white/[0.04] px-3 py-1.5 text-[13px] text-neutral-200 ring-1 ring-inset ring-white/[0.08] transition hover:bg-white/[0.08] hover:text-white">
  Cancel
</button>
```

Equal-weight alternative to primary, or non-destructive secondary action.

### 8.3 Button — Tertiary (text-only)

```tsx
<button className="text-[13px] text-neutral-500 transition hover:text-neutral-100">
  Clear
</button>
```

Low-priority action. Used for "Clear", "Cancel" in stop-able operations, "Skip".

### 8.4 Toggle (line + dot — NOT pill)

26×12px container with 4px pill rail and 12px circle thumb.

```tsx
<label className="flex cursor-pointer items-center justify-between gap-3 text-[12px] text-neutral-400 transition hover:text-neutral-200">
  <span>{label}</span>
  <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
  <span className="relative inline-flex h-3 w-[26px] shrink-0 items-center">
    <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/[0.08]" />
    <span className={
      'absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full transition-[left,background-color] duration-150 ' +
      (value ? 'left-[14px] bg-neutral-300' : 'left-0 bg-neutral-600')
    } />
  </span>
</label>
```

- Off: thumb left, `bg-neutral-600` (dark muted)
- On: thumb right, `bg-neutral-300` (light)
- Label sits left, control right (NOT checkbox-style with control left)

NEVER use `<input type="checkbox">` rendered as a square. Toggle is the canonical primitive for booleans.

### 8.5 Slider

4px pill rail, 12px circle thumb. Use webkit/moz pseudo-element styling, NOT `accent-white`.

```tsx
<label className="flex flex-col gap-1.5">
  <div className="flex items-baseline justify-between gap-2">
    <span className="text-[12px] text-neutral-400">{label}</span>
    <span className="text-[11px] tabular-nums text-neutral-500">{format(value)}</span>
  </div>
  <input
    type="range"
    min={min} max={max} step={step} value={value}
    onChange={(e) => onChange(Number(e.target.value))}
    className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/[0.08] [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-neutral-300 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-300"
  />
</label>
```

Value goes top-right of label, sans-serif `tabular-nums` (NOT mono). Slider is unified with Toggle in primitive language: pill rail + circle.

### 8.6 Tab (underline indicator)

```tsx
<button className={
  '-mb-px border-b-2 px-1 py-2.5 text-[12px] transition ' +
  (active ? 'border-white text-white' : 'border-transparent text-neutral-500 hover:text-neutral-200')
}>
  {label}
</button>
```

Tabs share a `border-b border-white/[0.06]` row. Active = white underline + white text. No background fill on active.

### 8.7 Input / Textarea

```tsx
<input className="rounded-md bg-[#141414] px-2 py-1.5 text-[13px] text-white ring-1 ring-inset ring-white/[0.08] placeholder:text-neutral-600 focus:outline-none focus:ring-white/[0.14]" />
```

Background is one tier raised from panel bg. Subtle inset ring. Placeholder uses neutral-600 (acceptable here because it's hint text, not content).

### 8.8 Select

```tsx
<select className="rounded-md bg-white/[0.04] px-2 py-1 text-[12px] text-neutral-300 ring-1 ring-inset ring-white/[0.07] focus:outline-none focus:ring-white/[0.14]">
  <option>...</option>
</select>
```

### 8.9 Section header (inside panels)

```tsx
<h3 className="mb-3 text-[11px] font-medium text-neutral-500">Layout</h3>
```

Sentence-case ("Layout"). Lowercase technical labels OK ("api keys", "json"). Never tracking-wider all-caps.

### 8.10 Field label (above inputs)

```tsx
<span className="mb-1 text-[11px] text-neutral-500">{label}</span>
```

### 8.11 Empty state

```tsx
<div className="px-2 py-6 text-center text-[13px] leading-relaxed text-neutral-500">
  Nothing here yet. <span className="text-neutral-400">Add one</span> to start.
</div>
```

Centered, generous padding, neutral-500 minimum (visible). Don't whisper at the user with neutral-700.

### 8.12 Drawer / Right Panel

```tsx
<aside className="fixed right-0 top-0 z-[70] flex h-screen w-[360px] flex-col overflow-y-auto border-l border-white/[0.08] bg-[#0f0f0f]/95 backdrop-blur">
  <button className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-white/[0.04] hover:text-white">×</button>
  ...
</aside>
```

360px wide, hairline left border, slight backdrop-blur for layering. Close button absolute top-right, 28×28 hit area.

### 8.13 Map overlay (HUD)

Floating info on the 3D scene must use:
- `bg-[#141414]/95` semi-opaque
- `ring-1 ring-inset ring-white/[0.06]` hairline
- `backdrop-blur-sm`
- Minimum text size `text-[12px]`
- `rounded-md` for grouped panels, `rounded` for chips

### 8.14 Chip / pill (small inline tag)

```tsx
<span className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-neutral-300">
  {label}
</span>
```

---

## 9. Layout Patterns

### 9.1 Sidebar
- Collapsed: 48px wide, icon-only nav with title-on-hover
- Expanded: 240px wide, icon + label
- Header: project context (logo + name + collapse button) at top
- Nav: vertical button list
- Footer: status indicator + version
- Style: `border-r border-white/[0.06]`, `bg-[#0a0a0a]`
- Persistent across views (Workspace / Settings)

### 9.2 Right drawer (detail panels)
- 360px wide, opens from right edge
- Tabs at top (max 3): e.g., Agent / Info / Overview
- Title + secondary metadata at top
- Content scrolls, footer (action buttons, restructure drawer) sticks at bottom

### 9.3 Map view
- Full-bleed 3D scene
- Toolbar: bottom-right vertical stack — zoom in / zoom out / fit / settings (gear)
- Settings panel: slides in from right, 280px, solid `bg-[#0f0f0f]`, `pointer-events-none translate-x-full` when closed
- HUD overlays: top-left (stats), bottom-left (hint), bottom-right (toolbar)

### 9.4 Three-column workspace (View)
- Sidebar | Stage | Timeline
- `shrink-0` on sidebar and timeline; `flex-1 min-w-0` on stage
- This prevents flex squeeze on long content

---

## 10. Interaction States

### Hover
- Surface: `bg-white/[0.04]` → `[0.06]` or `[0.08]`
- Text: shift up one tier (`neutral-400` → `neutral-200`)
- Duration: 150ms
- `transition-colors` (specific, not `transition-all`)

### Active / Selected
Pick ONE persistent cue per element:
- `bg-white/[0.08]` (filled state), OR
- `text-white` (text emphasis), OR
- `border-white` (underline-style)

Don't combine all three. Combining = noise, no visual weight.

### Disabled
Pick ONE:
- `disabled:cursor-not-allowed disabled:opacity-40`, OR
- `disabled:bg-neutral-800 disabled:text-neutral-600`

Don't combine. Opacity is for "available but inactive"; bg-neutral-800 is for "inert state".

### Loading
- Inline spinner (10–12px) inside in-progress action button
- Full overlay only for blocking operations: `absolute inset-0 z-[60] bg-[#0a0a0a]/75 backdrop-blur-sm` with centered card

### Focus
- Buttons / interactive: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30`
- Inputs (more subtle, since they're self-evident on focus): `focus:ring-white/[0.14]`

### Cursor
- `cursor-pointer` — buttons, links, draggable elements
- `cursor-grab` / `cursor-grabbing` — pannable / draggable surfaces
- `cursor-text` — editable text region
- `cursor-not-allowed` — explicitly disabled
- Default — everything else

---

## 11. Animation

### Duration
- 150ms — micro-interactions (color shifts, hover)
- 200ms — small transforms (toggle slide, panel slide)
- 250ms+ — only for full panel/page transitions

### Easing
- `ease-out` for entering, exiting, hovers
- `ease-in-out` only for two-way bidirectional motion

### What to animate
Specify exactly: `transition-colors`, `transition-transform`, `transition-[width]`, `transition-[left,background-color]`. Never `transition-all`.

### What NOT to animate
- Layout changes that affect siblings (causes reflow cascade)
- Font sizes, padding (causes content jank)
- Width changes on flex containers without `min-w-0`

---

## 12. Iconography

### Style
- 14–18px, stroked SVG (not filled)
- `strokeWidth=1.4` (subtle) to `1.6` (bolder UI)
- `stroke="currentColor"` so they inherit text color
- 16×16 viewBox standard (some 12×12 for tiny chevrons)
- Filled icons reserved for status dots (StatusDot) and chevrons

### Sizing in containers
- Sidebar nav: `h-[18px] w-[18px]` SVG inside `flex h-[18px] w-[18px]` container
- Inline buttons: `h-3.5 w-3.5` SVG inside `flex h-7 w-7` button
- Map toolbar: `h-3.5 w-3.5` SVG inside `flex h-8 w-8` button

### Source
Either custom SVG inline or react-icons. Don't mix sources within a panel — pick one and stick.

---

## 13. Density

Three density modes; never mix within a panel.

### Comfortable (default)
- Panel padding `p-5`
- Gaps `gap-3` to `gap-4`
- Body text 13px
- For most panels and primary content

### Compact
- Padding `p-3`
- Gaps `gap-2`
- Body text 12px
- For dense lists (Resume list, settings sections, file lists)

### Spacious
- Padding `p-6` to `p-8`
- Gaps `gap-5` to `gap-8`
- Body text 14px
- Reserved for marketing/hero/empty-state pages

---

## 14. Accessibility Minimums

- **Body text contrast**: ≥4.5:1 (= `text-neutral-400` minimum on `#0f0f0f`)
- **Caption/label text**: ≥4.5:1 (= `text-neutral-500` minimum)
- **Interactive target size**: ≥28×28px clickable area (use padding to expand small icons)
- **Keyboard**: every interactive element must be `<button>`, `<a>`, or properly-roled. No clickable `<div>`.
- **State by color alone**: never. Always pair color with icon, text, or position change.
- **Focus visibility**: `focus-visible:ring-*` on every interactive element.

---

## 15. Anti-Patterns to Reject

When auditing existing UI or accepting AI suggestions, flag and remove these:

1. **Multiple primary buttons** in one panel — pick the one most-important action
2. **Mixed font sizes within a row** — e.g., 11px + 14px + 12px adjacent looks broken
3. **Full-width filled buttons** that look like banners — use bordered or text variants
4. **Decorative icons with no meaning** — every icon must label, not decorate
5. **Loading spinners on instant operations** — only show for >300ms operations
6. **Modals for inline-able actions** — prefer expand-in-place
7. **Confirmation dialogs for reversible actions** — only confirm destructive irreversible
8. **`position: absolute` panels overlapping content without push** — for layout, prefer flex sibling
9. **Tooltips for primary information** — if it matters, show it; if it doesn't, remove it
10. **`text-neutral-700` placeholder text** — use neutral-500 or restructure
11. **Caps tracking-wider section headers** — sentence-case at default tracking
12. **Auto-applied `transition-all`** — specify the property
13. **Mono font for non-code numbers** — use sans tabular-nums

---

## 16. Adoption Checklist

Before merging any new UI:

- [ ] All text sizes are in the 5-token scale (Title 18 / Nav 15 / Body 13 / Label 12 / Caption 11)
- [ ] No forbidden colors (blue/purple/cyan/etc.)
- [ ] Mono font is only on file paths, code, commands, JSON
- [ ] No `text-[10px]` or `text-[10.5px]` anywhere
- [ ] One primary CTA max per panel
- [ ] Booleans use Toggle, not Checkbox
- [ ] Sliders use canonical pill+thumb shape
- [ ] Tabs use underline indicator (no background fill)
- [ ] Borders are `border-white/[0.04]`, `[0.06]`, or `[0.08]`
- [ ] Right panels follow 360px standard
- [ ] No `transition-all`
- [ ] No `text-neutral-600` on text content
- [ ] Hover states transition `colors` only

---

## 17. Reference Files

When in doubt, copy from:

- **Toggle / Slider primitives**: `src/ui/arch/MapSettings.tsx`
- **Drawer panel**: `src/ui/arch/ModuleDetailPanel.tsx` or `RelationDetailPanel.tsx`
- **Sidebar**: `src/ui/Sidebar.tsx`
- **Tab pattern**: `src/ui/arch/ModuleDetailPanel.tsx` (`TabBtn`)
- **Section header + Field**: `src/ui/arch/MapSettings.tsx` (`Section`)
- **Primary CTA**: `src/ui/terminal/TerminalChooser.tsx` (Start session button)
- **Empty state**: `src/ui/arch/AgentTab.tsx`

When updating these reference files, update this doc the same PR if rules change.

---

## 18. When This Doc Is Wrong

If a rule produces a worse outcome than breaking it:

1. Note the conflict in the PR description
2. Propose either: a doc edit (if the rule is wrong in general) or a justified exception (if this case is special)
3. Don't silently break the rule — silent breakage is the failure mode this doc exists to prevent

This doc is a living artifact. Update it when decisions change. Never let it drift behind the codebase.
