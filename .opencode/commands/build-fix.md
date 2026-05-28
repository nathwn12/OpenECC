---
description: "Fix build and TypeScript errors"
agent: build-error-resolver
subtask: true
---

# Build Fix Command

Fix build and TypeScript errors for: $ARGUMENTS

## Your Task
1. Run `tsc --noEmit` to identify errors
2. Categorize errors by type (type, import, syntax, missing module)
3. Fix each error with minimal changes
4. Re-run build to verify all errors resolved

## Approach
### DO:
- Fix root causes, not symptoms
- Prefer type narrowing over `any`
- Create missing interfaces/types when needed

### DON'T:
- Don't use `@ts-ignore` or `@ts-expect-error`
- Don't change working code to satisfy the linter
- Don't upgrade types in bulk unrelated changes

---

**TIP**: Fix errors in dependency order — leaf files first, then their consumers.
