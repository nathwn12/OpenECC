import * as fs from "node:fs"
import * as path from "node:path"
import { getOpenEccVersion } from "./identity"
import type { ActivePlanResult, PlanData, PlanIndex, PlanIndexEntry, PlanStatus } from "./plan-policy"
import { parsePlanYaml, serializePlanYaml } from "./plan-yaml"

function stateDir(worktreePath: string): string {
  return path.join(worktreePath, ".opencode")
}

function indexJsonPath(worktreePath: string): string {
  return path.join(stateDir(worktreePath), "index.json")
}

function plansDirPath(worktreePath: string): string {
  return path.join(stateDir(worktreePath), "plans")
}

function planYamlPath(worktreePath: string, planId: string): string {
  return path.join(plansDirPath(worktreePath), `${planId}.yaml`)
}

function now(): string {
  return new Date().toISOString()
}

function nextPlanId(idx: PlanIndex): string {
  const maxN = idx.plans.reduce((m, p) => {
    const n = parseInt(p.id.replace("plan-", ""), 10)
    return isNaN(n) ? m : Math.max(m, n)
  }, 0)
  return `plan-${String(maxN + 1).padStart(3, "0")}`
}

export function readPlanFile(worktreePath: string, planId: string): PlanData | null {
  try {
    const f = planYamlPath(worktreePath, planId)
    if (!fs.existsSync(f)) return null
    const raw = fs.readFileSync(f, "utf8")
    return parsePlanYaml(raw)
  } catch {
    return null
  }
}

export function writePlanFile(worktreePath: string, plan: PlanData): void {
  const yaml = serializePlanYaml(plan)
  const f = planYamlPath(worktreePath, plan.id)
  const dir = path.dirname(f)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = f + ".tmp"
  fs.writeFileSync(tmp, yaml, "utf8")
  fs.renameSync(tmp, f)
}

export function deletePlanFile(worktreePath: string, planId: string): void {
  const f = planYamlPath(worktreePath, planId)
  if (fs.existsSync(f)) fs.unlinkSync(f)
}

export function readPlanIndex(worktreePath: string): PlanIndex | null {
  try {
    const f = indexJsonPath(worktreePath)
    if (!fs.existsSync(f)) return null
    const raw = JSON.parse(fs.readFileSync(f, "utf8"))
    if (raw.schemaVersion === 3) return raw as PlanIndex
    if (raw.schemaVersion === 1) {
      raw.schemaVersion = 3
      writePlanIndex(worktreePath, raw as PlanIndex)
      return raw as PlanIndex
    }
    return migrateOpeneccState(worktreePath)
  } catch {
    return null
  }
}

export function writePlanIndex(worktreePath: string, index: PlanIndex): void {
  const f = indexJsonPath(worktreePath)
  const dir = path.dirname(f)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = f + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2), "utf8")
  fs.renameSync(tmp, f)
}

export function migrateOpeneccState(worktreePath: string): PlanIndex | null {
  const legacy = path.join(worktreePath, ".openecc")
  if (!fs.existsSync(legacy)) return null
  const old = fs.readdirSync(legacy).filter(f => /^plan-\d+\.yaml$/.test(f))
  const plansDir = plansDirPath(worktreePath)
  if (!fs.existsSync(plansDir)) fs.mkdirSync(plansDir, { recursive: true })
  for (const f of old) {
    try {
      fs.cpSync(path.join(legacy, f), path.join(plansDir, f), { force: true })
    } catch { /* skip corrupt */ }
  }
  const oldIndex = path.join(legacy, "index.json")
  if (fs.existsSync(oldIndex)) {
    try {
      const raw = JSON.parse(fs.readFileSync(oldIndex, "utf8"))
      const migrated: PlanIndex = {
        openeccVersion: getOpenEccVersion(),
        schemaVersion: 3,
        projectDir: worktreePath,
        projectName: path.basename(worktreePath),
        updatedAt: new Date().toISOString(),
        activePlanId: raw.activePlanId ?? null,
        plans: (raw.plans || []).map((p: Record<string, unknown>) => ({
          id: String(p.id || ""),
          status: (p.status as PlanStatus) || "draft",
          createdAt: String(p.createdAt || new Date().toISOString()),
          updatedAt: String(p.updatedAt || new Date().toISOString()),
          parent: p.parent ? String(p.parent) : undefined,
          summary: String(p.summary || ""),
          total: Number(p.total || 0),
          completed: Number(p.completed || 0),
          blocked: Number(p.blocked || 0),
          file: p.file ? String(p.file) : "",
          plannerMode: p.plannerMode as "builtin" | "full" | undefined,
          plannerSource: p.plannerSource as "auto" | "user" | "gate" | undefined,
        })),
      }
      writePlanIndex(worktreePath, migrated)
      return migrated
    } catch { /* fall through to nuke */ }
  }
  const fresh: PlanIndex = {
    openeccVersion: getOpenEccVersion(),
    schemaVersion: 3,
    projectDir: worktreePath,
    projectName: path.basename(worktreePath),
    updatedAt: new Date().toISOString(),
    activePlanId: null,
    plans: [],
  }
  writePlanIndex(worktreePath, fresh)
  return fresh
}

export function getActivePlan(worktreePath: string): PlanIndexEntry | null {
  const idx = readPlanIndex(worktreePath)
  if (!idx || idx.activePlanId === null) return null
  return idx.plans.find(p => p.id === idx.activePlanId) ?? null
}

export function createPlanEntry(plan: PlanData): PlanIndexEntry {
  return {
    id: plan.id,
    status: plan.status,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    parent: plan.parent || undefined,
    summary: plan.summary,
    total: plan.tasks.length,
    completed: 0,
    blocked: 0,
    file: `plans/${plan.id}.yaml`,
    plannerMode: plan.plannerMode,
    plannerSource: plan.plannerSource,
  }
}

export function allocatePlanId(worktreePath: string): string {
  const idx = readPlanIndex(worktreePath) || {
    openeccVersion: getOpenEccVersion(),
    schemaVersion: 3,
    projectDir: worktreePath,
    projectName: path.basename(worktreePath),
    updatedAt: now(),
    activePlanId: null,
    plans: [],
  }
  return nextPlanId(idx)
}
