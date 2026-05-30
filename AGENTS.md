# OpenECC — OpenCode Plugin

This is an OpenCode plugin, not a user-facing app. It provides engineering workflow automation (agent routing, command templates, project detection, skill auto-loading, swarm orchestration).

## Build & Dev

- **Install**: `bun install`
- **Bundle**: `bun run bundle` — compiles `src/plugin.ts` → `.opencode/plugins/openecc.js` (Bun target, external `@opencode-ai/plugin`)
- **Test**: `bun test` — runs test suite (plan-gate, protocol, etc.)
- **No linter or formatter configured**. Typecheck errors are not gated.
- **Dist vs reality**: `outDir` in tsconfig is `dist/`, but actual output is `.opencode/plugins/openecc.js` (set in `package.json` `"main"` and `bundle` script)

## Architecture

`src/plugin.ts` is the single entrypoint. It registers tools, auto-injects system prompts (soul, delegation rules, project profile, plan state, tool access block), hooks session events, and exposes commands.

| Directory | Purpose |
|-----------|---------|
| `src/` | Plugin TypeScript source (entrypoint: `plugin.ts`) |
| `src/routing/` | Project detection, agent/skill registry, task classifier |
| `src/plan-gate.ts` | Plan state machine, drift detection, intent classification, tool access blocks |
| `src/goal.ts` | GoalManager: /goal workflow, budget, no-progress detection, auto-continue |
| `.opencode/prompts/agents/` | Agent prompt files (30 agents) |
| `.opencode/commands/` | Command templates (36 commands) |
| `.opencode/skills/` | SKILL.md files loaded by the plugin |
| `.opencode/plugins/openecc.js` | Bundled plugin output (git-tracked) |
| `.openecc/` | Plan state (index.json, plan YAMLs) — gitignored |
| `.plan/` | Local plan workspace — gitignored |

## How the Plugin Works

1. On session start, `src/plugin.ts` transforms system prompt, injecting soul principles, delegation rules, project profile, plan state, and `<structured type="tool_access">` blocks.
2. It patches tool definitions (`src/plugin.ts`) to add enforcement banners on `edit`/`write`/`bash`/`glob`/`grep` — these are DO NOT CALL IN MAIN CONTEXT warnings.
3. It registers agents (from `.opencode/prompts/agents/`), commands (from `.opencode/commands/`), and skills (from `.opencode/skills/`).
4. On first user message, it auto-injects the **plan gate**: no implementation without an approved plan. Lightweight tasks get an auto-created plan.
5. On session idle, it audits edited files for leftover `console.log` statements and auto-blocks plans on sustained no-progress.
6. AGENTS.md is pushed into `config.instructions` — changes take effect on next session.

## Plan Gate Enforcement

Every implementation request is gated:

| Condition | Action |
|-----------|--------|
| No active plan + complex work | Blocked. User creates plan via `.openecc/plan-NNN.yaml` |
| No active plan + lightweight | Auto-creates plan in approved status |
| Plan not approved | Blocked. Must transition: draft → reviewed → approved |
| Plan blocked | Blocked. Resolve or create iteration |
| Plan approved/in_progress | Gate open — proceed |
| Drift detected | Warning on out-of-scope edits |

## State Machine

```
draft → reviewed → approved → in_progress → done
                                        → blocked → draft
```

All transitions validated via `VALID_TRANSITIONS`. Terminal states: `done`, `abandoned`.

## Commands

- `/goal <cond>`, `/goal status`, `/goal clear`, `/goal resume`, `/goal history`
- `/plan list`, `/plan status`, `/plan create <summary>`, `/plan transition <id> <status>`

## Key Constraints

- **Cache clear** to force reinstall: `Remove-Item "$env:USERPROFILE\.cache\opencode\packages\openecc@git+https_*" -Recurse -Force`
- **bun.lock** is the lockfile; `bun run bundle` is the only build command
- Plugin is installed via `opencode.json` plugin entry — not run standalone
- `.openecc/index.json` is the single source of truth for plan state
- The soul skill (`.opencode/skills/soul/SKILL.md`) is always auto-loaded — do not load it manually

## Install (for users)

```json
{ "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git"] }
```
