---
description: "Enforce TDD workflow with 80%+ test coverage"
agent: tdd-guide
subtask: true
---

# TDD Command

Implement the following using strict test-driven development: $ARGUMENTS

## TDD Cycle (MANDATORY)
```
RED → GREEN → REFACTOR → REPEAT
```

1. **RED**: Write a failing test FIRST
2. **GREEN**: Write minimal code to pass the test
3. **REFACTOR**: Improve code while keeping tests green
4. **REPEAT**: Continue until feature complete

## Coverage Requirements
| Code Type | Minimum |
|-----------|---------|
| Standard code | 80% |
| Security-critical code | 100% |

**MANDATORY**: Tests must be written BEFORE implementation. Never skip the RED phase.

*Note: When invoked as subtask, the `$ARGUMENTS` variable contains the full user-provided arguments string.*
