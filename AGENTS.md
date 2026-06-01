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
| `discovery.ts` | Multi-source agent/command/skill scanner (bundled + global + workspace) |
| `model-routing.ts` | Loads `openecc.json`, assigns per-agent models, auto-heals if missing |
| `plan-gate.ts` | Plan state machine, intent/scope classification, drift detection, quality |
| `execution.ts` | Attempt counter, execution context block |
| `identity.ts` | Package root, version, skills dir resolution |
| `instinct.ts` | Pattern learning, instinct storage/query |

Test files: `plan-gate.test.ts`, `model-routing.test.ts`, `discovery.test.ts`, `instinct.test.ts`

## Discovery System (what an agent would guess wrong)

The plugin scans **three sources** per type, priority-merged by name (bundled > global > workspace):

| Source | Agents | Commands | Skills |
|--------|--------|----------|-------|
| Bundled | `{pkg}/.opencode/prompts/agents/*.txt` | `{pkg}/.opencode/commands/*.md` | `{pkg}/.opencode/skills/*/SKILL.md` |
| Global | `~/.config/opencode/prompts/agents/*.txt` | `~/.config/opencode/commands/*.md` | `~/.config/opencode/skills/*/SKILL.md` |
| Workspace | `{worktree}/.opencode/prompts/agents/*.txt` | `{worktree}/.opencode/commands/*.md` | `{worktree}/.opencode/skills/*/SKILL.md` |

Results cached per session. `clearDiscoveryCache()` resets for tests.

Currently: 18 agents, 28 commands, 11 skills.

## Model Routing (`openecc.json`)

Auto-generated at `%USERPROFILE%\.config\opencode\openecc.json`. Auto-heals if deleted.

```json
{ "enabled": true, "default_model": "opencode-go/deepseek-v4-flash", "agents": {} }
```

- Never touches `config.model` (user's primary model from TUI)
- `agents` field: per-agent model overrides (e.g., `"planner": "opencode-go/deepseek-v4-pro"`)
- `enabled: false` disables all routing
- File regenerated automatically if missing or invalid

## Plan Gate

Proportional routing on first user message: trivial → proceed, lightweight → auto-plan, complex → draft + block. State persisted in `.opencode/` (gitignored).

States: `draft → approved → in_progress → done` (terminal: `done`, `abandoned`). Blocked resolves to draft.

Commands: `/plan list`, `/plan status`, `/plan create <summary>`, `/plan transition <id> <status>`

## Key Constraints

- **Cache clear** for reinstall: `Remove-Item "$env:USERPROFILE\.cache\opencode\packages\openecc@git+https_*" -Recurse -Force`
- `bun.lock` is the lockfile
- `.opencode/index.json` is single source of truth for plan state
- Soul skill (`.opencode/skills/soul/SKILL.md`) is auto-loaded — never load manually
- AGENTS.md changes take effect **next session** (pushed into `config.instructions`)
- Never modify user/workspace `opencode.json`/`opencode.jsonc` except plugin install entry

## Install (for users)

```json
{ "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git"] }
```
