import { describe, it, expect } from "bun:test"
import * as path from "node:path"
import * as fs from "node:fs"
import {
  validatePlanTransition,
  VALID_TRANSITIONS,
  classifyIntent,
  buildToolAccessBlock,
  checkPlanDrift,
  readPlanIndex,
  writePlanIndex,
  getActivePlan,
  getPlanGate,
  updatePlanStatus,
} from "./plan-gate"

// ── State Machine ──────────────────────────────────────────────────────────

describe("VALID_TRANSITIONS", () => {
  it("has all statuses as keys", () => {
    const statuses = ["draft", "reviewed", "ready", "approved", "in_progress", "done", "blocked", "abandoned"]
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
  it("allows draft → reviewed", () => {
    expect(validatePlanTransition("draft", "reviewed")).toBe(true)
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
})

// ── Tool Access Block ──────────────────────────────────────────────────────

describe("buildToolAccessBlock", () => {
  it("returns structured YAML", () => {
    const block = buildToolAccessBlock()
    expect(block).toContain("<structured type=\"tool_access\">")
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

// ── Index I/O (tmp dir) ────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(import.meta.dir, ".test-"))
}

function ensureIndex(dir: string): void {
  const d = path.join(dir, ".openecc")
  fs.mkdirSync(d, { recursive: true })
  writePlanIndex(dir, { nextId: 1, activePlanId: null, plans: [] })
}

describe("readPlanIndex + writePlanIndex", () => {
  it("round-trips index.json", () => {
    const dir = tmpDir()
    ensureIndex(dir)
    const idx = readPlanIndex(dir)
    expect(idx).not.toBeNull()
    expect(idx!.plans).toEqual([])
    expect(idx!.activePlanId).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })

  it("returns null when no .openecc exists", () => {
    const dir = tmpDir()
    const idx = readPlanIndex(dir)
    expect(idx).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })
})

describe("getActivePlan", () => {
  it("returns null when no active plan", () => {
    const dir = tmpDir()
    ensureIndex(dir)
    expect(getActivePlan(dir)).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })

  it("returns the active plan entry", () => {
    const dir = tmpDir()
    ensureIndex(dir)
    const idx = readPlanIndex(dir)!
    idx.plans.push({ id: 1, summary: "test", status: "approved", done: 0, total: 1 })
    idx.activePlanId = 1
    writePlanIndex(dir, idx)
    const active = getActivePlan(dir)
    expect(active).not.toBeNull()
    expect(active!.id).toBe(1)
    expect(active!.summary).toBe("test")
    fs.rmSync(dir, { recursive: true })
  })
})

describe("getPlanGate", () => {
  it("returns null gate when plan is approved + active", () => {
    const dir = tmpDir()
    ensureIndex(dir)
    const idx = readPlanIndex(dir)!
    idx.plans.push({ id: 1, summary: "test", status: "approved", done: 0, total: 1 })
    idx.activePlanId = 1
    writePlanIndex(dir, idx)
    expect(getPlanGate(dir)).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })

  it("blocks when no active plan", () => {
    const dir = tmpDir()
    ensureIndex(dir)
    const gate = getPlanGate(dir)
    expect(gate).not.toBeNull()
    expect(gate).toContain("ACTION REQUIRED")
    fs.rmSync(dir, { recursive: true })
  })

  it("blocks when plan is blocked", () => {
    const dir = tmpDir()
    ensureIndex(dir)
    const idx = readPlanIndex(dir)!
    idx.plans.push({ id: 1, summary: "test", status: "blocked", done: 0, total: 1 })
    idx.activePlanId = 1
    writePlanIndex(dir, idx)
    const gate = getPlanGate(dir)
    expect(gate).not.toBeNull()
    expect(gate).toContain("BLOCKED")
    fs.rmSync(dir, { recursive: true })
  })

  it("blocks when plan is draft", () => {
    const dir = tmpDir()
    ensureIndex(dir)
    const idx = readPlanIndex(dir)!
    idx.plans.push({ id: 1, summary: "test", status: "draft", done: 0, total: 1 })
    idx.activePlanId = 1
    writePlanIndex(dir, idx)
    const gate = getPlanGate(dir)
    expect(gate).not.toBeNull()
    expect(gate).toContain("NOT READY")
    fs.rmSync(dir, { recursive: true })
  })
})

describe("updatePlanStatus", () => {
  it("transitions approved → in_progress", () => {
    const dir = tmpDir()
    ensureIndex(dir)
    const idx = readPlanIndex(dir)!
    idx.plans.push({ id: 1, summary: "test", status: "approved", done: 0, total: 1 })
    idx.activePlanId = 1
    writePlanIndex(dir, idx)

    const err = updatePlanStatus(dir, 1, "in_progress")
    expect(err).toBeNull()

    const updated = getActivePlan(dir)
    expect(updated?.status).toBe("in_progress")
    fs.rmSync(dir, { recursive: true })
  })

  it("returns error for invalid transition", () => {
    const dir = tmpDir()
    ensureIndex(dir)
    const idx = readPlanIndex(dir)!
    idx.plans.push({ id: 1, summary: "test", status: "draft", done: 0, total: 1 })
    idx.activePlanId = 1
    writePlanIndex(dir, idx)

    const err = updatePlanStatus(dir, 1, "done")
    expect(err).not.toBeNull()
    expect(err).toContain("Invalid transition")
    fs.rmSync(dir, { recursive: true })
  })

  it("clears activePlanId on done", () => {
    const dir = tmpDir()
    ensureIndex(dir)
    const idx = readPlanIndex(dir)!
    idx.plans.push({ id: 1, summary: "test", status: "in_progress", done: 0, total: 1 })
    idx.activePlanId = 1
    writePlanIndex(dir, idx)

    updatePlanStatus(dir, 1, "done", { done: 1 })
    const updated = readPlanIndex(dir)
    expect(updated?.activePlanId).toBeNull()
    fs.rmSync(dir, { recursive: true })
  })
})
