---
description: "Rust TDD workflow: write tests, implement, verify"
agent: tdd-guide
subtask: true
---

# Rust Test Command

Implement Rust code with TDD: $ARGUMENTS

## TDD Cycle
```
RED → GREEN → REFACTOR → REPEAT
```

1. **RED**: Write `#[cfg(test)]` module with failing tests
2. **GREEN**: Implement minimal code to pass
3. **REFACTOR**: Clean up while keeping tests green
4. **REPEAT**: Continue until feature complete

## Coverage
- Run `cargo tarpaulin` or `cargo llvm-cov` for coverage
- Verify 80%+ coverage threshold

---

**IMPORTANT**: Use `#[test]` attributes and descriptive test names. Prefer `assert_eq!`, `assert_ne!`, and `assert!` macros over manual checks.
