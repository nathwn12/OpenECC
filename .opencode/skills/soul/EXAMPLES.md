# Soul — Anti-Pattern Examples

12 before/after examples showing common LLM coding mistakes across the 4 soul principles.

---

## #1: Silent config format assumption

**Principle:** Think Before Coding

**Anti-pattern (BEFORE):**
```typescript
// Assume every project has package.json
const hasPackageJson = fs.existsSync(path.join(cwd, "package.json"))
if (hasPackageJson) {
  const pm = fs.readFileSync(path.join(cwd, "package.json"), "utf8")
  // parse lockfile...
}
```

**Why it's wrong:**
Assumes `package.json` implies a Node project. Doesn't consider Go, Rust, Python projects that would have other marker files.

**Pattern (AFTER):**
```typescript
const markers = ["package.json", "go.mod", "Cargo.toml", "pyproject.toml"]
const detected = markers.find(m => fs.existsSync(path.join(cwd, m)))
if (!detected) {
  return JSON.stringify({ detected: false, message: "No supported project detected" })
}
```

**Why it's better:**
Checks for all known project markers up front instead of silently returning partial data. Surfaces the assumption explicitly.

---

## #2: Hidden ambiguity in path resolution

**Principle:** Think Before Coding

**Anti-pattern (BEFORE):**
```typescript
export function readPlanIndex(worktreePath: string): PlanIndex {
  const f = path.join(worktreePath, ".openecc", "index.json")
  return JSON.parse(fs.readFileSync(f, "utf8"))
}
```

**Why it's wrong:**
Asserts `worktreePath` is always defined and the file always exists. If either is wrong, throws an uncatchable error upstream.

**Pattern (AFTER):**
```typescript
export function readPlanIndex(worktreePath: string): PlanIndex | null {
  try {
    const f = path.join(worktreePath, ".openecc", "index.json")
    if (!fs.existsSync(f)) return null
    return JSON.parse(fs.readFileSync(f, "utf8"))
  } catch {
    return null
  }
}
```

**Why it's better:**
Surfaces the two failure modes (missing file, invalid JSON) explicitly. Callers know to handle `null` instead of crashing.

---

## #3: Not surfacing a simpler approach

**Principle:** Think Before Coding

**Anti-pattern (BEFORE):**
```typescript
const formatterCommands = new Map<string, { command: string; checkFlag: string }>()
formatterCommands.set("biome", { command: "npx biome format --write .", checkFlag: "npx biome format ." })
formatterCommands.set("prettier", { command: "npx prettier --write .", checkFlag: "npx prettier --check ." })
// ... more entries ...
const entry = formatterCommands.get(formatter)
```

**Why it's wrong:**
Uses a Map object for a static, known-at-write-time mapping. Over-engineered lookup for what is really a record.

**Pattern (AFTER):**
```typescript
const formatterCommands: Record<string, { command: string; checkFlag: string }> = {
  biome: { command: `npx biome format --write ${target}`, checkFlag: `npx biome format ${target}` },
  prettier: { command: `npx prettier --write ${target}`, checkFlag: `npx prettier --check ${target}` },
}
const entry = formatterCommands[formatter]
```

**Why it's better:**
Uses a plain object literal — the simplest structure for a static mapping. Less code, no constructor overhead, same behavior.

---

## #4: Factory abstraction for one usage

**Principle:** Simplicity First

**Anti-pattern (BEFORE):**
```typescript
interface ToolFactory {
  create(name: string): Tool
}

class DefaultToolFactory implements ToolFactory {
  create(name: string): Tool {
    switch (name) {
      case "format": return formatCommandTool
      case "lint": return lintCommandTool
      case "security": return securityAuditTool
      default: throw new Error(`Unknown tool: ${name}`)
    }
  }
}

const factory = new DefaultToolFactory()
const tool = factory.create("format")
```

**Why it's wrong:**
Abstract factory pattern for three known tools used once at registration. No tests, no DI container — just ceremony.

**Pattern (AFTER):**
```typescript
const tools = {
  format: formatCommandTool,
  lint: lintCommandTool,
  security: securityAuditTool,
}
const tool = tools[name]
if (!tool) throw new Error(`Unknown tool: ${name}`)
```

**Why it's better:**
A plain object lookup replaces 20+ lines of boilerplate. Same behavior, zero abstraction tax.

---

## #5: Error handling for impossible scenarios

**Principle:** Simplicity First

**Anti-pattern (BEFORE):**
```typescript
function hashKey(s: string): string {
  if (typeof s !== "string") throw new TypeError("hashKey requires a string")
  if (s.length === 0) return ""
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36).slice(0, 6)
}
```

**Why it's wrong:**
Type guard against non-string input in a TypeScript codebase — the compiler already enforces this. Empty-string early return changes behavior for no reason.

**Pattern (AFTER):**
```typescript
function hashKey(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36).slice(0, 6)
}
```

**Why it's better:**
Removes dead guards that TypeScript already handles. The function does exactly one thing with no branching.

---

## #6: Speculative "flexibility" parameter

**Principle:** Simplicity First

**Anti-pattern (BEFORE):**
```typescript
export function buildToolAccessBlock(
  format: "yaml" | "json" | "xml" = "yaml",
  includeHeader: boolean = true,
  indentation: number = 2
): string {
```

**Why it's wrong:**
Three parameters for a function with exactly one caller that passes zero arguments. Speculative configurability that's never used.

**Pattern (AFTER):**
```typescript
export function buildToolAccessBlock(): string {
```

**Why it's better:**
Zero parameters because the output format is fixed. If configurability is needed later, add it then — not before.

---

## #7: Reformatting unrelated code while editing

**Principle:** Surgical Changes

**Anti-pattern (BEFORE):**
```typescript
// I was asked to add a validation check, so I "cleaned up" the whole function
function validatePlanTransition(current: string, next: string): boolean {
  const allowed = VALID_TRANSITIONS[current]
  if (!allowed) return false
  return allowed.includes(next as PlanStatus)
}

// After my edit:
function validatePlanTransition(current: string, next: string): boolean {
  const allowed = VALID_TRANSITIONS[current]
  if (!allowed || !allowed.length) return false
  return allowed.includes(next as PlanStatus)
}
// Also reformatted the object above from 6 lines to 8 lines with trailing commas
```

**Why it's wrong:**
Added `!allowed.length` (dead code — null already handled) and reformatted an unrelated block. Two changed lines turn into 15.

**Pattern (AFTER):**
```typescript
function validatePlanTransition(current: string, next: string): boolean {
  const allowed = VALID_TRANSITIONS[current]
  if (!allowed) return false
  return allowed.includes(next as PlanStatus)
}
```

**Why it's better:**
Touched zero lines because the validation logic was already correct. Every changed line traces to the user's request.

---

## #8: Refactoring adjacent code not in scope

**Principle:** Surgical Changes

**Anti-pattern (BEFORE):**
```typescript
// Task: Add comment validation. But I also "improved" the unrelated README parsing.
const planContent = readFileSafe(planYamlPath)
// ... comment validation logic ...

// Then I refactored readFileSafe "while I was here"
export function readFileSafe(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, "utf8")
    return content.trim() // Added trim() to be "cleaner"
  } catch {
    return ""
  }
}
```

**Why it's wrong:**
`trim()` breaks existing callers that expect trailing newlines (e.g., stripYamlFrontmatter's regex). Refactoring unrelated utilities during a feature task introduces regressions.

**Pattern (AFTER):**
```typescript
// Only touched the plan-review function. readFileSafe remains unchanged.
const planContent = readPlanYaml(planYamlPath)
if (!planContent) return

// ... comment validation using planContent directly ...
```

**Why it's better:**
Zero changes outside the scope of the feature. If a utility needs refactoring, file a separate issue.

---

## #9: Removing pre-existing dead code during feature work

**Principle:** Surgical Changes

**Anti-pattern (BEFORE):**
```typescript
// I noticed an unused function setting up plans, so I deleted it
// while implementing goal budget tracking:
function readPlanFile(worktreePath: string): string | null { ... }
// Deleted: "nobody uses this"

// But also in my PR: changed writePlanIndex to add atomic write
export function writePlanIndex(worktreePath: string, index: PlanIndex): void {
  const f = indexJsonPath(worktreePath)
  fs.writeFileSync(f, JSON.stringify(index, null, 2), "utf8")
}
```

**Why it's wrong:**
Deleting unrelated dead code bloats the diff and risks breaking something if `readPlanFile` is used elsewhere. Reviewers can't tell what's relevant.

**Pattern (AFTER):**
```typescript
// Only change: atomic write. Mentioned unused function in a comment.
export function writePlanIndex(worktreePath: string, index: PlanIndex): void {
  const f = indexJsonPath(worktreePath)
  const tmp = f + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2), "utf8")
  fs.renameSync(tmp, f)
}
// Note: readPlanFile at line 42 appears unused — consider cleanup in a follow-up.
```

**Why it's better:**
The diff is exactly one concern (atomic write). The unused function is mentioned for follow-up, not silently removed.

---

## #10: Implementing without success criteria

**Principle:** Goal-Driven Execution

**Anti-pattern (BEFORE):**
```typescript
// Task: "Add plan drift detection"
function checkPlanDrift(editedFiles: string[], planScope: string[]): DriftResult {
  const planSet = new Set(planScope)
  const inScope = editedFiles.filter(f => planSet.has(f))
  const outOfScope = editedFiles.filter(f => !planSet.has(f))
  return { inScope, outOfScope, allGood: outOfScope.length === 0 }
}
```

**Why it's wrong:**
Implemented in one shot with no test, no verification, no definition of what "drift" means concretely. Is "allGood" when scope is empty? When every file is in scope?

**Pattern (AFTER):**
```typescript
// Step 1: write test first
it("detects out-of-scope files", () => {
  const result = checkPlanDrift(["src/a.ts"], ["src/a.ts", "src/b.ts"])
  expect(result.allGood).toBe(true)
  expect(result.outOfScope).toEqual([])
})

// Step 2: implement to pass
function checkPlanDrift(editedFiles: string[], planScope: string[]): DriftResult {
  const planSet = new Set(planScope)
  const inScope: string[] = []
  const outOfScope: string[] = []
  for (const f of editedFiles) {
    if (planSet.has(f)) inScope.push(f)
    else outOfScope.push(f)
  }
  return { inScope, outOfScope, allGood: outOfScope.length === 0 }
}
```

**Why it's better:**
Success criteria are defined as executable tests. "Done" means the tests pass, not "I think it works."

---

## #11: Not looping — assuming it worked

**Principle:** Goal-Driven Execution

**Anti-pattern (BEFORE):**
```typescript
// Goal: "Add auto-continue on idle"
// I wrote this and declared it done
shouldAutoContinue(): boolean {
  if (!this.isActive()) return false
  return (Date.now() - this.state!.lastActiveAt) >= IDLE_DELAY_MS
}
```

**Why it's wrong:**
Wrote the method, did a mental "looks right," moved on. Never wired it into the session loop or verified it fires at the right time.

**Pattern (AFTER):**
```typescript
// 1. Write test proving correct behavior
it("returns true after idle delay", async () => {
  vi.useFakeTimers()
  const manager = new GoalManager("/tmp")
  manager.start("test goal")
  expect(manager.shouldAutoContinue()).toBe(false)
  vi.advanceTimersByTime(IDLE_DELAY_MS + 1000)
  expect(manager.shouldAutoContinue()).toBe(true)
})

// 2. Implement
shouldAutoContinue(): boolean {
  if (!this.isActive()) return false
  return (Date.now() - this.state!.lastActiveAt) >= IDLE_DELAY_MS
}

// 3. Wire into session event handler, then verify with a real run
```

**Why it's better:**
Verification loop is explicit: test → implement → wire → observe. Not "looks right, ship it."

---

## #12: Scope creep from vague goal

**Principle:** Goal-Driven Execution

**Anti-pattern (BEFORE):**
```typescript
// Goal: "Improve plan creation"
// Scope spiraled:
// - Added YAML validation
// - Added JSON schema generation
// - Created migration tool from old format
// - Updated all existing plan files
// - Wrote migration docs
// Original ask: "make /plan create handle missing .openecc dir"
```

**Why it's wrong:**
A 5-line fix became a 500-line project. Each addition was defensible individually, but none was asked for.

**Pattern (AFTER):**
```typescript
// Goal: "Handle missing .openecc dir in /plan create"
// Scope:
// 1. mkdirSync in autoCreatePlan — done
// 2. Test: call createPlan with no .openecc dir, verify it's created — done
// 3. Done.
```

**Why it's better:**
Bound the goal to a single verifiable condition. Future improvements (validation, schema, migration) get their own goals with their own success criteria.
