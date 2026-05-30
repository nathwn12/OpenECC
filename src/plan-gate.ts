import * as fs from "node:fs"
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

// ── Write Queue (in-memory promise chain) ───────────────────────────────────

let _indexWriteQueue: Promise<void> = Promise.resolve()

// ── Index I/O ──────────────────────────────────────────────────────────────

export interface PlanIndexEntry {
  id: number
  summary: string
  status: string
  done: number
  total: number
}

export interface PlanIndex {
  nextId: number
  activePlanId: number | null
  plans: PlanIndexEntry[]
}

function indexJsonPath(worktreePath: string): string {
  return path.join(worktreePath, ".openecc", "index.json")
}

export function readPlanIndex(worktreePath: string): PlanIndex | null {
  try {
    const f = indexJsonPath(worktreePath)
    if (!fs.existsSync(f)) return null
    return JSON.parse(fs.readFileSync(f, "utf8")) as PlanIndex
  } catch {
    return null
  }
}

export function writePlanIndex(worktreePath: string, index: PlanIndex): void {
  // Synchronous write for immediate consistency (test compatibility)
  const f = indexJsonPath(worktreePath)
  const dir = path.dirname(f)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = f + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2), "utf8")
  fs.renameSync(tmp, f)

  // Chain onto promise queue to serialize against concurrent async callers
  _indexWriteQueue = _indexWriteQueue.then(() => {}).catch(() => {
    // never reject the chain — swallow errors internally
  })
}

export function getActivePlan(worktreePath: string): PlanIndexEntry | null {
  const idx = readPlanIndex(worktreePath)
  if (!idx || idx.activePlanId === null) return null
  return idx.plans.find(p => p.id === idx.activePlanId) ?? null
}

export function getPlanScope(worktreePath: string): string[] {
  try {
    const idx = readPlanIndex(worktreePath)
    const activeId = idx?.activePlanId
    if (!activeId) return []
    const planFile = `plan-${String(activeId).padStart(3, "0")}.yaml`
    const yamlPath = path.join(worktreePath, ".openecc", planFile)
    if (!fs.existsSync(yamlPath)) return []
    const content = fs.readFileSync(yamlPath, "utf8")
    // Parse YAML manually (no dep) — extract file: lines
    const files: string[] = []
    let inFilesSection = false
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.startsWith("files:")) {
        inFilesSection = true
        continue
      }
      if (inFilesSection) {
        if (trimmed.startsWith("- ")) {
          files.push(trimmed.slice(2).trim())
        } else if (trimmed.startsWith("#") || trimmed === "") {
          continue
        } else if (!trimmed.startsWith("-")) {
          // Check if next section started by looking for non-list non-comment
          if (trimmed.includes(":")) {
            inFilesSection = false
          }
        }
      }
    }
    return files
  } catch {
    return []
  }
}

// ── Plan Gate ──────────────────────────────────────────────────────────────

export function getPlanGate(worktreePath: string): string | null {
  const idx = readPlanIndex(worktreePath)
  if (!idx) return null

  if (idx.activePlanId === null) {
    return "**ACTION REQUIRED:** No active plan. For complex work, create a plan via `.openecc/plan-NNN.yaml` and register it in `index.json`. Only proceed without a plan for trivial Q&A or single-file edits."
  }

  const active = idx.plans.find(p => p.id === idx.activePlanId)
  if (!active) {
    return "**ACTION REQUIRED:** Active plan ID points to nonexistent plan. Reset `activePlanId` in `index.json` or create the plan."
  }

  if (active.status === "blocked") {
    return `**BLOCKED:** Plan "${active.summary}" (ID ${active.id}) is blocked. Resolve the blocker or create a new plan iteration.`
  }

  if (active.status === "done" || active.status === "abandoned") {
    return `**INACTIVE:** Plan "${active.summary}" is ${active.status}. Clear \`activePlanId\` or create a new plan.`
  }

  if (active.status !== "approved" && active.status !== "in_progress") {
    return `**NOT READY:** Plan "${active.summary}" is ${active.status}. Transition to \`approved\` before implementation. Allowed path: draft → reviewed → approved → in_progress.`
  }

  return null // gate open
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
  isWork: boolean // true if this could modify files
}

export function classifyIntent(message: string): IntentResult {
  const lower = message.toLowerCase().trim()
  if (!lower) return { category: "unknown", isWork: false }

  const QUESTION_PREFIXES = ["is ", "are ", "can ", "could ", "would ", "should ", "does ", "do ", "has ", "have "]
  const isLikelyQuestion = lower.includes("?") || CLARIFY_PATTERNS.some(p => lower.includes(p)) || QUESTION_PREFIXES.some(p => lower.startsWith(p))
  if (isLikelyQuestion) {
    return { category: "clarify", isWork: false }
  }

  const tokens = lower.split(/[^a-z0-9]+/).filter(t => t.length > 0)
  const hasImplToken = tokens.some(t => IMPLEMENT_WORDS.has(t))
  const hasPlanToken = tokens.some(t => t === "plan")
  const hasReviewPhrase = lower.includes("review") || lower.includes("check") || lower.includes("verify")
  const hasTestPhrase = lower.includes("test")
  const hasDebugPhrase = lower.includes("debug") || lower.includes("bug")

  if (hasPlanToken && hasImplToken) {
    return { category: "plan", isWork: false }
  }
  if (hasReviewPhrase && !hasImplToken) {
    return { category: "review", isWork: false }
  }
  if (hasTestPhrase && !hasImplToken) {
    return { category: "test", isWork: true }
  }
  if (hasDebugPhrase) {
    return { category: "debug", isWork: true }
  }
  if (hasImplToken) {
    return { category: "implement", isWork: true }
  }

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
    if (planSet.has(f)) {
      inScope.push(f)
    } else {
      outOfScope.push(f)
    }
  }
  return { inScope, outOfScope, allGood: outOfScope.length === 0 }
}

// ── Update Plan Status ─────────────────────────────────────────────────────

export function updatePlanStatus(
  worktreePath: string,
  id: number,
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

  entry.status = newStatus
  if (updates?.done !== undefined) entry.done = updates.done
  if (updates?.total !== undefined) entry.total = updates.total

  if (newStatus === "done" || newStatus === "abandoned") {
    if (idx.activePlanId === id) idx.activePlanId = null
  }

  if (newStatus === "approved" || newStatus === "in_progress") {
    idx.activePlanId = id
  }

  writePlanIndex(worktreePath, idx)
  return null // success
}
