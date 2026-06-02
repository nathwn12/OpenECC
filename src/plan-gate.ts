import * as path from "node:path"
import { getOpenEccVersion } from "./identity"
import {
  type ActivePlanResult,
  type PlanData,
  type PlanIndex,
  type PlanIndexEntry,
  type PlanStatus,
  type TaskStatus,
  type TaskScope,
  VALID_TRANSITIONS,
  validatePlanTransition,
  assessPlanQuality,
  classifyIntent,
  classifyTaskScope,
  buildToolAccessBlock,
  buildPlanGateBlock,
  checkPlanDrift,
  isValidProjectDir,
  COMPLEX_PATTERNS,
  TRIVIAL_PATTERNS,
} from "./plan-policy"
import {
  allocatePlanId,
  createPlanEntry,
  deletePlanFile,
  getActivePlan,
  migrateOpeneccState,
  readPlanFile,
  readPlanIndex,
  writePlanFile,
  writePlanIndex,
} from "./plan-store"

export type { ActivePlanResult, PlanData, PlanIndex, PlanIndexEntry, PlanStatus, TaskStatus, TaskScope }
export {
  VALID_TRANSITIONS,
  validatePlanTransition,
  assessPlanQuality,
  classifyIntent,
  classifyTaskScope,
  buildToolAccessBlock,
  buildPlanGateBlock,
  checkPlanDrift,
  isValidProjectDir,
  COMPLEX_PATTERNS,
  TRIVIAL_PATTERNS,
  readPlanFile,
  writePlanFile,
  deletePlanFile,
  readPlanIndex,
  writePlanIndex,
  migrateOpeneccState,
  getActivePlan,
}

function now(): string {
  return new Date().toISOString()
}

function freshIndex(worktreePath: string): PlanIndex {
  return {
    openeccVersion: getOpenEccVersion(),
    schemaVersion: 3,
    projectDir: worktreePath,
    projectName: path.basename(worktreePath),
    updatedAt: now(),
    activePlanId: null,
    plans: [],
  }
}

export function createPlan(
  worktreePath: string,
  input: {
    summary: string
    goal?: string
    check?: string
    status?: PlanStatus
    tasks?: Array<{
      summary: string
      status?: TaskStatus
      files?: string[]
      depends_on?: string[]
      effort?: string
      verification?: string
    }>
    parent?: string
    plannerMode?: "builtin" | "full"
    plannerSource?: "auto" | "user" | "gate"
    plan_notes?: string[]
  },
): ActivePlanResult | null {
  try {
    const idx = readPlanIndex(worktreePath) || freshIndex(worktreePath)
    const pid = allocatePlanId(worktreePath)
    const ts = now()
    const status = input.status || "approved"

    const tasks = (input.tasks || []).map((t, i) => ({
      id: `task-${String(i + 1).padStart(3, "0")}`,
      summary: t.summary,
      status: t.status || "pending",
      files: t.files || [],
      depends_on: t.depends_on || [],
      effort: t.effort,
      verification: t.verification,
    }))

    const summary = input.summary.length > 80 ? input.summary.slice(0, 77) + "..." : input.summary

    const planData: PlanData = {
      schema: "openecc/plan-v1",
      id: pid,
      version: 1,
      createdAt: ts,
      updatedAt: ts,
      status,
      parent: input.parent || null,
      goal: input.goal || summary,
      check: input.check || "TBD",
      summary,
      tasks,
      plan_notes: input.plan_notes || [],
      plannerMode: input.plannerMode,
      plannerSource: input.plannerSource,
    }

    writePlanFile(worktreePath, planData)

    const entry: PlanIndexEntry = createPlanEntry(planData)
    idx.plans.push(entry)
    idx.activePlanId = pid
    idx.updatedAt = ts
    writePlanIndex(worktreePath, idx)

    return { id: pid, summary, plan: planData }
  } catch {
    return null
  }
}

export function createBuiltinPlan(
  worktreePath: string,
  goal: string,
  source: "auto" | "user" | "gate" = "auto",
): ActivePlanResult | null {
  const summary = goal.length > 80 ? goal.slice(0, 77) + "..." : goal
  const truncatedGoal = goal.length > 200 ? goal.slice(0, 197) + "..." : goal
  return createPlan(worktreePath, {
    summary,
    goal: truncatedGoal,
    status: "approved",
    tasks: [
      {
        summary: `Confirm the smallest scope for: ${goal.length > 60 ? goal.slice(0, 57) + "..." : goal}`,
        status: "pending",
        depends_on: [],
        effort: "2min",
      },
      {
        summary: "Implement the change in the primary file or module",
        status: "pending",
        depends_on: ["task-001"],
        effort: "5min",
      },
      {
        summary: "Verify the result with a focused test or manual check",
        status: "pending",
        depends_on: ["task-002"],
        effort: "3min",
        verification: "bun test or relevant verification",
      },
    ],
    plannerMode: "builtin",
    plannerSource: source,
  })
}

export function deletePlanById(worktreePath: string, id: string): boolean {
  try {
    const idx = readPlanIndex(worktreePath)
    if (!idx) return false
    const filtered = idx.plans.filter(p => p.id !== id)
    if (filtered.length === idx.plans.length) return false
    idx.plans = filtered
    if (idx.activePlanId === id) idx.activePlanId = null
    writePlanIndex(worktreePath, idx)
    deletePlanFile(worktreePath, id)
    return true
  } catch {
    return false
  }
}

export function updatePlanStatus(
  worktreePath: string,
  id: string,
  newStatus: string,
  updates?: { done?: number; total?: number },
): string | null {
  const idx = readPlanIndex(worktreePath)
  if (!idx) return "No plan index found"
  const entry = idx.plans.find(p => p.id === id)
  if (!entry) return `Plan ${id} not found`
  if (!validatePlanTransition(entry.status, newStatus)) {
    return `Invalid transition: ${entry.status} → ${newStatus}. Valid: ${(VALID_TRANSITIONS[entry.status] || []).join(", ") || "none (terminal state)"}`
  }

  entry.status = newStatus as PlanStatus
  entry.updatedAt = now()
  if (updates?.done !== undefined) entry.completed = updates.done
  if (updates?.total !== undefined) entry.total = updates.total

  if (newStatus === "done" || newStatus === "abandoned") {
    if (idx.activePlanId === id) idx.activePlanId = null
  }
  if (newStatus === "approved" || newStatus === "in_progress") {
    idx.activePlanId = id
  }

  idx.updatedAt = now()
  writePlanIndex(worktreePath, idx)

  const plan = readPlanFile(worktreePath, id)
  if (plan) {
    plan.status = newStatus as PlanStatus
    plan.updatedAt = now()
    writePlanFile(worktreePath, plan)
  }

  return null
}
