---
description: "Configure model routing for specific agents"
---

# Model Route Command

Set model routing for: $ARGUMENTS

## Format
```
model-routes:
  openecc:<agent-name>:
    model: <model-id>
    provider: <provider-name>
    mode: <auto|agent|chat>
    max_tokens: <number>
```

## Options
- `--model <name>` — Model identifier (e.g., `gpt-4o`, `claude-sonnet-4`)
- `--provider <name>` — Provider to use
- `--mode <mode>` — `auto`, `agent`, or `chat`
- `--reset` — Restore default routing
- `--list` — Show current routes

---

**TIP**: Use cheaper/faster models for linters/formatters, premium models for planners and reviewers.
