# OpenECC — OpenCode Plugin

Plugin runs inside OpenCode (not standalone). `bun run bundle` is the only build. No linter or formatter configured.

## Build & Verification

| Command | What |
|---------|------|
| `bun install` | Install deps |
| `bun run bundle` | Compiles `src/plugin.ts` → `.opencode/plugins/openecc.js` (Bun target, external `@opencode-ai/plugin`) |
| `bun test` | 123 tests, 312 assertions across 4 test files |

**Gotcha**: `tsconfig.outDir` says `dist/`, but actual output is `.opencode/plugins/openecc.js` (set in `package.json` `"main"` and `bundle` script). Do not rely on `dist/`.

## Source Modules (11 files in `src/`)

| Module | Purpose |
|--------|---------|
| `plugin.ts` | Entrypoint — config hook, system transforms, session hooks, command dispatch |
| `discovery.ts` | Multi-source agent/command/skill scanner (openecc-bundled + global + workspace), priority-merged by name |
| `model-routing.ts` | Loads `openecc.json`, assigns per-agent models, auto-heals if missing or invalid |
| `plan-gate.ts` | Plan state machine, intent/scope classification, drift detection, quality assessment, tool access block builder |
| `execution.ts` | Attempt counter, struggle detection, execution context block |
| `identity.ts` | Package root, version, skills directory resolution |
| `instinct.ts` | Pattern learning, instinct YAML parse/query, status table builder |

Test files: `plan-gate.test.ts`, `model-routing.test.ts`, `discovery.test.ts`, `instinct.test.ts`

## How the Plugin Works

1. **Config hook** (`config`) — Discovers and registers agents, commands, and skills from three sources (openecc-bundled, global, workspace). Pushes AGENTS.md path into `config.instructions`. Applies model routing from `openecc.json`.
2. **System transform** (`experimental.chat.system.transform`) — Injects identity block (version, soul principles, package info), runtime metadata, execution context, delegator role, delegation enforcement rules, tool access block, completion contract, and project profile into system messages. If an active plan exists, injects plan state and gate blocks.
3. **Session created** (`session.created`) — Logs session start. Runs one-time migration from legacy `.openecc/` to `.opencode/` if needed.
4. **First user message** (`experimental.chat.messages.transform`) — Classifies intent → validates project directory → classifies task scope. Routes through proportional plan gate (trivial: proceed, lightweight: auto-create approved plan, complex: create draft + block).
5. **Commands** (`command.execute.before`) — Handles `/plan list|status|create|transition` and `/instinct status` directly. Other commands are routed to registered command templates.
6. **Session compacting** (`experimental.session.compacting`) — Preserves OpenECC context (version, role, project profile, edited files) across compaction.

## Discovery System (what an agent would guess wrong)

The plugin scans **three sources** per type, priority-merged by name (openecc-bundled > global > workspace):

| Source | Agents | Commands | Skills |
|--------|--------|----------|-------|
| Bundled (openecc) | `{pkg}/.opencode/prompts/agents/*.txt` | `{pkg}/.opencode/commands/*.md` | `{pkg}/.opencode/skills/*/SKILL.md` |
| Global | `~/.config/opencode/prompts/agents/*.txt` | `~/.config/opencode/commands/*.md` | `~/.config/opencode/skills/*/SKILL.md` |
| Workspace | `{worktree}/.opencode/prompts/agents/*.txt` | `{worktree}/.opencode/commands/*.md` | `{worktree}/.opencode/skills/*/SKILL.md` |

Results cached per session. `clearDiscoveryCache()` resets for tests.

Currently: 18 agents, 28 commands, 11 skills.

## Model Routing (`openecc.json`)

Auto-generated at `%USERPROFILE%\.config\opencode\openecc.json`. Auto-heals if deleted or contains invalid JSON.

```json
{ "enabled": true, "default_model": "opencode-go/deepseek-v4-flash", "agents": {} }
```

- Never touches `config.model` (user's primary model from TUI)
- `agents` field: per-agent model overrides (e.g., `"planner": "opencode-go/deepseek-v4-pro"`)
- Default config routes 15 reasoning-heavy agents (planner, architect, code-reviewer, security-reviewer, etc.) to `opencode-go/deepseek-v4-pro`; all others use the default model
- `enabled: false` disables all routing
- File regenerated automatically if missing or invalid

## Plan Gate

Proportional routing on first user message: trivial → proceed, lightweight → auto-plan, complex → draft + block. State persisted in `.opencode/` (gitignored).

### Conditions

| Condition | Action |
|-----------|--------|
| No active plan + trivial work | Gate open — proceed directly (no plan needed) |
| No active plan + lightweight work | Auto-creates plan in approved status |
| No active plan + complex work | Creates draft plan, **blocks** until approved |
| Plan in draft | **Blocked** — must transition: draft → approved |
| Plan blocked | **Blocked** — resolve or create iteration |
| Plan approved/in_progress | Gate open — proceed within scope |
| Drift detected | Warning on out-of-scope edits |

### State Machine

```
draft ──→ approved ──→ in_progress ──→ done
                           │
                           ▼
                       blocked ──→ draft
```

All transitions validated via `VALID_TRANSITIONS`. Terminal states: `done`, `abandoned`. `abandoned` is reachable from any non-terminal state.

### Commands

- `/plan list` — list all plans
- `/plan status` — show active plan
- `/plan create <summary>` — create and activate plan (sets status to `approved`)
- `/plan transition <id> <status>` — transition plan status (validated against state machine)
- `/instinct status` — view learned instincts with confidence scores and domain summary

## Key Constraints

- **Cache clear** for reinstall: `Remove-Item "$env:USERPROFILE\.cache\opencode\packages\openecc@git+https_*" -Recurse -Force`
- `bun.lock` is the lockfile
- `.opencode/index.json` is single source of truth for plan state (schema v3)
- Plans stored in `.opencode/plans/plan-XXX.yaml` (gitignored)
- Soul skill (`.opencode/skills/soul/SKILL.md`) is auto-loaded — never load manually
- AGENTS.md changes take effect **next session** (pushed into `config.instructions`)
- Never modify user/workspace `opencode.json`/`opencode.jsonc` except plugin install entry
- Instincts stored in `.opencode/instincts/*.yaml` (gitignored) — loaded by `/instinct status` command

## Install (for users)

```json
{ "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git"] }
```
