---
description: "Auto-detect and configure package manager settings"
---

# Setup PM Command

Configure package manager for: $ARGUMENTS

## Your Task
1. Detect available lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lock)
2. Detect project requirements (engines in package.json)
3. Configure `.npmrc` / `.yarnrc` / `.pnpmrc` with:
   - Registry (default npm or custom)
   - Node version engine requirements
   - Workspace configuration if monorepo
4. Run install to verify configuration works

---

**TIP**: Keep only one lock file type — delete conflicting lock files before committing.
