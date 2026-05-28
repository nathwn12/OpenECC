---
description: "Review Rust code for safety, idiomatic patterns, and correctness"
agent: rust-reviewer
subtask: true
---

# Rust Review Command

Review Rust code: $ARGUMENTS

## Your Task
1. Run `cargo check` for compilation errors
2. Run `cargo clippy -- -D warnings` for lint
3. Check for common Rust anti-patterns
4. Review ownership, borrowing, and lifetime usage

## What to Check
- Unnecessary clones (use borrows where possible)
- Missing error handling (prefer `Result` over `panic`)
- Unwrapped `Option`/`Result` (prefer `?` or pattern matching)
- Lifetime elision opportunities
- Deadlocks in async code (use `tokio::spawn` correctly)

---

**TIP**: Run `cargo fmt --check` and `cargo clippy` before any Rust commit.
