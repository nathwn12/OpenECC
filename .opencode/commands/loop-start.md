---
description: "Start autonomous agent loop for continuous improvement"
---

# Loop Start Command

Start a managed autonomous loop pattern with safety defaults: $ARGUMENTS

## Usage

`/loop-start [pattern] [--mode safe|fast] [--max-iterations <n>]`

- `pattern`: `sequential`, `continuous-pr`, `rfc-dag`, `infinite`
- `--mode`:
  - `safe` (default): strict quality gates and checkpoints
  - `fast`: reduced gates for speed

## Loop Phases
1. **Plan** — Evaluate priority, create plan
2. **Do** — Execute plan step
3. **Verify** — Run verification pipeline
4. **Learn** — Extract patterns, save instincts
5. **Repeat** — Continue until completion or explicit stop

## Flow

1. Confirm repository state and branch strategy.
2. Select loop pattern and model tier strategy.
3. Enable required hooks/profile for the chosen mode.
4. Create loop plan and write runbook under `.opencode/plans/`.
5. Print commands to start and monitor the loop.

## Required Safety Checks

- Verify tests pass before first loop iteration.
- Ensure plugin hooks are active (not globally disabled).
- Ensure loop has explicit stop condition.
- Use `--max-iterations` to bound execution.

## Arguments

$ARGUMENTS:
- `<pattern>` optional (`sequential|continuous-pr|rfc-dag|infinite`)
- `--mode safe|fast` optional
- `--max-iterations <n>` optional

---

**IMPORTANT**: The loop creates commits and instincts automatically. Use `--max-iterations` to bound execution.
