import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export type PlanStatus =
  | "draft"
  | "approved"
  | "in_progress"
  | "done"
  | "blocked"
  | "abandoned"

export const VALID_TRANSITIONS: Record<string, PlanStatus[]> = {
  draft: ["approved", "abandoned"],
  approved: ["in_progress", "abandoned"],
  in_progress: ["done", "blocked", "abandoned"],
  blocked: ["draft", "abandoned"],
  done: [],
  abandoned: [],
}

export function validatePlanTransition(current: string, next: string): boolean {
  const allowed = VALID_TRANSITIONS[current]
  if (!allowed) return false
  return allowed.includes(next as PlanStatus)
}

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
}

export interface ActivePlanResult {
  id: string
  summary: string
  plan: PlanData
}

export type TaskScope = "trivial" | "lightweight" | "complex"

export interface DriftResult {
  inScope: string[]
  outOfScope: string[]
  allGood: boolean
}

export type IntentCategory = "implement" | "clarify" | "plan" | "unknown" | "review" | "test" | "debug"

export interface IntentResult {
  category: IntentCategory
  isWork: boolean
}

export const COMPLEX_PATTERNS = [
  "refactor", "migrate", "rewrite", "architecture", "restructure",
  "redesign", "overhaul", "reorganize", "rearchitect",
]

export const TRIVIAL_PATTERNS = [
  "typo", "semicolon", "rename", "format", "comment", "spelling",
]

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

export function classifyTaskScope(text: string): TaskScope {
  if (isComplexTask(text)) return "complex"
  if (isTrivialTask(text)) return "trivial"
  return "lightweight"
}

function isComplexTask(text: string): boolean {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return tokens.some(t => COMPLEX_PATTERNS.includes(t))
}

function isTrivialTask(text: string): boolean {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (text.length < 20) return true
  return tokens.some(t => TRIVIAL_PATTERNS.includes(t))
}

const IMPLEMENT_WORDS = new Set([
  "implement", "build", "add", "fix", "change", "create", "refactor",
  "write", "edit", "update", "remove", "delete", "broken",
  "fails", "error", "feature", "support", "need", "want", "should",
])

const CLARIFY_PATTERNS = ["what is", "how does", "explain", "why", "describe", "tell me", "show me"]

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

export function buildToolAccessBlock(): string {
  const yaml = `type: tool_access
main_context_only:
  allowed:
    - task
    - skill
    - read
    - question
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

export function buildPlanGateBlock(activePlan: PlanIndexEntry): string {
  const gate = activePlan.status === "draft"
    ? `BLOCKED — plan ${activePlan.id} is in DRAFT status.
The plan must be approved before any implementation work.
Ask the user to approve via: /plan transition ${activePlan.id} approved`
    : `OPEN — plan ${activePlan.id} is ${activePlan.status}. Proceed within scope.`

  return `<structured type="plan_gate">\nplan: ${activePlan.id}\nstatus: ${activePlan.status}\ncompleted: ${activePlan.completed}/${activePlan.total}\ngate: ${gate}\n</structured>`
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

export function isValidProjectDir(dir: string): boolean {
  try {
    const stat = fs.statSync(dir)
    if (!stat.isDirectory()) return false
    const resolved = path.resolve(dir)
    const PROJECT_MARKERS = [".git", "package.json", "go.mod", "Cargo.toml", "pyproject.toml", "composer.json", "Gemfile", "project.json", "pubspec.yaml", "mix.exs"]
    const INIT_MARKERS = [".opencode"]
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
