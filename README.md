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

| Agent | Tools |
|-------|-------|
| `planner` | read, bash |
| `architect` | read, bash |
| `code-reviewer` | read, bash |
| `security-reviewer` | read, bash, write, edit |
| `tdd-guide` | read, write, edit, bash |
| `build-error-resolver` | read, write, edit, bash |
| `e2e-runner` | read, write, edit, bash |
| `doc-updater` | read, write, edit, bash |
| `refactor-cleaner` | read, write, edit, bash |
| `docs-lookup` | read, bash |
| `harness-optimizer` | read, bash, edit |
| `loop-operator` | read, bash, edit |
| `go-reviewer` | read, bash |
| `go-build-resolver` | read, write, edit, bash |
| `python-reviewer` | read, bash |
| `rust-reviewer` | read, bash |
| `rust-build-resolver` | read, write, edit, bash |
| `cpp-reviewer` | read, bash |
| `cpp-build-resolver` | read, write, edit, bash |
| `java-reviewer` | read, bash |
| `java-build-resolver` | read, write, edit, bash |
| `kotlin-reviewer` | read, bash |
| `kotlin-build-resolver` | read, write, edit, bash |
| `database-reviewer` | read, write, edit, bash |

Invoke with `@planner`, `@code-reviewer`, etc.

<details>
<summary>Agent descriptions (click to expand)</summary>

- **planner** — Expert planning specialist for complex features and refactoring. Use for implementation planning, architectural changes, or complex refactoring. *(read-only, read + bash)*
- **architect** — Software architecture specialist for system design, scalability, and technical decision-making. *(read-only, read + bash)*
- **code-reviewer** — Expert code review specialist. Reviews code for quality, security, and maintainability. *(read-only, read + bash)*
- **security-reviewer** — Security vulnerability detection and remediation specialist. Use after writing code that handles user input, authentication, API endpoints, or sensitive data. *(read, write, edit, bash)*
- **tdd-guide** — Test-Driven Development specialist enforcing write-tests-first methodology. Ensures 80%+ test coverage. *(read, write, edit, bash)*
- **build-error-resolver** — Build and TypeScript error resolution specialist. Fixes build/type errors with minimal diffs. *(read, write, edit, bash)*
- **e2e-runner** — End-to-end testing specialist using Playwright. Generates, maintains, and runs E2E tests for critical user flows. *(read, write, edit, bash)*
- **doc-updater** — Documentation and codemap specialist. Keeps docs in sync with code. *(read, write, edit, bash)*
- **refactor-cleaner** — Dead code cleanup and consolidation specialist. Removes unused code and consolidates duplicates. *(read, write, edit, bash)*
- **docs-lookup** — Documentation specialist using web fetch and MCP to research library/API documentation. *(read-only, read + bash)*
- **harness-optimizer** — Analyzes and improves agent harness configuration for reliability, cost, and throughput. *(read, bash, edit)*
- **loop-operator** — Operates autonomous agent loops, monitors progress, and intervenes safely when stuck. *(read, bash, edit)*
- **go-reviewer** — Go code reviewer specializing in idiomatic Go, concurrency patterns, and error handling. *(read-only, read + bash)*
- **go-build-resolver** — Go build and vet error resolution specialist. Fixes with minimal changes. *(read, write, edit, bash)*
- **python-reviewer** — Python code reviewer specializing in PEP 8, type hints, security, and performance. *(read-only, read + bash)*
- **rust-reviewer** — Rust code reviewer specializing in ownership, lifetimes, concurrency, and safety. *(read-only, read + bash)*
- **rust-build-resolver** — Rust build and Cargo error resolution specialist. *(read, write, edit, bash)*
- **cpp-reviewer** — C++ code reviewer specializing in memory safety, modern C++, and performance. *(read-only, read + bash)*
- **cpp-build-resolver** — C++ build and CMake error resolution specialist. Fixes linker, template, and configuration errors. *(read, write, edit, bash)*
- **java-reviewer** — Java and Spring Boot reviewer specializing in layered architecture, JPA, and security. *(read-only, read + bash)*
- **java-build-resolver** — Java/Maven/Gradle build error resolution specialist. *(read, write, edit, bash)*
- **kotlin-reviewer** — Kotlin and Android reviewer specializing in coroutines, Jetpack Compose, and idiomatic patterns. *(read-only, read + bash)*
- **kotlin-build-resolver** — Kotlin/Gradle build error resolution specialist. *(read, write, edit, bash)*
- **database-reviewer** — PostgreSQL and Supabase database specialist for query optimization, schema design, and security. *(read, write, edit, bash)*

</details>

## Commands (34)

| Command | Description | Agent |
|---------|-------------|-------|
| `/plan` | Create detailed implementation plan | planner |
| `/code-review` | Review code quality and security | code-reviewer |
| `/security` | Run comprehensive security review | security-reviewer |
| `/tdd` | Enforce TDD workflow | tdd-guide |
| `/quality-gate` | Run full quality pipeline | — |
| `/build-fix` | Fix build and TypeScript errors | build-error-resolver |
| `/e2e` | Generate and run Playwright E2E tests | e2e-runner |
| `/refactor-clean` | Remove dead code and consolidate | refactor-cleaner |
| `/orchestrate` | Orchestrate multiple agents | planner |
| `/update-docs` | Update documentation | doc-updater |
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

<details>
<summary>Command descriptions (click to expand)</summary>

**Delegation commands** (route to an agent):

- **/plan** → @planner — Create a detailed implementation plan for complex features or refactoring
- **/code-review** → @code-reviewer — Review code for quality, security, and maintainability
- **/security** → @security-reviewer — Run comprehensive security review using OWASP guidelines
- **/tdd** → @tdd-guide — Enforce TDD workflow with 80%+ test coverage
- **/build-fix** → @build-error-resolver — Fix build and TypeScript errors with minimal changes
- **/e2e** → @e2e-runner — Generate and run E2E tests with Playwright
- **/refactor-clean** → @refactor-cleaner — Remove dead code and consolidate duplicates
- **/orchestrate** → @planner — Orchestrate multiple agents for complex tasks
- **/update-docs** → @doc-updater — Update documentation to reflect current codebase
- **/update-codemaps** → @doc-updater — Update codemaps to reflect current architecture
- **/test-coverage** → @tdd-guide — Analyze and improve test coverage
- **/go-review** → @go-reviewer — Review Go code for idiomatic patterns and correctness
- **/go-test** → @tdd-guide — Run Go TDD workflow
- **/go-build** → @go-build-resolver — Fix Go build and vet errors
- **/rust-review** → @rust-reviewer — Review Rust code for safety and correctness
- **/rust-test** → @tdd-guide — Run Rust TDD workflow
- **/rust-build** → @rust-build-resolver — Fix Rust build and Cargo errors

**Utility commands** (standalone, no agent delegation):

- **/quality-gate** — Run quality pipeline: format, lint, type-check, test, security scan
- **/learn** — Extract patterns and learnings from current session
- **/checkpoint** — Save verification state and progress checkpoint
- **/verify** — Run verification loop: build, lint, test, security
- **/eval** — Run evaluation against acceptance criteria
- **/setup-pm** — Configure package manager for the project
- **/security-scan** — Run dependency, secret, and anti-pattern scan
- **/harness-audit** — Audit harness configuration quality and coverage
- **/loop-start** — Start autonomous agent loop with safety defaults
- **/loop-status** — Check autonomous loop status and progress
- **/skill-create** — Generate skill files from git history patterns
- **/instinct-status** — View learned instinct patterns
- **/instinct-import** — Import instincts from a file
- **/instinct-export** — Export instincts to a file
- **/evolve** — Cluster instincts into reusable skills
- **/promote** — Promote project instincts to global scope
- **/projects** — List known projects and instinct statistics

</details>

## Custom Tools

| Tool | Purpose |
|------|---------|
| `run-tests` | Auto-detect PM + test framework, build test commands |
| `changed-files` | List files modified in current session |
| `analyze-task` | Classify a user message into a task category and extract keywords |
| `auto-delegate` | Analyze a user message and recommend which subagent(s) and skill(s) to use |
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
bun run bundle    # Build plugin bundle (uses --external @opencode-ai/plugin)
```

The build excludes `@opencode-ai/plugin` from the bundle since OpenCode provides it at runtime — this reduced the bundle from 475KB to ~30KB (94% reduction).

## License

MIT
