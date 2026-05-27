---
description: "Run quality gate: format, lint, type-check, test, security scan"
---

# Quality Gate Command

Run the quality pipeline for: $ARGUMENTS

## Pipeline
1. **Format** — Run formatter (Prettier, Biome, etc.)
2. **Lint** — Run linter (ESLint, Biome, etc.)
3. **Type Check** — Run `tsc --noEmit` for TypeScript
4. **Test** — Run test suite
5. **Security Audit** — Check for secrets and vulnerabilities
6. **Coverage Check** — Verify 80%+ threshold

## Arguments
- `[path|.]` — optional target path (default: current directory)
- `--fix` — allow auto-format/fix
- `--strict` — fail on warnings

## Output
Concise remediation list of all issues found, grouped by severity.
