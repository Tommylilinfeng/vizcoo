# vizcoo

Live architecture visualization for codebases. Point it at a repo, get an
auto-classified module map that updates as you edit. Click any module, let the model
re-split it.

## Install

```bash
git clone <repo> vizcoo
cd vizcoo
npm install
npm run build
```

The build step produces `dist/` (Node server) and `dist/ui/` (React bundle).

## Run

```bash
npx tsx bin/vizcoo.ts /path/to/ts-project
```

Opens `http://localhost:3721`. The database lives at `<project>/.vizcoo/graph.db`.

Environment variables:

- `VIZCOO_PORT` — override the default port (3721)
- `VIZCOO_MODEL` — Claude model for the split call (default: whatever `claude` CLI picks)

Requires `claude` on PATH (Claude Code CLI) for the split feature. Indexing and the
live map work without it.

## Verify

```bash
npm run verify
```

Rebuilds the Next.js fixture index from scratch and checks module count, framework
detector, and edge counts.

## Scope

Indexing covers 13 languages through `LanguageAnalyzer` plugins (see
`src/core/plugin-api/` and `src/analyzers/`): TypeScript / JavaScript, Python, Go, Java,
C, Rust, Ruby, Kotlin, Scala, PHP, C#, Lua, and Dart. All of them extract imports and
symbols; framework detection (monorepo, Next.js, Express) exists only for TypeScript /
JavaScript so far. Adding a language means implementing `LanguageAnalyzer`, not touching
the core.

The V0.1 feature list is intentionally narrow:

- cold-start classification: heuristic (framework detection + folder fallback), no LLM
- live updates on file change
- AI-driven module split (one button, LLM chooses axis and count)
- no manual module editing (rename, drag, merge, delete) — deferred to V1
- no cross-session or multi-user state

Working principles: `CLAUDE.md`. Architecture: `doc/architecture.md`. Known issues
and gaps: `doc/known-issues.md`.

## License

Apache-2.0
