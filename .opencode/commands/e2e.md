---
description: "Generate and run Playwright E2E tests"
agent: e2e-runner
subtask: true
---

# E2E Command

Generate and run Playwright E2E tests for: $ARGUMENTS

## Your Task
1. Identify target pages/user flows
2. Generate Playwright test with Page Object Model
3. Run tests with `npx playwright test`
4. Report pass/fail with traces on failure

## Test Structure
- `tests/e2e/pages/` — Page Object classes
- `tests/e2e/specs/` — Test specs
- `tests/e2e/fixtures/` — Test data

---

**TIP**: Use `--trace on` for first run, `--retries 2` in CI.
