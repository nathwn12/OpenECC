---
description: "Execute full engineering pipeline: plan, review, build, test, ship"
agent: swarm-coordinator
---

# Swarm Command

Execute full pipeline for: $ARGUMENTS

The argument to /swarm IS the goal. Stored as the active plan in `.openecc/`.

## Pipeline Phases

1. **Think** — Parse goal, scope, constraints
2. **Plan** — Generate plan, save as `.openecc/plan-NNN.yaml`, update `index.json`
3. **Review** — 4-axis review (CEO, Design, DevEx, Eng) in parallel. Returns Block/Warn/Suggest.
4. **Build** — Delegate implementation tasks, respect 5-agent cap
5. **Review + Test** — Code review, security scan, test suite
6. **Evaluate** — `goal-evaluator` checks goal met from conversation context
7. **Ship** — If evaluated Met, summarize deliverables
8. **Reflect** — Call learn, update plan notes

## Concurrency
- Max **5** live subagents per session
- Reviewers run in parallel (max 4)
- New subagents wait for an active one to finish

## Bootstrap
- On session start, plugin reads `.openecc/index.json` and injects active plan state into system prompt
- AI always knows the goal, status, completion counts — no file ops needed

## State
- `.openecc/index.json` — single source of truth, `activePlanId` pointer
- `.openecc/plan-NNN.yaml` — individual plans, never mutated (new iteration = new file)
- Entire `.openecc/` is gitignored — local-only planning

## Aliases
- `/make` — identical behavior
