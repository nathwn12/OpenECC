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

## Verification Checklist

### Code Quality
- [ ] No TypeScript errors
- [ ] No lint warnings
- [ ] No console.log statements
- [ ] Functions < 50 lines
- [ ] Files < 800 lines

### Tests
- [ ] All tests passing
- [ ] Coverage >= 80%
- [ ] Edge cases covered
- [ ] Error conditions tested

### Security
- [ ] No hardcoded secrets
- [ ] Input validation present
- [ ] No SQL injection risks
- [ ] No XSS vulnerabilities

### Build
- [ ] Build succeeds
- [ ] No warnings
- [ ] Bundle size acceptable

## Verification Report

### Summary
- Status: PASS / FAIL
- Score: X/Y checks passed

### Details
| Check | Status | Notes |
|-------|--------|-------|
| TypeScript | PASS/FAIL | [details] |
| Lint | PASS/FAIL | [details] |
| Tests | PASS/FAIL | [details] |
| Coverage | PASS/FAIL | XX% (target: 80%) |
| Build | PASS/FAIL | [details] |

### Action Items
[If FAIL, list what needs to be fixed]

---

**TIP**: Run `/verify` before any commit to catch regressions early.
