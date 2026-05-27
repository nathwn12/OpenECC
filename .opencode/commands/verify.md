---
description: "Run full verification loop: build, lint, test, coverage, security"
---

# Verify Command

Run verification pipeline for: $ARGUMENTS

## Pipeline
1. **Build** — Run build system (tsc, cargo build, go build, etc.)
2. **Lint** — Run linter (ESLint, Biome, Clippy, etc.)
3. **Type Check** — Run type checker with strict mode
4. **Test** — Run all tests (unit + integration)
5. **Coverage** — Verify 80%+ threshold
6. **Security** — Run dependency + secrets scan

## Output
- Pass/fail per stage
- Remediation list for failures
- Coverage report summary

---

**TIP**: Run `/verify` before any commit to catch regressions early.
