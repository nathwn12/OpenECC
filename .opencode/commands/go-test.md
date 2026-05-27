---
description: "Go TDD workflow: write tests, implement, verify"
agent: openecc:tdd-guide
subtask: true
---

# Go Test Command

Implement Go code with TDD: $ARGUMENTS

## TDD Cycle
```
RED → GREEN → REFACTOR → REPEAT
```

1. **RED**: Write `_test.go` file with failing test cases
2. **GREEN**: Implement minimal code to pass
3. **REFACTOR**: Clean up while keeping tests green
4. **REPEAT**: Continue until feature complete

## Coverage
- Run `go test -coverprofile=coverage.out ./...`
- Verify `go tool cover -func=coverage.out` shows 80%+

---

**IMPORTANT**: Use `t.Run("subtest", ...)` for table-driven tests. Always use `require` or `assert` from `testify` if available.
