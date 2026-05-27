---
description: "Fix Go compilation and build errors"
agent: openecc:go-build-resolver
subtask: true
---

# Go Build Command

Fix Go build errors for: $ARGUMENTS

## Your Task
1. Run `go build ./...` to identify errors
2. Run `go vet ./...` for additional diagnostics
3. Fix errors:
   - Import cycles → restructure packages
   - Type mismatches → fix signatures or casts
   - Missing modules → `go mod tidy` + `go mod download`
   - Lint errors → address each warning
4. Rebuild and verify clean output

---

**TIP**: Go build errors cascade — fix the first error in each file, rebuild, repeat.
