---
description: "Analyze test coverage and identify gaps"
agent: openecc:tdd-guide
subtask: true
---

# Test Coverage Command

Analyze test coverage for: $ARGUMENTS

## Your Task
1. Run coverage report
2. Identify uncovered files/functions/branches
3. Prioritize gaps by risk (core logic > utils > UI)
4. Generate coverage report with actionable gaps

## Coverage Targets
| Type | Minimum |
|------|---------|
| Core business logic | 90% |
| Utility functions | 80% |
| UI components | 70% |

---

**TIP**: Focus on untested branches and error paths — happy paths are usually covered.
