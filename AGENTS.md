# OpenECC — OpenCode Plugin

This is an OpenCode plugin, not a user-facing app. It provides engineering workflow automation (agent routing, command templates, project detection, skill auto-loading, swarm orchestration).

## Build & Dev

- **Install**: `bun install`
- **Bundle**: `bun run bundle` — compiles `src/plugin.ts` → `.opencode/plugins/openecc.js` (Bun target, external `@opencode-ai/plugin`)
- **No tests, linter, or formatter configured** in this repo. Typecheck errors are not gated.
- **Dist vs reality**: `outDir` in tsconfig is `dist/`, but the actual output is `.opencode/plugins/openecc.js` (set in `package.json` `"main"` and `bundle` script)

## Architecture

Image: src/plugin.ts is the single entrypoint. It registers tools, auto-injects system prompts (soul, delegation rules, project profile, plan state), hooks session events, and exposes commands.

| Directory | Purpose |
|-----------|---------|
| `src/` | Plugin TypeScript source (entrypoint: `plugin.ts`) |
| `src/routing/` | Project detection, agent/skill registry, task classifier |
| `.opencode/prompts/agents/` | Agent prompt files (30 agents) |
| `.opencode/commands/` | Command templates (36 commands) |
| `.opencode/skills/` | SKILL.md files loaded by the plugin |
| `.opencode/plugins/openecc.js` | Bundled plugin output (git-tracked) |
| `.openecc/` | Swarm plan state (index.json, plan YAMLs) — gitignored |
| `.plan/` | Local plan workspace — gitignored |

## How the plugin works

1. On session start, `src/plugin.ts:404` transforms system prompt, injecting soul principles, delegation rules, project profile, and plan state.
2. It patches tool definitions (`src/plugin.ts:344`) to add enforcement banners on `edit`/`write`/`bash`/`glob`/`grep` — these are DO NOT CALL IN MAIN CONTEXT warnings.
3. At `src/plugin.ts:356`, it registers agents (from `.opencode/prompts/agents/`), commands (from `.opencode/commands/`), and skills (from `.opencode/skills/`).
4. On first user message (`src/plugin.ts:465`), it auto-analyzes the task and may inject a matched skill into the user's first message.
5. On session idle (`src/plugin.ts:571`), it audits edited files for leftover `console.log` statements.
6. AGENTS.md is pushed into `config.instructions` at `src/plugin.ts:364` — changes take effect on next session.

## Key Constraints

- **Cache clear** to force reinstall: `Remove-Item "$env:USERPROFILE\.cache\opencode\packages\openecc@git+https_*" -Recurse -Force`
- **bun.lock** is the lockfile; `bun run bundle` is the only build command
- Plugin is installed via `opencode.json` plugin entry — not run standalone
- `.openecc/index.json` is the single source of truth for swarm plan state
- The soul skill (`.opencode/skills/soul/SKILL.md`) is always auto-loaded — do not load it manually

## Install (for users)

```json
{ "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git"] }
```
