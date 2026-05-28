---
description: "Remove dead code, consolidate duplicates, improve structure"
agent: openecc:refactor-cleaner
subtask: true
---

# Refactor Clean Command

Analyze and clean up the codebase: $ARGUMENTS

## Your Task
1. **Detect dead code** using analysis tools
2. **Identify duplicates** and consolidation opportunities
3. **Safely remove** unused code with documentation
4. **Verify** no functionality broken

## Detection Phase

### Run Analysis Tools
```bash
# Find unused exports
npx knip

# Find unused dependencies
npx depcheck

# Find unused TypeScript exports
npx ts-prune
```

### Manual Checks
- Unused functions (no callers)
- Unused variables
- Unused imports
- Commented-out code
- Unreachable code
- Unused CSS classes

## Removal Phase

### Before Removing
1. **Search for usage** — grep, find references
2. **Check exports** — might be used externally
3. **Verify tests** — no test depends on it
4. **Document removal** — git commit message

### Safe Removal Order
1. Remove unused imports first (safest)
2. Remove unused private functions
3. Remove unused exported functions
4. Remove unused types/interfaces
5. Remove unused files
6. Consolidate duplicates

## Consolidation Phase

### Identify Duplicates
- Similar functions with minor differences
- Copy-pasted code blocks
- Repeated patterns

### Consolidation Strategies
1. **Extract utility function** — for repeated logic
2. **Create shared constants** — for magic values
3. **Use higher-order functions** — for repeated patterns
4. **Parameterize differences** — for near duplicates

## Verification

After cleanup:
1. `npm run build` — builds successfully
2. `npm test` — all tests pass
3. `npm run lint` — no new lint errors

## Report Format
```
Removed:
  - file.ts: functionName (unused export)
  - utils.ts: helperFunction (no callers)

Consolidated:
  - formatDate() and formatDateTime() → dateUtils.format()

Remaining (manual review needed):
  - oldComponent.tsx: potentially unused, verify with team
```

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
**CAUTION**: Always verify before removing. When in doubt, ask or add `// TODO: verify usage` comment.
