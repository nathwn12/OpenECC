# OpenECC — OpenCode Plugin

This is an OpenCode plugin, not a user-facing app. It provides engineering workflow automation (agent routing, command templates, project detection, skill auto-loading, proportional plan gate).

## Build & Dev

- **Install**: `bun install`
- **Bundle**: `bun run bundle` — compiles `src/plugin.ts` → `.opencode/plugins/openecc.js` (Bun target, external `@opencode-ai/plugin`)
- **Test**: `bun test` — runs test suite (63 tests, 145 assertions)
- **No linter or formatter configured**. Typecheck errors are not gated.
- **Dist vs reality**: `outDir` in tsconfig is `dist/`, but actual output is `.opencode/plugins/openecc.js` (set in `package.json` `"main"` and `bundle` script)

## Architecture

`src/plugin.ts` is the single entrypoint. It registers tools, auto-injects system prompts (soul, delegation rules, project profile, plan state, plan gate, tool access block), hooks session events, and exposes commands.

| Directory | Purpose |
|-----------|---------|
| `src/` | Plugin TypeScript source (entrypoint: `plugin.ts`) |
| `src/plan-gate.ts` | Plan state machine, drift detection, intent classification, quality assessment, tool access blocks |
| `src/identity.ts` | Package info, version, skills path resolution |
| `src/execution.ts` | Attempt tracking, execution context block |
| `.opencode/prompts/agents/` | Agent prompt files (18 agents) |
| `.opencode/commands/` | Command templates (28 commands) |
| `.opencode/skills/` | SKILL.md files loaded by the plugin (11 skills) |
| `.opencode/plugins/openecc.js` | Bundled plugin output (git-tracked) |
| `.opencode/plans/` | Plan state (index.json, plan-00N.yaml) — gitignored |

## How the Plugin Works

1. On session start, `src/plugin.ts` transforms system prompt, injecting soul principles, delegation rules, project profile, plan state, plan gate block, and `<structured type="tool_access">` blocks.
2. It scans `.opencode/skills/` for SKILL.md files — pushes each discovered skill directory to `config.skills.paths` (cached, only scans once).
3. It registers agents (from `.opencode/prompts/agents/`), commands (from `.opencode/commands/`), and skills (from `.opencode/skills/`).
4. On first user message, it classifies intent → classifies task scope → routes through the proportional plan gate (trivial: proceed, lightweight: auto-create+approve, complex: create draft + block).
5. If legacy `.openecc/` directory exists on session start, one-time migration runs automatically (`migrateOpeneccState` copies plans + index to `.opencode/`).
6. AGENTS.md is pushed into `config.instructions` — changes take effect on next session.

## Plan Gate Enforcement

Every implementation request is gated by proportional routing:

| Condition | Action |
|-----------|--------|
| No active plan + trivial work | Gate open — proceed directly (no plan needed) |
| No active plan + lightweight work | Auto-creates plan in approved status |
| No active plan + complex work | Creates draft plan, **blocks** until approved |
| Plan in draft | **Blocked** — must transition: draft → approved |
| Plan blocked | **Blocked** — resolve or create iteration |
| Plan approved/in_progress | Gate open — proceed within scope |
| Drift detected | Warning on out-of-scope edits |

## State Machine

```
draft ──→ approved ──→ in_progress ──→ done
                           │
                           ▼
                       blocked ──→ draft
```

All transitions validated via `VALID_TRANSITIONS`. Terminal states: `done`, `abandoned`.

## Commands

- `/plan list`, `/plan status`, `/plan create <summary>`, `/plan transition <id> <status>`

## Key Constraints

- **Cache clear** to force reinstall: `Remove-Item "$env:USERPROFILE\.cache\opencode\packages\openecc@git+https_*" -Recurse -Force`
- **bun.lock** is the lockfile; `bun run bundle` is the only build command
- Plugin is installed via `opencode.json` plugin entry — not run standalone
- `.opencode/index.json` is the single source of truth for plan state
- The soul skill (`.opencode/skills/soul/SKILL.md`) is always auto-loaded — do not load it manually
- Never modify user or workspace `opencode.json`/`opencode.jsonc` except plugin install entry

## Install (for users)

```json
{ "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git"] }
```
