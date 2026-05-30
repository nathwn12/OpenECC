---
name: orchestrator
description: "Enforces plan-first workflow, delegation to subagents, tool access partitioning, and plan gate compliance"
phase: "META"
use_when: "Always active. Controls session-level enforcement of plan gate, tool access rules, subagent delegation, and drift detection."
version: 1.0
---

## Use When

- Any session where plan enforcement, tool access control, or delegation rules are active
- Understanding the plan gate flow: plan must exist → be approved → match the request
- Understanding tool partitioning: main context = TALK + DELEGATE, subagent = all source work

## Core Rules

### 1. Plan Gate

Every implementation request is gated:

1. **No active plan** → Block. User must create `.openecc/plan-NNN.yaml` and register in `index.json`
2. **Plan not approved** → Block. Must transition: draft → reviewed → approved
3. **Plan blocked** → Block. Resolve blocker or create iteration
4. **Plan done/abandoned** → Block. Clear activePlanId or create new plan
5. **Plan approved/in_progress** → Gate open. Proceed.

Exceptions: Q&A, review requests, simple lookups pass through.

### 2. Auto-Plan

Lightweight requests (≤20 tokens, no architecture keywords) auto-create a plan in `approved` status. Complex work blocks with a gate warning.

### 3. Tool Access

```
MAIN CONTEXT ONLY (TALK + DELEGATE):
  - task        → spawn subagents
  - skill       → load skills
  - read        → .openecc/ state files only
  - question    → ask user
  - todowrite   → track progress

SUBAGENT ONLY (NEVER main context):
  - edit, write → source changes
  - glob, grep  → codebase search
  - bash        → commands

SHARED:
  - webfetch    → external docs
```

### 4. Drift Detection

After edits, the system checks if changed files are within the plan's declared scope. Out-of-scope edits trigger warnings.

### 5. State Machine

```
draft → reviewed → approved → in_progress → done
                                        → blocked → draft
```

All transitions are validated. Invalid transitions are rejected.

## Commands

- `/plan list` — show all plans
- `/plan status` — show active plan
- `/plan create <summary>` — create + activate plan
- `/plan transition <id> <status>` — transition plan status (validates state machine)

## What NOT to Do

- Do NOT work without a plan for multi-step tasks
- Do NOT call edit/write/bash/grep/glob in main context
- Do NOT start implementation if plan gate is closed
- Do NOT ignore drift warnings on out-of-scope edits
