import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// ── State Machine ──────────────────────────────────────────────────────────

export type PlanStatus =
  | "draft"
  | "reviewed"
  | "ready"
  | "approved"
  | "in_progress"
  | "done"
  | "blocked"
  | "abandoned"

export const VALID_TRANSITIONS: Record<string, PlanStatus[]> = {
  draft:      ["reviewed", "abandoned"],
  reviewed:   ["ready", "approved", "draft", "abandoned"],
  ready:      ["in_progress", "abandoned"],
  approved:   ["in_progress", "abandoned"],
  in_progress:["done", "blocked", "abandoned"],
  blocked:    ["draft", "abandoned"],
  done:       [],
  abandoned:  [],
}

export function validatePlanTransition(current: string, next: string): boolean {
  const allowed = VALID_TRANSITIONS[current]
  if (!allowed) return false
  return allowed.includes(next as PlanStatus)
}

// ── Types ──────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "done" | "blocked"

export interface PlanTask {
  id: string
  summary: string
  status: TaskStatus
  files: string[]
  depends_on: string[]
  effort?: string
  verification?: string
}

export interface PlanData {
  schema: string
  id: string
  version: number
  createdAt: string
  updatedAt: string
  status: PlanStatus
  parent: string | null
  goal: string
  check: string
  summary: string
  tasks: PlanTask[]
  plan_notes: string[]
  plannerMode?: "builtin" | "full"
  plannerSource?: "auto" | "user" | "gate"
}

export interface PlanIndexEntry {
  id: string
  status: PlanStatus
  createdAt: string
  updatedAt: string
  parent?: string
  summary: string
  total: number
  completed: number
  blocked: number
  file: string
  plannerMode?: "builtin" | "full"
  plannerSource?: "auto" | "user" | "gate"
}

export interface PlanIndex {
  openeccVersion: string
  schemaVersion: number
  projectDir: string
  projectName: string
  updatedAt: string
  activePlanId: string | null
  plans: PlanIndexEntry[]
  retention?: {
    maxAgeDays: number
    terminalStatuses: string[]
  }
}

export interface ActivePlanResult {
  id: string
  summary: string
  plan: PlanData
}

export type TaskScope = "trivial" | "lightweight" | "complex"

// ── Write Queue ────────────────────────────────────────────────────────────

let _indexWriteQueue: Promise<void> = Promise.resolve()

// ── Paths ──────────────────────────────────────────────────────────────────

function openeccDir(worktreePath: string): string {
  return path.join(worktreePath, ".openecc")
}

function indexJsonPath(worktreePath: string): string {
  return path.join(openeccDir(worktreePath), "index.json")
}

function planYamlPath(worktreePath: string, planId: string): string {
  return path.join(openeccDir(worktreePath), `${planId}.yaml`)
}

function plansDirPath(worktreePath: string): string {
  return openeccDir(worktreePath)
}

// ── Plan File I/O ──────────────────────────────────────────────────────────

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

// ── Index I/O ──────────────────────────────────────────────────────────────

export function readPlanIndex(worktreePath: string): PlanIndex | null {
  try {
    const f = indexJsonPath(worktreePath)
    if (!fs.existsSync(f)) return null
    const raw = JSON.parse(fs.readFileSync(f, "utf8"))
    if (raw.schemaVersion === 3) return raw as PlanIndex
    // Old schema — migrate
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
  _indexWriteQueue = _indexWriteQueue.then(() => {}).catch(() => {})
}

// ── Migration ──────────────────────────────────────────────────────────────

export function migrateOpeneccState(worktreePath: string): PlanIndex | null {
  // Old format had numeric ids under schemaVersion 1/2
  // Nuke and start fresh — simplest migration path
  try {
    const d = openeccDir(worktreePath)
    if (!fs.existsSync(d)) return null
    // Remove old yaml files (they were flat, no tasks)
    const old = fs.readdirSync(d).filter(f => /^plan-\d+\.yaml$/.test(f))
    for (const f of old) fs.unlinkSync(path.join(d, f))
    // Write fresh index
    const fresh: PlanIndex = {
      openeccVersion: "0.3",
      schemaVersion: 3,
      projectDir: worktreePath,
      projectName: path.basename(worktreePath),
      updatedAt: new Date().toISOString(),
      activePlanId: null,
      plans: [],
      retention: { maxAgeDays: 7, terminalStatuses: ["done", "abandoned"] },
    }
    writePlanIndex(worktreePath, fresh)
    return fresh
  } catch {
    return null
  }
}

// ── Active Plan ────────────────────────────────────────────────────────────

export function getActivePlan(worktreePath: string): PlanIndexEntry | null {
  const idx = readPlanIndex(worktreePath)
  if (!idx || idx.activePlanId === null) return null
  return idx.plans.find(p => p.id === idx.activePlanId) ?? null
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

function nextTaskId(tasks: PlanTask[]): string {
  const maxN = tasks.reduce((m, t) => {
    const n = parseInt(t.id.replace("task-", ""), 10)
    return isNaN(n) ? m : Math.max(m, n)
  }, 0)
  return `task-${String(maxN + 1).padStart(3, "0")}`
}

// ── Plan Quality Gate ──────────────────────────────────────────────────────

export function assessPlanQuality(plan: PlanData): { score: number; report: string[] } {
  const report: string[] = []
  let score = 0

  if (plan.goal && plan.goal.length >= 10) {
    score += 10
  } else {
    report.push("Goal is too short or missing (max -10)")
  }

  if (plan.check && plan.check.length >= 5) {
    score += 15
  } else {
    report.push("Check/completion criteria is missing or too short (max -15)")
  }

  if (plan.tasks.length > 0) score += 10
  if (plan.tasks.length >= 2) score += 8
  if (plan.tasks.length >= 3) score += 7

  const tasksWithVer = plan.tasks.filter(t => t.verification?.trim())
  score += Math.round((tasksWithVer.length / Math.max(plan.tasks.length, 1)) * 20)

  if (!detectCycle(plan.tasks)) {
    score += 10
  } else {
    report.push("Task dependencies contain a cycle (max -10)")
  }

  const tasksWithFiles = plan.tasks.filter(t => t.files.length > 0)
  score += Math.min(tasksWithFiles.length * 3, 10)

  if (plan.tasks.length <= 12) {
    score += 10
  } else {
    report.push(`Too many tasks: ${plan.tasks.length} (max 12) (max -10)`)
  }

  return { score, report }
}

function detectCycle(tasks: PlanTask[]): boolean {
  const adj = new Map<string, string[]>()
  for (const t of tasks) adj.set(t.id, t.depends_on)
  const visited = new Set<string>()
  const inStack = new Set<string>()
  function dfs(id: string): boolean {
    if (inStack.has(id)) return true
    if (visited.has(id)) return false
    visited.add(id)
    inStack.add(id)
    for (const dep of adj.get(id) || []) {
      if (dfs(dep)) return true
    }
    inStack.delete(id)
    return false
  }
  for (const t of tasks) {
    if (dfs(t.id)) return true
  }
  return false
}

// ── Plan Scope Classification (3-tier) ─────────────────────────────────────

export const COMPLEX_PATTERNS = [
  "refactor", "migrate", "rewrite", "architecture", "restructure",
  "redesign", "overhaul", "reorganize", "rearchitect",
]

export const TRIVIAL_PATTERNS = [
  "typo", "semicolon", "rename", "format", "comment", "spelling",
]

export function isComplexTask(text: string): boolean {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return tokens.some(t => COMPLEX_PATTERNS.includes(t))
}

export function isTrivialTask(text: string): boolean {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (text.length < 20) return true
  return tokens.some(t => TRIVIAL_PATTERNS.includes(t))
}

export function classifyTaskScope(text: string): TaskScope {
  if (isComplexTask(text)) return "complex"
  if (isTrivialTask(text)) return "trivial"
  return "lightweight"
}

// ── Plan Creation ──────────────────────────────────────────────────────────

function buildPlanStub(worktreePath: string): { idx: PlanIndex } {
  const idx = readPlanIndex(worktreePath) || {
    openeccVersion: "0.3",
    schemaVersion: 3,
    projectDir: worktreePath,
    projectName: path.basename(worktreePath),
    updatedAt: now(),
    activePlanId: null,
    plans: [],
    retention: { maxAgeDays: 7, terminalStatuses: ["done", "abandoned"] },
  }
  return { idx }
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
    const { idx } = buildPlanStub(worktreePath)
    const pid = nextPlanId(idx)
    const ts = now()
    const status = input.status || "approved"

    const tasks: PlanTask[] = (input.tasks || []).map((t, i) => ({
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

    const total = tasks.length
    const entry: PlanIndexEntry = {
      id: pid,
      status,
      createdAt: ts,
      updatedAt: ts,
      parent: input.parent,
      summary,
      total,
      completed: 0,
      blocked: 0,
      file: `${pid}.yaml`,
      plannerMode: input.plannerMode,
      plannerSource: input.plannerSource,
    }

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

// ── Plan Deletion ─────────────────────────────────────────────────────────

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

// ── Plan Status Updates ────────────────────────────────────────────────────

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

  // Quality gate: require score >= 60 before transitioning to reviewed or ready
  if (newStatus === "reviewed" || newStatus === "ready") {
    const plan = readPlanFile(worktreePath, id)
    if (plan) {
      const q = assessPlanQuality(plan)
      if (q.score < 60) {
        return `Plan quality score ${q.score}/100 is below minimum 60. Issues: ${q.report.join("; ") || "none"}`
      }
    }
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

  // Also update the plan file status
  const plan = readPlanFile(worktreePath, id)
  if (plan) {
    plan.status = newStatus as PlanStatus
    plan.updatedAt = now()
    writePlanFile(worktreePath, plan)
  }

  return null
}

// ── Project Directory Validation ───────────────────────────────────────────

const PROJECT_MARKERS = [".git", "package.json", "go.mod", "Cargo.toml", "pyproject.toml", "composer.json", "Gemfile", "project.json", "pubspec.yaml", "mix.exs"]
const INIT_MARKERS = [".opencode", ".openecc"]

export function isValidProjectDir(dir: string): boolean {
  try {
    const stat = fs.statSync(dir)
    if (!stat.isDirectory()) return false
    const resolved = path.resolve(dir)
    if (PROJECT_MARKERS.some(m => fs.existsSync(path.join(resolved, m)))) return true
    if (INIT_MARKERS.some(m => fs.existsSync(path.join(resolved, m)))) return true
    const home = os.homedir()
    if (path.parse(resolved).root !== path.parse(home).root) return true
    const relative = path.relative(home, resolved)
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      const segments = relative.split(path.sep).filter(Boolean)
      if (segments.length >= 2) return true
    }
    return false
  } catch {
    return false
  }
}

// ── Intent Classification ──────────────────────────────────────────────────

const STOPWORDS = new Set([
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "with",
  "by", "and", "or", "is", "it", "be", "this", "that",
])

const IMPLEMENT_WORDS = new Set([
  "implement", "build", "add", "fix", "change", "create", "refactor",
  "write", "edit", "update", "remove", "delete", "broken",
  "fails", "error", "feature", "support", "need", "want", "should",
])

const CLARIFY_PATTERNS = ["what is", "how does", "explain", "why", "describe", "tell me", "show me"]

export type IntentCategory = "implement" | "clarify" | "plan" | "unknown" | "review" | "test" | "debug"

export interface IntentResult {
  category: IntentCategory
  isWork: boolean
}

export function classifyIntent(message: string): IntentResult {
  const lower = message.toLowerCase().trim()
  if (!lower) return { category: "unknown", isWork: false }

  const QUESTION_PREFIXES = ["is ", "are ", "can ", "could ", "would ", "should ", "does ", "do ", "has ", "have "]
  const isLikelyQuestion = lower.includes("?") || CLARIFY_PATTERNS.some(p => lower.includes(p)) || QUESTION_PREFIXES.some(p => lower.startsWith(p))
  if (isLikelyQuestion) return { category: "clarify", isWork: false }

  const tokens = lower.split(/[^a-z0-9]+/).filter(t => t.length > 0)
  const hasImplToken = tokens.some(t => IMPLEMENT_WORDS.has(t))
  const hasPlanToken = tokens.some(t => t === "plan")
  const hasReviewPhrase = lower.includes("review") || lower.includes("check") || lower.includes("verify")
  const hasTestPhrase = lower.includes("test")
  const hasDebugPhrase = lower.includes("debug") || lower.includes("bug")

  if (hasPlanToken && hasImplToken) return { category: "plan", isWork: true }
  if (hasPlanToken) return { category: "plan", isWork: false }
  if (hasReviewPhrase && !hasImplToken) return { category: "review", isWork: false }
  if (hasTestPhrase && !hasImplToken) return { category: "test", isWork: true }
  if (hasDebugPhrase) return { category: "debug", isWork: true }
  if (hasImplToken) return { category: "implement", isWork: true }

  return { category: "unknown", isWork: false }
}

// ── Tool Access Block ──────────────────────────────────────────────────────

export function buildToolAccessBlock(): string {
  const yaml = `type: tool_access
main_context_only:
  allowed:
    - task
    - skill
    - read
    - question
    - todowrite
  description: "Spawn subagents, load skills, read state files, ask user. NO source mutations."
subagent_only:
  allowed:
    - edit
    - write
    - glob
    - grep
    - bash
  description: "All source work — editing, searching, building, testing. NEVER in main context."
shared:
  allowed:
    - webfetch
  description: "Read-only external fetch. OK in main context sparingly."`

  return `<structured type="tool_access">\n${yaml}\n</structured>`
}

// ── Drift Detection ────────────────────────────────────────────────────────

export interface DriftResult {
  inScope: string[]
  outOfScope: string[]
  allGood: boolean
}

export function checkPlanDrift(
  editedFiles: string[],
  planScope: string[],
): DriftResult {
  const planSet = new Set(planScope)
  const inScope: string[] = []
  const outOfScope: string[] = []
  for (const f of editedFiles) {
    if (planSet.has(f)) inScope.push(f)
    else outOfScope.push(f)
  }
  return { inScope, outOfScope, allGood: outOfScope.length === 0 }
}

// ── YAML Serialization ─────────────────────────────────────────────────────

function yamlStr(s: string): string {
  if (/[:{}[\]&*!|>'"%@`]/.test(s) || s.includes("\n") || s.includes("#")) {
    const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    return `"${escaped}"`
  }
  return s
}

function serializePlanYaml(plan: PlanData): string {
  const lines: string[] = []
  lines.push(`schema: ${plan.schema}`)
  lines.push(`id: ${plan.id}`)
  lines.push(`version: ${plan.version}`)
  lines.push(`createdAt: "${plan.createdAt}"`)
  lines.push(`updatedAt: "${plan.updatedAt}"`)
  lines.push(`status: ${plan.status}`)
  lines.push(`parent: ${plan.parent || "null"}`)
  lines.push(`goal: ${yamlStr(plan.goal)}`)
  lines.push(`check: ${yamlStr(plan.check)}`)
  lines.push(`summary: ${yamlStr(plan.summary)}`)
  lines.push("tasks:")
  for (const t of plan.tasks) {
    lines.push(`  - id: ${t.id}`)
    lines.push(`    summary: ${yamlStr(t.summary)}`)
    lines.push(`    status: ${t.status}`)
    lines.push("    files:")
    for (const f of t.files) lines.push(`      - ${yamlStr(f)}`)
    lines.push("    depends_on:")
    for (const d of t.depends_on) lines.push(`      - ${d}`)
    if (t.effort) lines.push(`    effort: ${t.effort}`)
    if (t.verification) lines.push(`    verification: ${yamlStr(t.verification)}`)
  }
  lines.push("plan_notes:")
  for (const n of plan.plan_notes) lines.push(`  - ${yamlStr(n)}`)
  if (plan.plannerMode) lines.push(`plannerMode: ${plan.plannerMode}`)
  if (plan.plannerSource) lines.push(`plannerSource: ${plan.plannerSource}`)
  return lines.join("\n") + "\n"
}

function parsePlanYaml(raw: string): PlanData | null {
  try {
    const plan: Partial<PlanData> & Record<string, unknown> = {
      schema: "",
      id: "",
      version: 1,
      createdAt: "",
      updatedAt: "",
      status: "draft",
      parent: null,
      goal: "",
      check: "",
      summary: "",
      tasks: [],
      plan_notes: [],
    }

    const lines = raw.split("\n")
    let i = 0
    function peek(): string { return lines[i] || "" }
    function consume(): string { return lines[i++] || "" }
    function unquote(s: string): string {
      s = s.trim()
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1)
      }
      return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    }

    // Parse top-level scalar fields
    while (i < lines.length) {
      const line = peek()
      if (!line.trim() || line.trim().startsWith("#")) { consume(); continue }

      if (line.trim() === "tasks:") { consume(); break }

      const m = line.match(/^(\w+):\s*(.*)$/)
      if (m) {
        const [, key, val] = m
        if (key === "parent") {
          plan.parent = val.trim() === "null" ? null : val.trim()
        } else if (key === "version") {
          plan.version = parseInt(val.trim(), 10) || 1
        } else if (key === "tasks") {
          break
        } else {
          plan[key] = unquote(val)
        }
      }
      consume()
    }

    // Parse tasks
    const tasks: PlanTask[] = []
    let currentTask: Partial<PlanTask> | null = null
    let inFiles = false
    let inDepends = false

    while (i < lines.length) {
      const line = consume()
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue

      if (trimmed.startsWith("- id:")) {
        if (currentTask && currentTask.id) tasks.push(currentTask as PlanTask)
        currentTask = { id: "", summary: "", status: "pending", files: [], depends_on: [] }
        currentTask.id = trimmed.replace("- id:", "").trim()
        inFiles = false
        inDepends = false
        continue
      }

      if (!currentTask) continue

      if (trimmed.startsWith("summary:")) {
        currentTask.summary = unquote(trimmed.slice("summary:".length))
        inFiles = false; inDepends = false; continue
      }
      if (trimmed.startsWith("status:")) {
        currentTask.status = trimmed.slice("status:".length).trim() as TaskStatus
        inFiles = false; inDepends = false; continue
      }
      if (trimmed === "files:") { inFiles = true; inDepends = false; continue }
      if (trimmed === "depends_on:") { inDepends = true; inFiles = false; continue }
      if (trimmed.startsWith("effort:")) {
        currentTask.effort = trimmed.slice("effort:".length).trim()
        inFiles = false; inDepends = false; continue
      }
      if (trimmed.startsWith("verification:")) {
        currentTask.verification = unquote(trimmed.slice("verification:".length))
        inFiles = false; inDepends = false; continue
      }

      if (inFiles && trimmed.startsWith("- ")) {
        currentTask.files = currentTask.files || []
        currentTask.files.push(unquote(trimmed.slice(2)))
      }
      if (inDepends && trimmed.startsWith("- ")) {
        currentTask.depends_on = currentTask.depends_on || []
        currentTask.depends_on.push(trimmed.slice(2).trim())
      }

      // Check for next top-level key (plan_notes, plannerMode, etc.)
      const tm = trimmed.match(/^(\w+):/)
      if (tm && !["summary", "status", "files", "depends_on", "effort", "verification", "id"].includes(tm[1])) {
        plan[tm[1]] = unquote(trimmed.slice(tm[1].length + 1))
      }
    }

    if (currentTask && currentTask.id) tasks.push(currentTask as PlanTask)
    plan.tasks = tasks

    // Parse plan_notes
    const notes: string[] = []
    for (const line of lines) {
      const m = line.match(/^\s*-\s+(.*)$/)
      if (m && line.trim() !== "- id:" && !line.trim().startsWith("- ") && !line.trim().startsWith("- id:")) {
        const prevLine = lines[Math.max(0, lines.indexOf(line) - 1)]
        if (prevLine.trim() === "plan_notes:" || lines.indexOf(line) > 0 && lines.filter((l, idx) => idx < lines.indexOf(line) && l.trim() === "plan_notes:").length > 0) {
          notes.push(unquote(m[1]))
        }
      }
    }
    // Simpler notes approach: find plan_notes section and grab - lines
    const notesSection = raw.split("\nplan_notes:\n")[1]
    if (notesSection) {
      for (const nl of notesSection.split("\n")) {
        const nm = nl.match(/^\s*-\s+(.*)$/)
        if (nm) notes.push(unquote(nm[1]))
      }
    }
    plan.plan_notes = notes

    return plan as PlanData
  } catch {
    return null
  }
}
