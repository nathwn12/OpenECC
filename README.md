# OpenECC

**Engineering Code Companion** — an [OpenCode](https://opencode.ai) plugin that transforms the editor into a disciplined, architecture-aware engineering partner with a routed agent team, plan-driven workflow enforcement, and domain-specific automation.

---

## Install

Add one line to your `opencode.json`:

```json
{
  "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git"]
}
```

Restart OpenCode. The plugin loads on session start: detects your project, registers 18 agents + 28 commands + 11 skills, injects the soul guidelines, partitions tool access, and activates the plan gate.

---

## Architecture

```
src/
├── plugin.ts            ← Entrypoint. Hooks session lifecycle, registers everything
├── plan-gate.ts         ← Plan state machine, index I/O, intent classification, drift detection
├── plan-gate.test.ts    ← 63 tests covering state machine, intent, scope, drift, I/O, migration
├── identity.ts          ← Package info, version, skills path resolution
└── execution.ts         ← Attempt tracking, execution context block
```

**How a session starts:**

1. Plugin detects project (languages, package manager)
2. Scans `.opencode/skills/` for SKILL.md files — auto-registers each skill silently
3. Injects the **soul** behavioral guidelines into system prompt
4. Injects **delegation enforcement** (hard rules: main context = TALK + DELEGATE only)
5. Injects **project profile** (detected langs, package manager)
6. Injects **plan gate status** + **plan gate block** (active plan with enforcement)
7. Injects **tool access block** (structured YAML partition)
8. Registers 18 agents, 28 commands, 11 skills from `.opencode/`
9. On first user message: **classifies intent** → proportional plan gate → either blocks, auto-creates, or opens gate

---

## Plan Gate & State Machine

Every implementation request is gated by the proportional plan system. State is persisted in `.opencode/` (gitignored):

```
.opencode/
├── index.json              ← Single source of truth: activePlanId + all plan entries
└── plans/
    ├── plan-001.yaml       ← Individual plan files (immutable; new iteration = new file)
    └── plan-002.yaml
```

### State Machine

```
draft ──→ approved ──→ in_progress ──→ done
                           │
                           ▼
                       blocked ──→ draft
```

All transitions validated via `VALID_TRANSITIONS`. Terminal states: `done`, `abandoned`.

### Proportional Gate Behavior

| Scope | No Active Plan | Plan Exists |
|-------|---------------|-------------|
| **trivial** (typo, rename, format) | Proceed directly | Proceed within scope |
| **lightweight** (add feature, fix bug) | Auto-creates approved plan | Proceed if approved/in_progress |
| **complex** (refactor, migrate, rewrite) | Creates draft plan, **blocks** | Blocks until approved |

The plan gate injects `<PLAN_GATE>BLOCKED</PLAN_GATE>` into the first user message for draft plans, and a `plan_gate` structured block into system prompts. The LLM reads these and refuses to implement until the plan is approved via `/plan transition <id> approved`.

### Intent Classification

Before gating, every message is classified:

```typescript
type IntentCategory = "implement" | "clarify" | "plan" | "review" | "test" | "debug" | "unknown"
```

Questions pass through the gate. Implementation requests trigger the proportional gate check.

### Drift Detection

After edits, changed files are checked against the plan's declared scope. Out-of-scope edits trigger warnings.

### Commands

| Command | Description |
|---------|-------------|
| `/plan list` | Show all plans |
| `/plan status` | Show active plan with details |
| `/plan create <summary>` | Create + activate a new plan |
| `/plan transition <id> <status>` | Transition plan state |

---

## Tool Access Partitioning

The plugin enforces strict tool partitioning between main context and subagents:

```
─── MAIN CONTEXT (TALK + DELEGATE ONLY) ───

  ✅ task          → spawn subagents
  ✅ skill         → load skills
  ✅ read          → state files only
  ✅ question      → ask user
  ✅ webfetch      → read-only external fetch (shared)

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

---

## Agents (18)

### Planning & Review

| Agent | Domain | What it handles |
|-------|--------|-----------------|
| `@planner` | Planning | Implementation plans, architecture, feature breakdowns |
| `@architect` | Planning | System design, scalability, technical decisions |
| `@code-reviewer` | Review | Code quality, maintainability, structured reports |
| `@security-reviewer` | Security | OWASP, vulns, auth, injection, secrets |
| `@plan-ceo-reviewer` | Review | Business viability, product alignment |
| `@plan-eng-reviewer` | Review | Engineering architecture, technical soundness |
| `@plan-design-reviewer` | Review | UX/design, interface, API ergonomics |
| `@plan-devex-reviewer` | Review | Developer experience, friction |

### Delivery

| Agent | Domain | What it handles |
|-------|--------|-----------------|
| `@tdd-guide` | Test | Red-green-refactor, 80%+ coverage enforcement |
| `@build-error-resolver` | Build-fix | tsc, bundler, compilation errors |
| `@e2e-runner` | Test | Playwright E2E tests, Page Object Model, CI/CD |
| `@database-reviewer` | Review | PostgreSQL, Supabase, queries, RLS, migrations |

### Docs & Cleanup

| Agent | Domain | What it handles |
|-------|--------|-----------------|
| `@doc-updater` | Docs | README, API docs syncing, codemaps |
| `@docs-lookup` | Docs | Library/API reference research |
| `@refactor-cleaner` | Refactor | Dead code removal, consolidation, duplicates |

### Autonomy & Support

| Agent | Domain | What it handles |
|-------|--------|-----------------|
| `@search-agent` | Search | Low-cost grep/glob/webfetch/websearch |
| `@loop-operator` | Autonomy | Long-running multi-iteration sessions |
| `@harness-optimizer` | General | Agent harness configuration, reliability |

---

## Commands (28)

| Command | Agent | Description |
|---------|-------|-------------|
| `/plan` | @planner | Create implementation plans |
| `/code-review` | @code-reviewer | Quality, security, maintainability review |
| `/security` | @security-reviewer | OWASP-based security audit |
| `/security-scan` | — | Full security scan |
| `/tdd` | @tdd-guide | Red-green-refactor cycle enforcement |
| `/build-fix` | @build-error-resolver | Build and type error resolution |
| `/e2e` | @e2e-runner | Playwright E2E test generation |
| `/orchestrate` | @planner | Multi-agent orchestration |
| `/refactor-clean` | @refactor-cleaner | Dead code and consolidation |
| `/update-docs` | @doc-updater | Sync docs with code |
| `/update-codemaps` | @doc-updater | Update codemap files |
| `/test-coverage` | @tdd-guide | Coverage report |
| `/checkpoint` | — | Save verification state and progress |
| `/eval` | — | Run evaluation against criteria |
| `/evolve` | — | Cluster instincts into skills |
| `/harness-audit` | — | Harness configuration audit |
| `/instinct-status` | — | View learned instincts |
| `/instinct-import` | — | Import instincts |
| `/instinct-export` | — | Export instincts |
| `/learn` | — | Extract patterns from session |
| `/loop-start` | — | Start autonomous loop |
| `/loop-status` | — | Check loop progress |
| `/projects` | — | List known projects and instinct stats |
| `/promote` | — | Promote instincts to global scope |
| `/quality-gate` | — | Run quality gates |
| `/setup-pm` | — | Configure package manager |
| `/skill-create` | — | Generate skills from git history |
| `/verify` | — | Run verification loop |

---

## Skills (11)

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

All skills are auto-discovered from `.opencode/skills/` on session start. Skills path is injected via config hook, cached after first scan — no redundant loading.

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

63 tests passing (145 assertions) covering:
- State machine validation (6 statuses, all valid transitions, all invalid rejections)
- Intent classification (implement, clarify, review, plan, debug, empty)
- Task scope classification (trivial, lightweight, complex)
- Tool access block structure
- Plan drift detection (in-scope, out-of-scope, empty)
- Index I/O round-trip (read/write, missing, schema migration)
- Active plan resolution (null, valid, gate blocking states)
- Plan creation (summary, tasks, drafts, ID increment, YAML write)
- Builtin plan creation (3-task template, auto-approve)
- Plan status transitions (valid, invalid, auto-clear on done)
- Plan quality assessment (scoring, cycles, missing fields)
- Plan file I/O (read, delete, nonexistent)
- Plan deletion (by ID, missing ID, active plan, YAML cleanup)
- Migration from legacy `.openecc` format

### Project Structure

```
.opencode/
├── commands/              ← 28 command templates (.md)
├── plans/                 ← Plan state (index.json + plan-00N.yaml)
├── plugins/
│   └── openecc.js         ← Bundled plugin output (git-tracked)
├── prompts/
│   └── agents/            ← 18 agent prompt files (.txt)
└── skills/                ← 11 skill directories, each with SKILL.md
    ├── soul/              ← Always active behavioral guidelines
    ├── orchestrator/
    ├── api-design/
    ├── backend-patterns/
    ├── coding-standards/
    ├── e2e-testing/
    ├── frontend-patterns/
    ├── security-review/
    ├── strategic-compact/
    ├── tdd-workflow/
    └── verification-loop/
src/
├── plugin.ts              ← Entrypoint — session hooks, config, transforms
├── plan-gate.ts           ← State machine, index I/O, intent, drift, quality
├── plan-gate.test.ts      ← 63 tests (145 assertions)
├── identity.ts            ← Package info, skills path resolution
└── execution.ts           ← Attempt tracking, execution context block
```

---

## Clearing Cache

Force a fresh installation:

```powershell
Remove-Item "$env:USERPROFILE\.cache\opencode\packages\openecc@git+https_*" -Recurse -Force
```

Then restart OpenCode.

---

## License

MIT
