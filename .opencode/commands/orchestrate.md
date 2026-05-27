---
description: "Orchestrate multiple agents for complex multi-step tasks"
agent: openecc:planner
subtask: true
---

# Orchestrate Command

Orchestrate agents for: $ARGUMENTS

## Your Task
1. Decompose task into independent subtasks
2. Dispatch subtasks to appropriate agents in parallel
3. Collect results and reconcile conflicts
4. Produce a unified output

## Dispatch Rules
- **Independent work** — dispatch in parallel
- **Sequential dependencies** — chain agents with handoff
- **Conflicting output** — use last-writer-wins unless specified

---

**IMPORTANT**: Each subtask must produce a verifiable artifact.
