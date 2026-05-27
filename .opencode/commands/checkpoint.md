---
description: "Save verification state and progress checkpoint"
---

# Checkpoint Command

Save checkpoint for: $ARGUMENTS

## Checkpoint Format
```
CHECKPOINT: <name>
DATE: <iso-timestamp>
STATUS: <passing|failing|in-progress>
COMMIT: <sha>
VERIFICATION: <build|lint|test|all>
NOTES: <summary>
```

## Your Task
1. Run verification for current state
2. Record checkpoint metadata
3. Suggest next steps based on status
4. Commit checkpoint if requested

---

**TIP**: Checkpoints let you branch/experiment freely knowing you can restore verified state.
