---
description: "Import instincts from external file"
---

# Instinct Import Command

Import instincts from: $ARGUMENTS

## Your Task
1. Validate source file format (YAML/JSON instinct schema)
2. Check for conflicts with existing instincts
3. Merge into `.opencode/instincts/` with:
   - Deduplication by name+description signature
   - Conflict resolution (prefer newer or manual, prompt on tie)
4. Report import summary (new, updated, skipped counts)

---

**IMPORTANT**: Imported instincts are auto-tagged with their source for traceability.
