---
description: "Fix Rust compilation and build errors"
agent: rust-build-resolver
subtask: true
---

# Rust Build Command

Fix Rust build errors for: $ARGUMENTS

## Your Task
1. Run `cargo check` for initial diagnostics
2. Run `cargo build` for full compilation
3. Fix errors:
   - Lifetime/borrow checker → restructure ownership
   - Missing traits → implement or derive
   - Type mismatches → fix signatures or conversions
   - Feature flags → check `Cargo.toml` features
4. Run `cargo clippy -- -D warnings` for lint
5. Rebuild and verify clean output

---

**TIP**: Read the compiler error carefully — Rust's error messages often include actionable suggestions.
