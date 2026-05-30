import * as fs from "node:fs"
import * as path from "node:path"

const MAX_TURNS = 50 // ~50 exchanges before diminishing returns
const MAX_TOKENS = 200_000 // ~$0.30 at current API pricing (chars ~= tokens for English)
const MAX_DURATION_MS = 1_800_000 // 30min — aligns with typical session timeout
const WARN_TURNS = 40 // 80% of MAX_TURNS
const WARN_TOKENS = 160_000 // 80% of MAX_TOKENS
const WARN_DURATION_MS = 1_440_000 // 80% of MAX_DURATION_MS (24min)
const NO_PROGRESS_LIMIT = 3 // consecutive low-output turns before declaring stall
const NO_PROGRESS_THRESHOLD = 5_000 // output chars below this threshold = no progress
const IDLE_DELAY_MS = 90_000 // 90s before first idle auto-continue fires

export interface GoalState {
  condition: string
  turnCount: number
  totalChars: number
  startedAt: number
  lastActiveAt: number
  stopped: false | "budget" | "no_progress" | "user" | "complete" | "blocked"
  stopReason?: string
  noProgressTurns: number
  budgetWarned: boolean
  checkpoints: Array<{ turn: number; at: number; note: string }>
  history: Array<{ action: string; at: number }>
}

/** Format milliseconds as "XmYs" duration string */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}m${sec}s`
}

/**
 * Format goal state into a human-readable status report.
 * @param state - The current goal state
 * @returns Multi-line status string with condition, turns, tokens, duration, and checkpoints
 */
export function formatGoalStatus(state: GoalState): string {
  const elapsed = Date.now() - state.startedAt
  const lines: string[] = ["## Goal Status", ""]
  lines.push(`Condition: ${state.condition}`)
  lines.push(`Turns: ${state.turnCount} / ${MAX_TURNS}`)
  lines.push(`Tokens (approx): ${state.totalChars / 4} / ${MAX_TOKENS}`)
  lines.push(`Duration: ${formatDuration(elapsed)} / ${formatDuration(MAX_DURATION_MS)}`)
  if (state.stopped) {
    lines.push(`Status: STOPPED (${state.stopped})`)
    if (state.stopReason) lines.push(`Reason: ${state.stopReason}`)
  } else {
    lines.push("Status: active")
  }
  if (state.noProgressTurns > 0) {
    lines.push(`No-progress stalls: ${state.noProgressTurns}`)
  }
  lines.push("")
  if (state.checkpoints.length > 0) {
    lines.push("### Checkpoints")
    for (const cp of state.checkpoints) {
      lines.push(`- Turn ${cp.turn}: ${cp.note}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

export class GoalManager {
  private state: GoalState | null = null
  private dir: string
  private statePath: string

  constructor(dir: string) {
    this.dir = dir
    this.statePath = path.join(dir, "goal-state.json")
    this.load()
  }

  /**
   * Start a new goal with the given condition string.
   * Resets all tracking state and persists immediately.
   * @param condition - Natural language description of the goal
   */
  start(condition: string): void {
    this.state = {
      condition,
      turnCount: 0,
      totalChars: 0,
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      stopped: false,
      noProgressTurns: 0,
      budgetWarned: false,
      checkpoints: [],
      history: [{ action: `start: ${condition}`, at: Date.now() }],
    }
    this.persist()
  }

  status(): { active: boolean; state: GoalState | null; display: string } {
    if (!this.state) return { active: false, state: null, display: "No active goal." }
    return { active: !this.state.stopped, state: this.state, display: formatGoalStatus(this.state) }
  }

  clear(): void {
    this.state = null
    this.deleteFile()
  }

  /**
   * Resume a stopped goal. Clears the stopped flag and no-progress counter.
   */
  resume(): void {
    if (!this.state) return
    this.state.stopped = false
    this.state.stopReason = undefined
    this.state.noProgressTurns = 0
    this.state.history.push({ action: "resume", at: Date.now() })
    this.checkpoint("resumed by user")
    this.persist()
  }

  checkpoint(note: string): void {
    if (!this.state) return
    this.state.checkpoints.push({ turn: this.state.turnCount, at: Date.now(), note })
  }

  hist(): GoalState["history"] {
    return this.state?.history ?? []
  }

  /**
   * Check if goal has exceeded any budget limits (turns, tokens, duration).
   * Also emits a one-time 80% warning when approaching limits.
   * @param turnCount - Number of turns elapsed
   * @param totalChars - Total characters tracked
   * @param elapsedMs - Milliseconds since goal started
   * @returns { stop: true, reason } if budget exceeded, { stop: false, reason } for warning, or null if OK
   */
  checkBudget(turnCount: number, totalChars: number, elapsedMs: number): { stop: boolean; reason: string } | null {
    if (!this.state) return null

    if (!this.state.stopped) {
      if (turnCount >= MAX_TURNS) {
        this.state.stopped = "budget"
        this.state.stopReason = `Turn limit reached (${MAX_TURNS})`
        this.checkpoint("budget: turn limit")
        this.persist()
        return { stop: true, reason: this.state.stopReason }
      }
      if (totalChars / 4 >= MAX_TOKENS) {
        this.state.stopped = "budget"
        this.state.stopReason = `Token budget exhausted (${MAX_TOKENS})`
        this.checkpoint("budget: token limit")
        this.persist()
        return { stop: true, reason: this.state.stopReason }
      }
      if (elapsedMs >= MAX_DURATION_MS) {
        this.state.stopped = "budget"
        this.state.stopReason = `Duration limit reached (${formatDuration(MAX_DURATION_MS)})`
        this.checkpoint("budget: duration limit")
        this.persist()
        return { stop: true, reason: this.state.stopReason }
      }
    }

    if (!this.state.budgetWarned) {
      if (
        turnCount >= WARN_TURNS ||
        totalChars / 4 >= WARN_TOKENS ||
        elapsedMs >= WARN_DURATION_MS
      ) {
        this.state.budgetWarned = true
        this.checkpoint("budget: 80% warning zone")
        this.persist()
        return { stop: false, reason: "Budget at 80% — nearing limits" }
      }
    }

    return null
  }

  /**
   * Detect stalled progress by comparing output character deltas.
   * Increments no-progress counter on each low-output turn; stops goal at limit.
   * @param prevChars - Previous output character count
   * @param currChars - Current output character count
   * @returns true if goal was stopped due to no progress
   */
  checkNoProgress(prevChars: number, currChars: number): boolean {
    if (!this.state || this.state.stopped) return false
    const diff = Math.abs(currChars - prevChars)
    if (diff < NO_PROGRESS_THRESHOLD) {
      this.state.noProgressTurns++
      if (this.state.noProgressTurns >= NO_PROGRESS_LIMIT) {
        this.state.stopped = "no_progress"
        this.state.stopReason = `No progress detected for ${NO_PROGRESS_LIMIT} consecutive turns`
        this.checkpoint("no-progress: stalled")
        this.persist()
        return true
      }
    } else {
      this.state.noProgressTurns = 0
    }
    this.persist()
    return false
  }

  /**
   * Scan text for [goal:complete] or [goal:blocked] markers from LLM output.
   * Updates state and persists if a marker is found.
   * @param text - Assistant output text to scan
   * @returns "complete", "blocked", or null if no marker found
   */
  parseMarkers(text: string): "complete" | "blocked" | null {
    if (!text) return null
    if (text.includes("[goal:complete]")) {
      if (this.state && !this.state.stopped) {
        this.state.stopped = "complete"
        this.state.stopReason = "Goal marked complete by LLM"
        this.checkpoint("goal: complete")
        this.persist()
      }
      return "complete"
    }
    if (text.includes("[goal:blocked]")) {
      if (this.state && !this.state.stopped) {
        this.state.stopped = "blocked"
        this.state.stopReason = "Goal marked blocked by LLM"
        this.checkpoint("goal: blocked")
        this.persist()
      }
      return "blocked"
    }
    return null
  }

  trackChars(chars: number): void {
    if (!this.state || this.state.stopped) return
    this.state.totalChars += chars
    this.state.lastActiveAt = Date.now()
    this.state.turnCount++
    this.persist()
  }

  isActive(): boolean {
    return this.state !== null && !this.state.stopped
  }

  getState(): GoalState | null {
    return this.state
  }

  /** Whether enough time has passed since last activity to auto-continue */
  shouldAutoContinue(): boolean {
    if (!this.isActive()) return false
    return (Date.now() - this.state!.lastActiveAt) >= IDLE_DELAY_MS
  }

  /**
   * Persist goal state to disk at .openecc/goal-state.json.
   * Silently handles write errors (non-fatal).
   */
  persist(): void {
    if (!this.state) return
    try {
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true })
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2))
    } catch {
      // persist silently
    }
  }

  /**
   * Load goal state from disk if it exists.
   * Resets state to null on parse failure (corrupted file).
   */
  load(): void {
    try {
      if (fs.existsSync(this.statePath)) {
        const raw = fs.readFileSync(this.statePath, "utf8")
        this.state = JSON.parse(raw) as GoalState
      }
    } catch {
      this.state = null
    }
  }

  private deleteFile(): void {
    try {
      if (fs.existsSync(this.statePath)) fs.unlinkSync(this.statePath)
    } catch {
      // delete silently
    }
  }
}
