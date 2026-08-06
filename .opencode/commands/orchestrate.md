---
description: "Orchestrate multiple agents for complex multi-step tasks"
agent: planner
subtask: true
---

# Orchestrate Command

Orchestrate specialized agents for: $ARGUMENTS

## Your Task
1. **Analyze task complexity** and break into subtasks
2. **Identify optimal agents** for each subtask
3. **Create execution plan** with dependencies
4. **Coordinate execution** — parallel where possible
5. **Synthesize results** into unified output

## Available Agents

| Agent | Specialty | Use For |
|-------|-----------|---------|
| planner | Implementation planning | Complex feature design |
| architect | System design | Architectural decisions |
| code-reviewer | Code quality | Review changes |
| security-reviewer | Security analysis | Vulnerability detection |
| tdd-guide | Test-driven dev | Feature implementation |
| build-error-resolver | Build fixes | TypeScript/build errors |
| e2e-runner | E2E testing | User flow testing |
| doc-updater | Documentation | Updating docs |
| docs-lookup | Docs research | Library/API lookups |
| refactor-cleaner | Code cleanup | Dead code removal |
| database-reviewer | Database | Query optimization |
| loop-operator | Autonomous loops | Monitor/steer long loops |
| harness-optimizer | Harness config | Reliability/cost tuning |
| search-agent | Codebase search | Find code by intent |
| go-reviewer | Go | Go-specific review |
| go-build-resolver | Go | Go build errors |
| cpp-reviewer | C++ | C++ review |
| cpp-build-resolver | C++ | C++ build errors |
| java-reviewer | Java | Java/Spring review |
| java-build-resolver | Java | Java/Maven/Gradle builds |
| kotlin-reviewer | Kotlin | Kotlin/Android review |
| kotlin-build-resolver | Kotlin | Kotlin/Gradle builds |
| php-reviewer | PHP | PHP/Laravel review |
| python-reviewer | Python | Python review |
| rust-reviewer | Rust | Rust review |
| rust-build-resolver | Rust | Rust/Cargo builds |
| plan-ceo-reviewer | Plan QA | Plan business-value review |
| plan-design-reviewer | Plan QA | Plan design review |
| plan-devex-reviewer | Plan QA | Plan developer-experience review |
| plan-eng-reviewer | Plan QA | Plan engineering review |

## Orchestration Patterns

### Sequential Execution
```
planner → tdd-guide → code-reviewer → security-reviewer
```
Use when: Later tasks depend on earlier results

### Parallel Execution
```
         ┌→ security-reviewer
planner →├→ code-reviewer
         └→ architect
```
Use when: Tasks are independent

### Fan-Out/Fan-In
```
         ┌→ agent-1 ─┐
planner →├→ agent-2 ─┼→ synthesizer
         └→ agent-3 ─┘
```
Use when: Multiple perspectives needed

## Execution Plan Format

### Phase 1: [Name]
- Agent: [agent-name]
- Task: [specific task]
- Depends on: [none or previous phase]

### Phase 2: [Name] (parallel)
- Agent A: [agent-name]
  - Task: [specific task]
- Agent B: [agent-name]
  - Task: [specific task]
- Depends on: Phase 1

### Phase 3: Synthesis
- Combine results from Phase 2
- Generate unified output

## Dispatch Rules
- **Independent work** — dispatch in parallel
- **Sequential dependencies** — chain agents with handoff
- **Conflicting output** — use last-writer-wins unless specified
- **Plan before execute** — create full execution plan first
- **Minimize handoffs** — reduce context switching
- **Clear boundaries** — each agent has specific scope

---

**IMPORTANT**: Each subtask must produce a verifiable artifact. Complex tasks benefit from multi-agent orchestration. Simple tasks should use single agents directly.
