# OpenECC — Engineering Code Companion

This file provides persistent guidelines for every session.

## Soul Principles (Always Active)

### Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity First
- Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### Surgical Changes
- Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Remove imports/variables/functions that YOUR changes made unused.

### Goal-Driven Execution
- Define success criteria. Loop until verified.
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"

---

## Security Guidelines

### Mandatory Security Checks (Before Any Commit)
- No hardcoded secrets (API keys, passwords, tokens)
- All user inputs validated
- SQL injection prevention (parameterized queries)
- XSS prevention (sanitized HTML)
- CSRF protection enabled
- Authentication/authorization verified
- Rate limiting on all endpoints
- Error messages don't leak sensitive data

### Secret Management
```typescript
// NEVER: Hardcoded secrets
const apiKey = "sk-proj-xxxxx"

// ALWAYS: Environment variables
const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error("OPENAI_API_KEY not configured")
```

### Security Response Protocol
If security issue found:
1. STOP immediately
2. Use **security-reviewer** agent or `/security` command
3. Fix CRITICAL issues before continuing
4. Rotate any exposed secrets
5. Review entire codebase for similar issues

---

## Coding Standards

### Immutability
ALWAYS create new objects, NEVER mutate:
```javascript
// WRONG: Mutation
function updateUser(user, name) { user.name = name; return user }

// CORRECT: Immutability
function updateUser(user, name) { return { ...user, name } }
```

### File Organization
- MANY SMALL FILES > FEW LARGE FILES
- High cohesion, low coupling
- 200-400 lines typical, 800 max
- Extract utilities from large components
- Organize by feature/domain, not by type

### Error Handling
ALWAYS handle errors comprehensively:
```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  console.error("Operation failed:", error)
  throw new Error("Detailed user-friendly message")
}
```

### Code Quality Checklist
Before marking work complete:
- Code is readable and well-named
- Functions are small (<50 lines)
- Files are focused (<800 lines)
- No deep nesting (>4 levels)
- Proper error handling
- No console.log statements
- No hardcoded values
- No mutation (immutable patterns used)

---

## Testing Requirements

### Target: 80%+ Coverage

Test Types (ALL required):
1. **Unit Tests** — Individual functions, utilities, components
2. **Integration Tests** — API endpoints, database operations
3. **E2E Tests** — Critical user flows (Playwright)

### TDD Workflow (MANDATORY)
1. Write test first (RED)
2. Run test — it should FAIL
3. Write minimal implementation (GREEN)
4. Run test — it should PASS
5. Refactor (IMPROVE)
6. Verify coverage (80%+)

---

## Git Workflow

### Commit Message Format
```
<type>: <description>

<optional body>
```
Types: feat, fix, refactor, docs, test, chore, perf, ci

### Pull Request Workflow
1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch

### Feature Implementation Workflow
1. **Plan** — Use planner agent or `/plan` command
2. **TDD** — Use tdd-guide agent or `/tdd` command
3. **Code Review** — Use code-reviewer agent or `/review` command
4. **Security Review** — Use security-reviewer agent or `/security`
5. **Quality Gate** — Run `/quality-gate` before committing

---

## Available Agents

| Agent | Purpose | Command |
|-------|---------|---------|
| planner | Implementation planning | `/plan` |
| code-reviewer | Code quality and security review | `/review` |
| security-reviewer | Security vulnerability analysis | `/security` |
| tdd-guide | Test-driven development | `/tdd` |

---

## Available Tools

| Tool | Purpose |
|------|---------|
| `run-tests` | Auto-detect PM + test framework, build test commands |
| `changed-files` | List files modified in current session |
| `git-summary` | Show branch, status, recent commits, staged/unstaged diffs |
| `format-code` | Detect formatter and return format command |
| `lint-check` | Detect linter and return lint command |
| `security-audit` | Three-phase: dependency audit, secret scan, code anti-pattern check |
