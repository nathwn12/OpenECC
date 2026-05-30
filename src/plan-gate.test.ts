import { describe, it, expect } from "bun:test"
import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import { fileURLToPath } from "node:url"
import {
  validatePlanTransition,
  VALID_TRANSITIONS,
  classifyIntent,
  classifyTaskScope,
  buildToolAccessBlock,
  checkPlanDrift,
  readPlanIndex,
  writePlanIndex,
  getActivePlan,
  updatePlanStatus,
  isValidProjectDir,
  createPlan,
  createBuiltinPlan,
  deletePlanById,
  COMPLEX_PATTERNS,
  assessPlanQuality,
  readPlanFile,
  deletePlanFile,
  migrateOpeneccState,
  type PlanIndex,
} from "./plan-gate"

// ── Helpers ────────────────────────────────────────────────────────────────

function tmpDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const base = path.join(currentDir, "..", ".openecc-test")
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true })
  return fs.mkdtempSync(path.join(base, "test-"))
}

function freshIndex(dir: string): PlanIndex {
  const idx: PlanIndex = {
    openeccVersion: "0.3",
    schemaVersion: 3,
    projectDir: dir,
    projectName: path.basename(dir),
    updatedAt: new Date().toISOString(),
    activePlanId: null,
    plans: [],
  }
  writePlanIndex(dir, idx)
  return idx
}

// ── Project Directory Validation ───────────────────────────────────────────

describe("isValidProjectDir", () => {
  it("returns true for dir with .git", () => {
    const dir = tmpDir()
    fs.mkdirSync(path.join(dir, ".git"))
    expect(isValidProjectDir(dir)).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it("returns true for dir with package.json", () => {
    const dir = tmpDir()
    fs.writeFileSync(path.join(dir, "package.json"), "{}")
    expect(isValidProjectDir(dir)).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it("returns true for dir with go.mod", () => {
    const dir = tmpDir()
    fs.writeFileSync(path.join(dir, "go.mod"), "")
    expect(isValidProjectDir(dir)).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it("returns true for dir with .opencode init marker", () => {
    const dir = tmpDir()
    fs.mkdirSync(path.join(dir, ".opencode"))
    expect(isValidProjectDir(dir)).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it("returns true for fresh empty project 2+ levels deep from home", () => {
    const home = os.homedir()
    const deepDir = path.join(home, "projects", "openecc-test-" + Date.now())
    fs.mkdirSync(deepDir, { recursive: true })
    expect(isValidProjectDir(deepDir)).toBe(true)
    fs.rmSync(deepDir, { recursive: true })
  })

  it("returns false for broad dir at home level", () => {
    const home = os.homedir()
    const broadDir = path.join(home, "openecc-broad-test-" + Date.now())
    fs.mkdirSync(broadDir, { recursive: true })
    expect(isValidProjectDir(broadDir)).toBe(false)
    fs.rmSync(broadDir, { recursive: true })
  })

  it("returns false for nonexistent path", () => {
    const dir = path.join(os.tmpdir(), "openecc-test-nonexistent-" + Date.now())
    expect(isValidProjectDir(dir)).toBe(false)
  })
})

// ── State Machine ──────────────────────────────────────────────────────────

describe("VALID_TRANSITIONS", () => {
  it("has all statuses as keys", () => {
    const statuses = ["draft", "approved", "in_progress", "done", "blocked", "abandoned"]
    for (const s of statuses) {
      expect(VALID_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("done and abandoned are terminal", () => {
    expect(VALID_TRANSITIONS.done).toEqual([])
    expect(VALID_TRANSITIONS.abandoned).toEqual([])
  })
})

describe("validatePlanTransition", () => {
  it("allows draft → approved", () => {
    expect(validatePlanTransition("draft", "approved")).toBe(true)
  })

  it("allows approved → in_progress", () => {
    expect(validatePlanTransition("approved", "in_progress")).toBe(true)
  })

  it("allows in_progress → done", () => {
    expect(validatePlanTransition("in_progress", "done")).toBe(true)
  })

  it("allows in_progress → blocked", () => {
    expect(validatePlanTransition("in_progress", "blocked")).toBe(true)
  })

  it("allows blocked → draft", () => {
    expect(validatePlanTransition("blocked", "draft")).toBe(true)
  })

  it("rejects draft → done (skip)", () => {
    expect(validatePlanTransition("draft", "done")).toBe(false)
  })

  it("rejects done → anything", () => {
    expect(validatePlanTransition("done", "draft")).toBe(false)
    expect(validatePlanTransition("done", "approved")).toBe(false)
  })

  it("rejects unknown statuses", () => {
    expect(validatePlanTransition("draft", "unknown")).toBe(false)
    expect(validatePlanTransition("foobar", "draft")).toBe(false)
  })
})

// ── Intent Classification ──────────────────────────────────────────────────

describe("classifyIntent", () => {
  it("classifies implementation requests", () => {
    const r = classifyIntent("implement the login page")
    expect(r.category).toBe("implement")
    expect(r.isWork).toBe(true)
  })

  it("classifies questions as non-work", () => {
    const r = classifyIntent("what is a closure?")
    expect(r.category).toBe("clarify")
    expect(r.isWork).toBe(false)
  })

  it("classifies review as non-work", () => {
    const r = classifyIntent("review the auth module")
    expect(r.category).toBe("review")
    expect(r.isWork).toBe(false)
  })

  it("classifies debug as work", () => {
    const r = classifyIntent("debug the login bug")
    expect(r.category).toBe("debug")
    expect(r.isWork).toBe(true)
  })

  it("handles empty input", () => {
    const r = classifyIntent("")
    expect(r.category).toBe("unknown")
    expect(r.isWork).toBe(false)
  })

  it('classifies "plan this then implement" as work', () => {
    const r = classifyIntent("plan this first, then implement it")
    expect(r.category).toBe("plan")
    expect(r.isWork).toBe(true)
  })

  it("classifies plan-only as non-work", () => {
    const r = classifyIntent("plan the architecture for this")
    expect(r.category).toBe("plan")
    expect(r.isWork).toBe(false)
  })

  it('classifies "design then build" as work', () => {
    const r = classifyIntent("design the data model then build the API")
    expect(r.category).toBe("implement")
    expect(r.isWork).toBe(true)
  })
})

// ── Tool Access Block ──────────────────────────────────────────────────────

describe("buildToolAccessBlock", () => {
  it("returns structured YAML", () => {
    const block = buildToolAccessBlock()
    expect(block).toContain('<structured type="tool_access">')
    expect(block).toContain("</structured>")
    expect(block).toContain("main_context_only")
    expect(block).toContain("subagent_only")
    expect(block).toContain("edit")
    expect(block).toContain("bash")
    expect(block).toContain("task")
  })
})

// ── Drift Detection ────────────────────────────────────────────────────────

describe("checkPlanDrift", () => {
  it("returns all good when files are in scope", () => {
    const r = checkPlanDrift(["src/foo.ts", "src/bar.ts"], ["src/foo.ts", "src/bar.ts"])
    expect(r.allGood).toBe(true)
    expect(r.inScope).toEqual(["src/foo.ts", "src/bar.ts"])
    expect(r.outOfScope).toEqual([])
  })

  it("detects out-of-scope files", () => {
    const r = checkPlanDrift(["src/foo.ts", "src/evil.ts"], ["src/foo.ts"])
    expect(r.allGood).toBe(false)
    expect(r.inScope).toEqual(["src/foo.ts"])
    expect(r.outOfScope).toEqual(["src/evil.ts"])
  })

  it("handles empty edited files", () => {
    const r = checkPlanDrift([], ["src/foo.ts"])
    expect(r.allGood).toBe(true)
    expect(r.inScope).toEqual([])
    expect(r.outOfScope).toEqual([])
  })
})

// ── Index I/O ──────────────────────────────────────────────────────────────

describe("readPlanIndex + writePlanIndex", () => {
  it("round-trips index.json", () => {
    const dir = tmpDir()
    freshIndex(dir)
    const idx = readPlanIndex(dir)
    expect(idx).not.toBeNull()
    expect(idx!.plans).toEqual([])
    expect(idx!.activePlanId).toBeNull()
    expect(idx!.schemaVersion).toBe(3)
    fs.rmSync(dir, { recursive: true })
  })

  it("returns null when no .opencode exists", () => {
    const dir = tmpDir()
    const idx = readPlanIndex(dir)
    expect(idx).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })
})

describe("getActivePlan", () => {
  it("returns null when no active plan", () => {
    const dir = tmpDir()
    freshIndex(dir)
    expect(getActivePlan(dir)).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })

  it("returns the active plan entry", () => {
    const dir = tmpDir()
    freshIndex(dir)
    const result = createPlan(dir, { summary: "test", status: "approved" })
    expect(result).not.toBeNull()
    const active = getActivePlan(dir)
    expect(active).not.toBeNull()
    expect(active!.id).toBe(result!.id)
    expect(active!.summary).toBe("test")
    expect(active!.completed).toBe(0)
    expect(active!.total).toBe(0)
    fs.rmSync(dir, { recursive: true })
  })
})

describe("COMPLEX_PATTERNS", () => {
  it("detects refactor as complex", () => {
    expect(classifyTaskScope("refactor the auth module")).toBe("complex")
  })

  it("detects migrate as complex", () => {
    expect(classifyTaskScope("migrate from webpack to vite")).toBe("complex")
  })

  it("does not flag simple work as complex", () => {
    expect(classifyTaskScope("add a button to the page")).toBe("lightweight")
    expect(classifyTaskScope("fix typo in header")).toBe("trivial")
  })

  it("TRIVIAL_PATTERNS catches trivial tasks", () => {
    expect(classifyTaskScope("typo in the header")).toBe("trivial")
    expect(classifyTaskScope("rename the button")).toBe("trivial")
  })

  it("COMPLEX_PATTERNS contains expected entries", () => {
    expect(COMPLEX_PATTERNS).toContain("refactor")
    expect(COMPLEX_PATTERNS).toContain("migrate")
    expect(COMPLEX_PATTERNS).toContain("architecture")
  })
})

describe("createPlan", () => {
  it("creates a plan in an empty directory", () => {
    const dir = tmpDir()
    const result = createPlan(dir, { summary: "fix the login button" })
    expect(result).not.toBeNull()
    expect(result!.id).toMatch(/^plan-\d{3}$/)
    expect(result!.summary).toBe("fix the login button")
    const idx = readPlanIndex(dir)
    expect(idx).not.toBeNull()
    expect(idx!.plans).toHaveLength(1)
    expect(idx!.activePlanId).toBe(result!.id)
    expect(idx!.plans[0].status).toBe("approved")
    fs.rmSync(dir, { recursive: true })
  })

  it("creates plan with draft status for complex tasks", () => {
    const dir = tmpDir()
    const result = createPlan(dir, { summary: "refactor the auth module", status: "draft" })
    expect(result).not.toBeNull()
    const idx = readPlanIndex(dir)
    expect(idx!.plans[0].status).toBe("draft")
    fs.rmSync(dir, { recursive: true })
  })

  it("increments plan IDs correctly", () => {
    const dir = tmpDir()
    const r1 = createPlan(dir, { summary: "first" })
    const r2 = createPlan(dir, { summary: "second" })
    expect(r1).not.toBeNull()
    expect(r2).not.toBeNull()
    expect(r2!.id).toBe("plan-002")
    const idx = readPlanIndex(dir)
    expect(idx!.plans).toHaveLength(2)
    expect(idx!.activePlanId).toBe(r2!.id)
    fs.rmSync(dir, { recursive: true })
  })

  it("writes YAML file correctly", () => {
    const dir = tmpDir()
    const result = createPlan(dir, { summary: "test summary" })
    const yamlPath = path.join(dir, ".opencode", "plans", `${result!.id}.yaml`)
    expect(fs.existsSync(yamlPath)).toBe(true)
    const content = fs.readFileSync(yamlPath, "utf8")
    expect(content).toContain("schema: openecc/plan-v1")
    expect(content).toContain("summary: test summary")
    expect(content).toContain("status: approved")
    fs.rmSync(dir, { recursive: true })
  })

  it("returns null on failure (e.g. invalid path)", () => {
    const badDir = os.tmpdir() + "\0-openecc-test-" + Date.now()
    const result = createPlan(badDir, { summary: "test" })
    expect(result).toBeNull()
  })

  it("accepts tasks in the plan", () => {
    const dir = tmpDir()
    const result = createPlan(dir, {
      summary: "multi-step task",
      status: "approved",
      tasks: [
        { summary: "Step 1", files: ["src/a.ts"], effort: "5min" },
        { summary: "Step 2", depends_on: ["task-001"], verification: "bun test" },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.plan.tasks).toHaveLength(2)
    expect(result!.plan.tasks[0].id).toBe("task-001")
    expect(result!.plan.tasks[0].summary).toBe("Step 1")
    expect(result!.plan.tasks[0].files).toEqual(["src/a.ts"])
    expect(result!.plan.tasks[1].depends_on).toEqual(["task-001"])
    expect(result!.plan.tasks[1].verification).toBe("bun test")
    const idx = readPlanIndex(dir)
    expect(idx!.plans[0].total).toBe(2)
    fs.rmSync(dir, { recursive: true })
  })

  it("truncates long summary", () => {
    const dir = tmpDir()
    const longMsg = "a".repeat(200)
    const result = createPlan(dir, { summary: longMsg })
    expect(result).not.toBeNull()
    expect(result!.summary.length).toBe(80)
    expect(result!.summary.endsWith("...")).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })
})

describe("createBuiltinPlan", () => {
  it("creates a plan with 3 auto-generated tasks", () => {
    const dir = tmpDir()
    const result = createBuiltinPlan(dir, "add dark mode toggle", "auto")
    expect(result).not.toBeNull()
    expect(result!.plan.tasks).toHaveLength(3)
    expect(result!.plan.tasks[0].id).toBe("task-001")
    expect(result!.plan.tasks[1].id).toBe("task-002")
    expect(result!.plan.tasks[2].id).toBe("task-003")
    expect(result!.plan.tasks[1].depends_on).toEqual(["task-001"])
    expect(result!.plan.plannerMode).toBe("builtin")
    expect(result!.plan.plannerSource).toBe("auto")
    const idx = readPlanIndex(dir)
    expect(idx!.plans[0].status).toBe("approved")
    expect(idx!.plans[0].total).toBe(3)
    expect(idx!.plans[0].plannerMode).toBe("builtin")
    fs.rmSync(dir, { recursive: true })
  })

  it("auto-approves builtin plans", () => {
    const dir = tmpDir()
    const result = createBuiltinPlan(dir, "quick fix")
    expect(result!.plan.status).toBe("approved")
    fs.rmSync(dir, { recursive: true })
  })
})

describe("deletePlanById", () => {
  it("deletes an existing plan", () => {
    const dir = tmpDir()
    const created = createPlan(dir, { summary: "test plan" })
    expect(created).not.toBeNull()
    const deleted = deletePlanById(dir, created!.id)
    expect(deleted).toBe(true)
    const idx = readPlanIndex(dir)
    expect(idx!.plans).toHaveLength(0)
    expect(idx!.activePlanId).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })

  it("returns false for missing ID", () => {
    const dir = tmpDir()
    freshIndex(dir)
    const result = deletePlanById(dir, "plan-999")
    expect(result).toBe(false)
    fs.rmSync(dir, { recursive: true })
  })

  it("clears activePlanId when deleting the active plan", () => {
    const dir = tmpDir()
    const created = createPlan(dir, { summary: "active plan" })
    const deleted = deletePlanById(dir, created!.id)
    expect(deleted).toBe(true)
    const idx = readPlanIndex(dir)
    expect(idx!.activePlanId).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })

  it("removes YAML file when deleting", () => {
    const dir = tmpDir()
    const created = createPlan(dir, { summary: "test plan" })
    const yamlPath = path.join(dir, ".opencode", "plans", `${created!.id}.yaml`)
    expect(fs.existsSync(yamlPath)).toBe(true)
    deletePlanById(dir, created!.id)
    expect(fs.existsSync(yamlPath)).toBe(false)
    fs.rmSync(dir, { recursive: true })
  })

  it("returns false for empty index", () => {
    const dir = tmpDir()
    const result = deletePlanById(dir, "plan-001")
    expect(result).toBe(false)
    fs.rmSync(dir, { recursive: true })
  })
})

describe("updatePlanStatus", () => {
  it("transitions approved → in_progress", () => {
    const dir = tmpDir()
    freshIndex(dir)
    const result = createPlan(dir, { summary: "test", status: "approved" })
    const err = updatePlanStatus(dir, result!.id, "in_progress")
    expect(err).toBeNull()
    const updated = getActivePlan(dir)
    expect(updated?.status).toBe("in_progress")
    fs.rmSync(dir, { recursive: true })
  })

  it("returns error for invalid transition", () => {
    const dir = tmpDir()
    freshIndex(dir)
    const result = createPlan(dir, { summary: "test", status: "draft" })
    const err = updatePlanStatus(dir, result!.id, "done")
    expect(err).not.toBeNull()
    expect(err).toContain("Invalid transition")
    fs.rmSync(dir, { recursive: true })
  })

  it("clears activePlanId on done", () => {
    const dir = tmpDir()
    freshIndex(dir)
    const result = createPlan(dir, { summary: "test", status: "approved" })
    updatePlanStatus(dir, result!.id, "in_progress")
    updatePlanStatus(dir, result!.id, "done", { done: 1 })
    const idx = readPlanIndex(dir)
    expect(idx?.activePlanId).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })
})

// ── Quality Gate ───────────────────────────────────────────────────────────

describe("assessPlanQuality", () => {
  it("scores 100 for a well-defined plan", () => {
    const dir = tmpDir()
    const result = createPlan(dir, {
      summary: "a solid plan",
      goal: "Achieve world peace through code",
      check: "All tests pass and deployment succeeds",
      tasks: [
        { summary: "Design API", files: ["src/api.ts"], verification: "types check" },
        { summary: "Implement", files: ["src/impl.ts"], depends_on: ["task-001"], verification: "bun test" },
        { summary: "Test", files: ["src/test.ts"], depends_on: ["task-002"], verification: "bun test" },
        { summary: "Deploy", files: ["deploy.sh"], depends_on: ["task-003"], verification: "deploy succeeds" },
      ],
    })
    const q = assessPlanQuality(result!.plan)
    expect(q.score).toBeGreaterThanOrEqual(80)
    fs.rmSync(dir, { recursive: true })
  })

  it("penalizes missing goal/check", () => {
    const dir = tmpDir()
    const result = createPlan(dir, {
      summary: "x",
      goal: "x",
      check: "",
      tasks: [],
    })
    const q = assessPlanQuality(result!.plan)
    expect(q.score).toBeLessThan(60)
    expect(q.report.length).toBeGreaterThan(0)
    fs.rmSync(dir, { recursive: true })
  })

  it("detects dependency cycles", () => {
    const dir = tmpDir()
    const result = createPlan(dir, {
      summary: "cyclic",
      goal: "testing cycle detection",
      check: "done",
      tasks: [
        { summary: "A", depends_on: ["task-002"] },
        { summary: "B", depends_on: ["task-001"] },
      ],
    })
    const q = assessPlanQuality(result!.plan)
    expect(q.report.some(r => r.includes("cycle"))).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it("allows low-quality plan transitions (quality gate removed)", () => {
    const dir = tmpDir()
    const result = createPlan(dir, {
      summary: "x",
      goal: "x",
      check: "",
      tasks: [],
      status: "draft",
    })
    const err = updatePlanStatus(dir, result!.id, "approved")
    expect(err).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })
})

// ── Plan File I/O ─────────────────────────────────────────────────────────

describe("readPlanFile", () => {
  it("reads back a plan file", () => {
    const dir = tmpDir()
    const result = createPlan(dir, { summary: "test read", tasks: [{ summary: "Task A" }] })
    const plan = readPlanFile(dir, result!.id)
    expect(plan).not.toBeNull()
    expect(plan!.id).toBe(result!.id)
    expect(plan!.tasks).toHaveLength(1)
    expect(plan!.tasks[0].summary).toBe("Task A")
    fs.rmSync(dir, { recursive: true })
  })

  it("returns null for nonexistent plan", () => {
    const dir = tmpDir()
    const plan = readPlanFile(dir, "plan-999")
    expect(plan).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })
})

describe("deletePlanFile", () => {
  it("deletes the yaml file", () => {
    const dir = tmpDir()
    const result = createPlan(dir, { summary: "to delete" })
    const f = path.join(dir, ".opencode", "plans", `${result!.id}.yaml`)
    expect(fs.existsSync(f)).toBe(true)
    deletePlanFile(dir, result!.id)
    expect(fs.existsSync(f)).toBe(false)
    fs.rmSync(dir, { recursive: true })
  })
})

// ── Migration ──────────────────────────────────────────────────────────────

describe("migrateOpeneccState", () => {
  it("migrates old format index.json to new schema", () => {
    const dir = tmpDir()
    const openecc = path.join(dir, ".openecc")
    fs.mkdirSync(openecc, { recursive: true })
    // Write old format
    fs.writeFileSync(path.join(openecc, "index.json"), JSON.stringify({
      nextId: 1,
      activePlanId: null,
      plans: [],
    }))
    const migrated = migrateOpeneccState(dir)
    expect(migrated).not.toBeNull()
    expect(migrated!.schemaVersion).toBe(3)
    expect(migrated!.projectName).toBe(path.basename(dir))
    fs.rmSync(dir, { recursive: true })
  })
})
