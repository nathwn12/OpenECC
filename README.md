# OpenECC

**Engineering Code Companion** — a soul, skills, agents, and tools plugin for [OpenCode](https://opencode.ai).

OpenECC gives every OpenCode session a complete engineering workflow: persistent behavioral guidelines (the soul), curated engineering skills, specialized subagents, slash commands, and session quality-of-life tools.

## Installation

Add OpenECC to the `plugin` array in your `opencode.json`:

```json
{
  "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git"]
}
```

Restart OpenCode. The plugin installs through OpenCode's plugin manager.

### What The Plugin Sets Up

OpenECC auto-registers its bundled instructions, subagents, slash commands, and skills. You only need the `plugin` entry in your `opencode.json`.

If you already have agents or commands with the same names, OpenECC won't override them.

## Soul

The Karpathy behavioral guidelines, injected as persistent context in every session. The agent always remembers to think before coding, keep it simple, make surgical changes, and define success criteria.

## Skills

| Skill | Description |
|-------|-------------|
| soul | Behavioral guidelines (always loaded) |
| coding-standards | Code quality and style |
| security-review | Vulnerability detection |
| tdd-workflow | Test-driven development |
| backend-patterns | Server-side architecture |
| frontend-patterns | UI/component patterns |
| api-design | REST/API design patterns |
| e2e-testing | Playwright E2E testing |
| verification-loop | Quality gates |
| strategic-compact | Context-preserving compaction |

Use OpenCode's `skill` tool to load any skill:
```
skill: learn about tdd-workflow
```

## Agents (24)

| Agent | Model | Tools |
|-------|-------|-------|
| `planner` | Opus | read, bash |
| `architect` | Opus | read, bash |
| `code-reviewer` | Opus | read, bash |
| `security-reviewer` | Opus | read, bash, write, edit |
| `tdd-guide` | Opus | read, write, edit, bash |
| `build-error-resolver` | Opus | read, write, edit, bash |
| `e2e-runner` | Opus | read, write, edit, bash |
| `doc-updater` | Opus | read, write, edit, bash |
| `refactor-cleaner` | Opus | read, write, edit, bash |
| `docs-lookup` | Sonnet | read, bash |
| `harness-optimizer` | Sonnet | read, bash, edit |
| `loop-operator` | Sonnet | read, bash, edit |
| `go-reviewer` | Opus | read, bash |
| `go-build-resolver` | Opus | read, write, edit, bash |
| `python-reviewer` | Opus | read, bash |
| `rust-reviewer` | Opus | read, bash |
| `rust-build-resolver` | Opus | read, write, edit, bash |
| `cpp-reviewer` | Opus | read, bash |
| `cpp-build-resolver` | Opus | read, write, edit, bash |
| `java-reviewer` | Opus | read, bash |
| `java-build-resolver` | Opus | read, write, edit, bash |
| `kotlin-reviewer` | Opus | read, bash |
| `kotlin-build-resolver` | Opus | read, write, edit, bash |
| `database-reviewer` | Opus | read, write, edit, bash |

Invoke with `@planner`, `@code-reviewer`, etc.

## Commands (35)

| Command | Description | Agent |
|---------|-------------|-------|
| `/plan` | Create detailed implementation plan | planner |
| `/code-reviewer` | Review code quality and security | code-reviewer |
| `/security` | Run comprehensive security review | security-reviewer |
| `/tdd` | Enforce TDD workflow | tdd-guide |
| `/quality-gate` | Run full quality pipeline | — |
| `/build-error-resolver` | Fix build and TypeScript errors | build-error-resolver |
| `/e2e` | Generate and run Playwright E2E tests | e2e-runner |
| `/refactor-cleaner` | Remove dead code and consolidate | refactor-cleaner |
| `/orchestrate` | Orchestrate multiple agents | planner |
| `/doc-updater` | Update documentation | doc-updater |
| `/update-codemaps` | Update codemaps | doc-updater |
| `/test-coverage` | Analyze test coverage | tdd-guide |
| `/learn` | Extract patterns from session | — |
| `/checkpoint` | Save verification state | — |
| `/verify` | Run verification loop | — |
| `/eval` | Run evaluation against criteria | — |
| `/setup-pm` | Configure package manager | — |
| `/go-review` | Review Go code | go-reviewer |
| `/go-test` | Go TDD workflow | tdd-guide |
| `/go-build` | Fix Go build errors | go-build-resolver |
| `/rust-review` | Review Rust code | rust-reviewer |
| `/rust-test` | Rust TDD workflow | tdd-guide |
| `/rust-build` | Fix Rust build errors | rust-build-resolver |
| `/security-scan` | Dependency, secret, anti-pattern scan | — |
| `/harness-audit` | Audit harness configuration | — |
| `/loop-start` | Start autonomous agent loop | — |
| `/loop-status` | Check loop status | — |
| `/skill-create` | Generate skill from git history | — |
| `/instinct-status` | View learned instincts | — |
| `/instinct-import` | Import instincts | — |
| `/instinct-export` | Export instincts | — |
| `/evolve` | Cluster instincts into skills | — |
| `/promote` | Promote instincts to global scope | — |
| `/projects` | List projects with instinct stats | — |

## Custom Tools

| Tool | Purpose |
|------|---------|
| `run-tests` | Auto-detect PM + test framework, build test commands |
| `changed-files` | List files modified in current session |
| `git-summary` | Show branch, status, recent commits, staged/unstaged diffs |
| `format-code` | Detect formatter and return format command |
| `lint-check` | Detect linter and return lint command |
| `security-audit` | Three-phase: dependency audit, secret scan, code anti-pattern check |

## Updating

Clear OpenCode's package cache for OpenECC:

**PowerShell:**
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\packages\openecc@git+https_*"
```

**To pin a version:**
```json
{
  "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git#v1.0.0"]
}
```

## Development

```bash
bun install       # Install dev dependencies
bun run bundle    # Build plugin bundle
```

## License

MIT
