---
description: "Extract patterns, preferences, and decisions from session"
---

# Learn Command

Extract patterns from: $ARGUMENTS

## Pattern Extraction Workflow
1. **Review session** — Read recent git log, chat history, and decisions
2. **Identify patterns** — Coding style, architecture decisions, tool preferences
3. **Document instincts** — Save to `.opencode/instincts/` with:
   - Pattern description
   - Context/trigger
   - Recommended action
   - Evidence (commit hash, file refs)
4. **Review with user** — Present patterns for confirmation

---

**TIP**: Patterns should be specific enough to guide future behavior but general enough to apply across similar situations.
