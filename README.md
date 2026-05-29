# OpenECC

Engineering Code Companion for [OpenCode](https://opencode.ai): a plugin that gives the editor a persistent engineering mindset, a routed agent team, useful skills, and automation helpers.

## For

- developers who want OpenCode to behave like a disciplined pair-programmer
- teams that want consistent planning, review, testing, docs, and security workflows
- any codebase where task routing matters more than chatty prompting

## Install

Add OpenECC to `opencode.json`:

```json
{
  "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git"]
}
```

Restart OpenCode. That is enough to load the plugin.

## What it does

- keeps a permanent **soul**: think first, stay simple, make surgical changes, verify results
- auto-detects the project profile and recommends the right agent or skill
- exposes delegation commands plus session tools like tests, formatting, linting, git status, and security audit

## AGENTS

| Group | Key agents | What they handle |
|---|---|---|
| Planning | `@planner`, `@architect` | implementation plans, architecture, decisions |
| Review | `@code-reviewer`, `@security-reviewer` | quality review, security checks, input/auth risks |
| Delivery | `@tdd-guide`, `@build-error-resolver`, `@e2e-runner` | test-first work, build fixes, Playwright flows |
| Docs / cleanup | `@doc-updater`, `@docs-lookup`, `@refactor-cleaner` | docs, reference lookup, dead code removal |
| Autonomy | `@harness-optimizer`, `@loop-operator` | agent harness tuning, long-running loops |
| Orchestration | `@swarm-coordinator`, `@goal-evaluator` | Full pipeline: think → plan → review → build → test → evaluate → ship → reflect. Plan state injected via `.openecc/index.json` bootstrap. Hard max 5 live subagents. |
| Plan review | `@plan-ceo-reviewer`, `@plan-design-reviewer`, `@plan-devex-reviewer`, `@plan-eng-reviewer` | Multi-axis plan review from business, design, DX, and engineering perspectives. Returns Block/Warn/Suggest/Questions. |
| Language specialists | `@go-*`, `@rust-*`, `@cpp-*`, `@java-*`, `@kotlin-*`, `@python-reviewer`, `@database-reviewer` | language- or domain-specific review and fixes |

## COMMANDS

| Group | Examples | Use for |
|---|---|---|
| Core routing | `/plan`, `/code-review`, `/security`, `/tdd`, `/build-fix`, `/e2e`, `/refactor-clean` | the main delegated workflows |
| Pipeline | `/swarm`, `/make` | Full pipeline: think, plan, multi-axis review, build, test, evaluate, ship, reflect. Max 5 subagents. |
| Docs / automation | `/update-docs`, `/update-codemaps`, `/orchestrate`, `/verify`, `/quality-gate` | docs sync and verification runs |
| Learning / autonomy | `/learn`, `/checkpoint`, `/loop-start`, `/loop-status`, `/skill-create` | session capture and agent loops |
| Instincts / projects | `/instinct-status`, `/instinct-import`, `/instinct-export`, `/evolve`, `/promote`, `/projects` | reuse learned patterns across work |
| Language-specific | `/go-review`, `/go-test`, `/go-build`, `/rust-review`, `/rust-test`, `/rust-build` | language-focused workflows |

## Automation model

1. **Detect** — OpenECC reads the workspace and classifies the task.
2. **Delegate** — it routes work to the right agent, skill, or command. `auto-delegate` is the quick way to get routing recommendations.
3. **Orchestrate** — `/swarm` (or `/make`) runs the full pipeline: think → plan → review → build → review+test → evaluate → ship → reflect. The goal is the argument to `/swarm`. Plan state is injected into context from `.openecc/index.json`. A `@goal-evaluator` agent checks completion before shipping.
4. **Verify** — it uses tools for tests, linting, formatting, git state, and security checks before claiming done.

## Development

```bash
bun install
bun run bundle
```

## Clearing Cache

Remove OpenECC's cached package to force a fresh install:

```powershell
Remove-Item "$env:USERPROFILE\.cache\opencode\packages\openecc@git+https_\github.com\nathwn12" -Recurse -Force
```

Then restart OpenCode — it will re-fetch the plugin on next launch.

## License

MIT
