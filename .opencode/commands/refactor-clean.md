---
description: "Remove dead code, consolidate duplicates, improve structure"
agent: openecc:refactor-cleaner
subtask: true
---

# Refactor Clean Command

Clean up code for: $ARGUMENTS

## Your Task
1. Find dead code (unused exports, unreachable branches, commented code)
2. Find duplicate logic (extract into shared functions/modules)
3. Apply surgical refactors — touch only what needs changing
4. Verify tests still pass after each change

## Approach
### DO:
- Remove unused imports, variables, functions, exports
- Extract repeated logic into single shared implementation
- Prefer small focused functions over monoliths

### DON'T:
- Don't "improve" adjacent code not related to the task
- Don't reformat or restyle files
- Don't introduce new abstractions for single-use code

---

**TIP**: Run `npm run lint -- --fix` after cleaning to re-check.
