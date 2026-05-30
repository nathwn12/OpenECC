# OpenECC

**Engineering Code Companion** — an [OpenCode](https://opencode.ai) plugin that transforms the editor into a disciplined, architecture-aware engineering partner with a routed agent team, plan-driven workflow enforcement, and domain-specific automation.

> OpenECC is not a chat wrapper. It is an engineering operating system — enforcing structure, delegation, and verification so every session produces maintainable, production-grade code.

---

## The Hook

Most AI coding sessions devolve into chatty trial-and-error. You ask. The model codes. You debug. Repeat. No plan. No review. No security scan. No docs update. No verification loop. Just raw generation until something vaguely works.

OpenECC replaces that with a **disciplined engineering pipeline**:

- **Every implementation needs a plan** — lightweight tasks auto-create one; complex work blocks until you write a `.yaml`. No more context-wandering.
- **Tool access is partitioned** — the main context can only talk and delegate; all source edits, searches, and commands happen inside subagents. This means no accidental mutations, no context corruption.
- **Work is routed, not guessed** — 30 specialized agents, 36 commands, 11 domain skills. The classifier reads your project profile and routes to the right agent with the right permissions.
- **Goals are tracked and budgeted** — `/goal` gives you turn limits, token budgets, stall detection, auto-continue, and `[goal:complete]` markers. Sessions don't drift — they converge.
- **Swarm orchestration** — `/swarm` runs the full pipeline: think → plan → 4-axis review → build → test → evaluate → ship → reflect. All with a hard cap of 5 live subagents.

---

## Table of Contents

- [Install](#install)
- [Architecture](#architecture)
- [Plan Gate & State Machine](#plan-gate--state-machine)
- [Tool Access Partitioning](#tool-access-partitioning)
- [Agents (30)](#agents)
- [Commands (36)](#commands)
- [Skills (11)](#skills)
- [Swarm Pipeline](#swarm-pipeline)
- [Goal Manager](#goal-manager)
- [Development](#development)
- [Cache & Reinstall](#clearing-cache)
- [License](#license)

---

## Install

Add one line to your `opencode.json`:

```json
{
  "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git"]
}
```

Restart OpenCode. That's it.

The plugin loads on session start: it detects your project, registers 30 agents + 36 commands + 11 skills, injects the soul guidelines, partitions tool access, and activates the plan gate — all without changing your config file.

---

## Architecture

```
src/
├── plugin.ts           ← Entrypoint. Hooks session lifecycle, registers everything
├── plan-gate.ts        ← Plan state machine, index I/O, intent classification, drift detection
├── goal.ts             ← GoalManager — budget tracking, stall detection, auto-continue
├── constants.ts        ← System prompts: delegation enforcement, tool access, routing tables
├── utils.ts            ← Profile builder, YAML frontmatter stripper, safe reads
└── routing/
    ├── detect.ts       ← Project auto-detection (languages, frameworks, tools)
    ├── registry.ts     ← Agent/skill registries with keyword-based scoring
    └── classifier.ts   ← Task categorization and auto-delegation logic
```

**How a session starts:**

1. Plugin reads project workspace → detects languages, frameworks, test tools, formatters, linters, CI/CD
2. Injects the **soul** behavioral guidelines into system prompt
3. Injects **delegation enforcement** (hard rules: main context = TALK + DELEGATE only)
4. Injects **project profile** (detected langs, recommended agents, recommended skills)
5. Injects **plan gate status** (from `.openecc/index.json`)
6. Injects **tool access block** (structured YAML partition)
7. Registers 30 agents, 36 commands, 11 skills
8. On first user message: **classifies intent** → checks plan gate → either blocks, auto-creates plan, or opens gate

---

## Plan Gate & State Machine

Every implementation request is gated by the plan system. State is persisted in `.openecc/` (gitignored):

```
.openecc/
├── index.json          ← Single source of truth: activePlanId + all plan entries
├── plan-001.yaml       ← Individual plan files (immutable; new iteration = new file)
└── plan-002.yaml
```

### State Machine

```
  draft ──→ reviewed ──→ approved ──→ in_progress ──→ done
                      │                    │
                      │                    ▼
                      └─── blocked ────────←┘
                                              │
                                              ▼
                                          abandoned
```

All transitions validated — invalid ones are rejected with an explanation.

### Gate Behavior

| Condition | Action |
|-----------|--------|
| No active plan + complex work | **Blocked** — user must create `.openecc/plan-NNN.yaml` |
| No active plan + lightweight | **Auto-creates** plan in `approved` status (≤20 tokens, no architecture keywords) |
| No active plan + trivial | **Skips** auto-plan (matches: typo, semicolon, rename, format, comment, spelling) |
| Plan not approved | **Blocked** — must transition: draft → reviewed → approved |
| Plan blocked | **Blocked** — resolve blocker or create iteration |
| Plan done/abandoned | **Blocked** — clear `activePlanId` or create new plan |
| Plan approved/in_progress | **Gate open** — proceed with implementation |

### Intent Classification

Before gating, the system classifies every message:

```typescript
type IntentCategory = "implement" | "clarify" | "plan" | "review" | "test" | "debug" | "unknown"
```

Questions ("what is X?", "how does Y work?") are classified as `clarify` and pass through the gate. Implementation requests (`implement X`, `add feature Y`, `fix bug Z`) trigger the gate check. The classifier also detects question-prefixes (`is`, `are`, `can`, `could`, `would`, `should`, `does`, `do`, `has`, `have`) to catch exploratory questions before routing.

### Drift Detection

After edits, changed files are checked against the plan's declared scope. Out-of-scope edits trigger warnings — no silent feature creep.

### Commands

| Command | Description |
|---------|-------------|
| `/plan list` | Show all plans |
| `/plan status` | Show active plan with details |
| `/plan create <summary>` | Create + activate a new plan |
| `/plan transition <id> <status>` | Transition plan state (validated against state machine) |

---

## Tool Access Partitioning

The plugin enforces **strict tool partitioning** between main context and subagents:

```
─── MAIN CONTEXT (TALK + DELEGATE ONLY) ───

  ✅ task          → spawn subagents
  ✅ skill         → load skills
  ✅ read          → state files only
  ✅ question      → ask user
  ✅ todowrite     → track progress
  ✅ webfetch      → external docs

  ❌ edit / write  → BLOCKED
  ❌ bash          → BLOCKED
  ❌ glob / grep   → BLOCKED

                │
                ▼ task()

─── SUBAGENT (ALL SOURCE WORK) ───

  ✅ edit / write  → source mutations
  ✅ bash          → commands
  ✅ glob / grep   → code search
  ✅ read          → any file
```

This prevents accidental mutations, context corruption, and scope creep from the main chat session. Every `edit`, `write`, `bash`, `glob`, and `grep` call is wrapped with enforcement banners warning against main-context usage.

---

## Agents

30 specialized agents, each with keyword-triggered routing and explicit permission scopes.

### Planning

| Agent | Domain | What it handles |
|-------|--------|-----------------|
| `@planner` | Planning | Implementation plans, architecture, feature breakdowns, strategy |
| `@architect` | Planning | System design, scalability, technical decisions |

### Review

| Agent | Domain | What it handles |
|-------|--------|-----------------|
| `@code-reviewer` | Review | Code quality, maintainability, structured reports |
| `@security-reviewer` | Security | OWASP, vulns, auth, injection, XSS, CSRF, secrets |
| `@plan-ceo-reviewer` | Review | Business viability, product alignment, scope |
| `@plan-design-reviewer` | Review | UX/design, interface, API ergonomics |
| `@plan-devex-reviewer` | Review | Developer experience, API ergonomics, friction |
| `@plan-eng-reviewer` | Review | Engineering architecture, technical soundness |

### Delivery

| Agent | Domain | What it handles |
|-------|--------|-----------------|
| `@tdd-guide` | Test | Red-green-refactor, 80%+ coverage enforcement |
| `@build-error-resolver` | Build-fix | tsc, bundler, compilation errors |
| `@e2e-runner` | Test | Playwright E2E tests, Page Object Model, CI/CD |
| `@goal-evaluator` | Evaluation | Completion checking from conversation context |

### Documentation & Cleanup

| Agent | Domain | What it handles |
|-------|--------|-----------------|
| `@doc-updater` | Docs | README, API docs, architecture docs syncing |
| `@docs-lookup` | Docs | Library/API reference research |
| `@refactor-cleaner` | Refactor | Dead code removal, consolidation, duplicates |

### Autonomy

| Agent | Domain | What it handles |
|-------|--------|-----------------|
| `@harness-optimizer` | General | Agent harness configuration, reliability, cost |
| `@loop-operator` | General | Long-running multi-iteration sessions |

### Language Specialists

| Agent | Domain | What it handles |
|-------|--------|-----------------|
| `@go-reviewer` | Review | Go, idiomatic Go, concurrency |
| `@go-build-resolver` | Build-fix | Go build, vet, compilation |
| `@rust-reviewer` | Review | Rust ownership, lifetimes, safety |
| `@rust-build-resolver` | Build-fix | Rust build, cargo, compilation |
| `@cpp-reviewer` | Review | C++ memory safety, modern C++, performance |
| `@cpp-build-resolver` | Build-fix | C++ build, CMake, linker, compilation |
| `@java-reviewer` | Review | Java, Spring Boot, JPA, layered architecture |
| `@java-build-resolver` | Build-fix | Java, Maven, Gradle, compilation |
| `@kotlin-reviewer` | Review | Kotlin, Android, coroutines, Jetpack Compose |
| `@kotlin-build-resolver` | Build-fix | Kotlin, Gradle, Android build |
| `@python-reviewer` | Review | Python, PEP 8, type hints, performance |
| `@database-reviewer` | Review | PostgreSQL, Supabase, queries, RLS, migrations |

### Orchestration

| Agent | Domain | What it handles |
|-------|--------|-----------------|
| `@swarm-coordinator` | Orchestration | Full pipeline orchestration, max 5 subagents |

---

## Commands

36 commands organized by workflow group.

### Core Routing

| Command | Agent | Description |
|---------|-------|-------------|
| `/plan` | @planner | Create implementation plans |
| `/code-review` | @code-reviewer | Quality, security, maintainability review |
| `/security` | @security-reviewer | OWASP-based security audit |
| `/tdd` | @tdd-guide | Red-green-refactor cycle enforcement |
| `/build-fix` | @build-error-resolver | Build and type error resolution |
| `/e2e` | @e2e-runner | Playwright E2E test generation |
| `/refactor-clean` | @refactor-cleaner | Dead code and consolidation |

### Pipeline

| Command | Agent | Description |
|---------|-------|-------------|
| `/swarm` | @swarm-coordinator | Full engineering pipeline |
| `/make` | @swarm-coordinator | Alias for `/swarm` |
| `/eval` | @goal-evaluator | Evaluate goal completion |

### Documentation & Automation

| Command | Agent | Description |
|---------|-------|-------------|
| `/update-docs` | @doc-updater | Sync docs with code |
| `/update-codemaps` | @doc-updater | Update codemap files |
| `/orchestrate` | @swarm-coordinator | Pipeline coordination |
| `/verify` | @code-reviewer | Quality gate verification |
| `/quality-gate` | @code-reviewer | Full quality gate |

### Learning & Autonomy

| Command | Agent | Description |
|---------|-------|-------------|
| `/learn` | @doc-updater | Capture session knowledge |
| `/checkpoint` | @doc-updater | Save session checkpoint |
| `/loop-start` | @loop-operator | Start autonomous loop |
| `/loop-status` | @loop-operator | Check loop progress |
| `/skill-create` | @planner | Create new skill |

### Instincts & Projects

| Command | Agent | Description |
|---------|-------|-------------|
| `/instinct-status` | @planner | View learned patterns |
| `/instinct-import` | @planner | Import patterns |
| `/instinct-export` | @planner | Export patterns |
| `/evolve` | @planner | Evolve pattern set |
| `/promote` | @planner | Promote patterns |
| `/projects` | @planner | Project management |

### Language-Specific

| Command | Agent | Description |
|---------|-------|-------------|
| `/go-review` | @go-reviewer | Go code review |
| `/go-test` | @go-build-resolver | Go test execution |
| `/go-build` | @go-build-resolver | Go build resolution |
| `/rust-review` | @rust-reviewer | Rust code review |
| `/rust-test` | @rust-build-resolver | Rust test execution |
| `/rust-build` | @rust-build-resolver | Rust build resolution |

### Other

| Command | Agent | Description |
|---------|-------|-------------|
| `/test-coverage` | @tdd-guide | Coverage report |
| `/harness-audit` | @harness-optimizer | Harness configuration audit |
| `/setup-pm` | @planner | Setup package manager config |
| `/security-scan` | @security-reviewer | Full security scan |

---

## Skills

11 domain-specific skills, loaded on demand via the `skill` tool. Each skill provides specialized instructions, workflows, and bundled resources.

| Skill | Domain | Use when |
|-------|--------|----------|
| `soul` | Meta | **Always active** — behavioral guidelines for every session |
| `orchestrator` | Meta | Plan gate enforcement, tool access, delegation, drift detection |
| `api-design` | API | REST API design, resource naming, pagination, error responses |
| `backend-patterns` | Backend | Node.js, Express, Next.js API routes, DB patterns |
| `frontend-patterns` | Frontend | React, Next.js, state management, performance |
| `coding-standards` | Quality | Naming, readability, immutability, code review |
| `e2e-testing` | Test | Playwright, Page Object Model, CI/CD integration |
| `tdd-workflow` | Test | Red-green-refactor, 80%+ coverage, test types |
| `security-review` | Security | Auth, input validation, secrets, endpoints |
| `verification-loop` | Quality | Build, types, lint, test, security, diff review |
| `strategic-compact` | Meta | Context compaction strategy at logical intervals |

### Soul (Always Active)

The soul is the permanent behavioral foundation of every OpenECC session. It enforces four principles:

1. **Think Before Coding** — State assumptions explicitly. Present tradeoffs. Ask when uncertain.
2. **Simplicity First** — Minimum code that solves the problem. No speculation. No over-engineering.
3. **Surgical Changes** — Touch only what you must. Match existing style. Clean up only your own mess.
4. **Goal-Driven Execution** — Define success criteria. Loop until verified. Transform tasks: "Add validation" → "Write tests for invalid inputs, then make them pass."

---

## Swarm Pipeline

`/swarm` (or `/make`) executes the full engineering pipeline in a single command:

```
         ┌────────────┐
         │   Think    │  Parse goal, scope, constraints
         └──────┬─────┘
                │
                ▼
         ┌────────────┐
         │   Plan     │  Generate plan → plan-NNN.yaml → update index.json
         └──────┬─────┘
                │
                ▼
  ┌────────────────────────────┐
  │      4-Axis Review         │  CEO · Design · DevEx · Engineering (parallel, max 4)
  │   Block / Warn / Suggest   │
  └─────────────┬──────────────┘
                │
                ▼
         ┌────────────┐
         │   Build    │  Delegate implementation (max 5 live subagents)
         └──────┬─────┘
                │
                ▼
  ┌────────────────────────────┐
  │       Review + Test        │  Code review · Security scan · Test suite
  └─────────────┬──────────────┘
                │
                ▼
         ┌────────────┐
         │  Evaluate  │  @goal-evaluator checks if goal condition is satisfied
         └──────┬─────┘
                │
                ▼
         ┌────────────┐
         │    Ship    │  If evaluated Met → summarize deliverables
         └──────┬─────┘
                │
                ▼
         ┌────────────┐
         │  Reflect   │  Call learn · Update plan notes
         └────────────┘
```

### Concurrency Rules

- Hard max **5 live subagents** per session
- Reviewers run in parallel (max 4)
- New subagents wait for an active slot
- Plan state injected via `.openecc/index.json` bootstrap — no file ops needed

---

## Goal Manager

The GoalManager adds budget tracking, stall detection, and auto-continue to long-running sessions.

### Budget Limits

| Metric | Default | Rationale |
|--------|---------|-----------|
| Max turns | 50 | ~50 exchanges before diminishing returns |
| Max tokens | 200,000 | ~$0.30 at current API pricing |
| Max duration | 30 min | Aligns with typical session timeout |
| Warning zone | 80% | Warns before hard stop |

### No-Progress Detection

- Tracks output character deltas per turn
- If output stays below 5,000 chars for 3 consecutive turns → declares stall
- Resets counter on any productive turn

### Auto-Continue

- Fires after 90s of inactivity during an active goal
- Guards with a debounce flag (180s cooldown between auto-continues)
- Sends `[auto-continue]` prompt to keep the session moving

### Markers

LLM output can include self-assessment markers:

| Marker | Effect |
|--------|--------|
| `[goal:complete]` | Goal marked complete, stopped |
| `[goal:blocked]` | Goal marked blocked, stopped |

### Commands

| Command | Description |
|---------|-------------|
| `/goal <condition>` | Start a new goal |
| `/goal status` | Show current goal status (turns, tokens, duration, checkpoints) |
| `/goal clear` | Clear current goal |
| `/goal resume` | Resume a stopped goal |
| `/goal history` | Show goal event history |

---

## Development

### Setup

```bash
bun install
```

### Build

```bash
bun run bundle
```

Compiles `src/plugin.ts` → `.opencode/plugins/openecc.js` (Bun target, external `@opencode-ai/plugin`).

### Test

```bash
bun test
```

30 tests passing (66 assertions) covering:
- State machine validation (all 8 statuses, all valid transitions, all invalid rejections)
- Intent classification (implement, clarify, review, debug, empty)
- Tool access block structure
- Plan drift detection (in-scope, out-of-scope, empty)
- Index I/O round-trip (read/write/read consistency)
- Active plan resolution (null, valid, gate blocking states)
- Plan status transitions (valid, invalid, auto-clear on done)

### Project Structure

```
.opencode/
├── commands/             ← 36 command templates (.md with YAML frontmatter)
├── prompts/agents/       ← 30 agent prompts (.txt)
├── plugins/
│   └── openecc.js        ← Bundled plugin output (git-tracked)
├── skills/               ← 11 skill directories, each with SKILL.md
│   ├── soul/             ← Always active behavioral guidelines
│   ├── orchestrator/     ← Plan gate, tool access, delegation
│   ├── api-design/
│   ├── backend-patterns/
│   ├── coding-standards/
│   ├── e2e-testing/
│   ├── frontend-patterns/
│   ├── security-review/
│   ├── strategic-compact/
│   ├── tdd-workflow/
│   └── verification-loop/
└── prompts/
    └── agents/           ← Agent prompt files (source of truth)
src/
├── plugin.ts             ← Entrypoint — session hooks, tool registration, prompt transforms
├── plan-gate.ts          ← State machine, index I/O, intent classification, drift detection
├── goal.ts               ← GoalManager — budgets, stall detect, auto-continue
├── constants.ts          ← System prompt fragments (delegation, routing, tool access)
├── utils.ts              ← Profile builder, YAML strip, safe file read
└── routing/
    ├── detect.ts         ← Project auto-detection (langs, frameworks, formatters, CI)
    ├── registry.ts       ← Agent/skill registries with keyword scoring
    └── classifier.ts     ← Task categorization, auto-delegate logic
```

---

## Clearing Cache

Force a fresh installation by removing the cached package:

```powershell
Remove-Item "$env:USERPROFILE\.cache\opencode\packages\openecc@git+https_*" -Recurse -Force
```

Then restart OpenCode — it re-fetches the plugin on next launch.

---

## License

MIT
