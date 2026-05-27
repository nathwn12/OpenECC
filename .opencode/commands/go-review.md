---
description: "Review Go code for idiomatic patterns and correctness"
agent: openecc:go-reviewer
subtask: true
---

# Go Review Command

Review Go code: $ARGUMENTS

## Your Task
1. Run `go vet ./...` for static analysis
2. Run `golangci-lint run` for comprehensive linting
3. Check for common Go anti-patterns
4. Review error handling and idiomatic patterns

## What to Check
- Error handling (never ignore errors)
- Proper use of interfaces (accept interfaces, return structs)
- Goroutine leak potential
- Context propagation
- Naming conventions (PascalCase exported, camelCase private)

---

**TIP**: Run `go mod tidy` to clean up dependencies after review changes.
