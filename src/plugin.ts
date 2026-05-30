import { type Plugin } from "@opencode-ai/plugin"
import * as path from "node:path"
import * as fs from "node:fs"
import { fileURLToPath } from "node:url"
import {
  classifyIntent, classifyTaskScope, getActivePlan, readPlanIndex, writePlanIndex,
  createPlan, createBuiltinPlan, isValidProjectDir, buildToolAccessBlock,
  updatePlanStatus, type PlanIndex, type PlanIndexEntry,
} from "./plan-gate"
import { getPackageInfo, getOpenEccVersion } from "./identity"
import { detectShell } from "./shell"
import { incrementAttempt, buildExecutionContextBlock } from "./execution"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const skillsDir = path.resolve(__dirname, "..", "skills")
const agentsDir = path.resolve(__dirname, "..", "prompts", "agents")
const commandsDir = path.resolve(__dirname, "..", "commands")
const agentsMDPath = path.resolve(__dirname, "..", "..", "AGENTS.md")

// ── Helpers ──────────────────────────────────────────────────────────────

function readFileSafe(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf8") } catch { return "" }
}

function stripYamlFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n/, "")
}

interface ProjectProfile {
  projectName: string
  languages: string[]
  packageManager: string
}

function detectProject(cwd: string): ProjectProfile {
  let projectName = path.basename(cwd)
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"))
    if (pkg.name) projectName = pkg.name
  } catch {}
  const languages: string[] = []
  if (fs.existsSync(path.join(cwd, "tsconfig.json"))) languages.push("typescript")
  if (fs.existsSync(path.join(cwd, "go.mod"))) languages.push("go")
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) languages.push("rust")
  if (fs.existsSync(path.join(cwd, "pyproject.toml"))) languages.push("python")
  if (fs.existsSync(path.join(cwd, "package.json"))) languages.push("javascript")
  const lockfiles: Record<string, string> = { "bun.lock": "bun", "bun.lockb": "bun", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "package-lock.json": "npm" }
  let packageManager = "npm"
  for (const [lock, name] of Object.entries(lockfiles)) { if (fs.existsSync(path.join(cwd, lock))) { packageManager = name; break } }
  return { projectName, languages, packageManager }
}

function buildProjectProfileSection(p: ProjectProfile): string {
  const lines: string[] = ["### Project Profile (auto-detected)"]
  if (p.languages.length > 0) lines.push(`- Languages: ${p.languages.join(", ")}`)
  lines.push(`- Package manager: ${p.packageManager}`, "")
  return lines.join("\n")
}

// ── Ultra-light Goal Tracker ──────────────────────────────────────────────

class GoalTracker {
  condition: string | null = null
  turnCount = 0
  start(condition: string): void { this.condition = condition; this.turnCount = 0 }
  clear(): void { this.condition = null; this.turnCount = 0 }
  isActive(): boolean { return this.condition !== null }
  getState(): { condition: string; turnCount: number } | null {
    return this.condition ? { condition: this.condition, turnCount: this.turnCount } : null
  }
  status(): string {
    if (!this.condition) return "No active goal."
    return `## Goal Status\n\nCondition: ${this.condition}\nTurns: ${this.turnCount}`
  }
}

// ── Injected Constants ────────────────────────────────────────────────────

const DELEGATOR_ROLE = `## Your Role (OpenECC Delegator)
Your primary job is to delegate, synthesize, and verify — not to do work directly.

### When to delegate to a subagent (@mention):
- Planning / architecture → @planner
- Code review / quality → @code-reviewer
- Security review → @security-reviewer
- Build/type errors → @build-error-resolver
- Test-first development → @tdd-guide
- Codebase/web search → @search-agent
- Plan reviews → @plan-ceo-reviewer, @plan-eng-reviewer, @plan-design-reviewer, @plan-devex-reviewer

### When to answer directly:
- Simple factual questions, quick clarifications, status checks
- Anything that requires zero tools

### Completion protocol:
1. **Verify before claiming** — run the command, read the output, then speak
2. **Synthesize** — distill subagent results into 3-5 sentences max
3. Place \`---\` followed by **Status:** ✅ Done | 🚧 Blocked | 🔄 In Progress`

const DELEGATION_ENFORCEMENT = `## OpenECC Delegation Enforcement (HARD RULES)
These are structural constraints, NOT suggestions. Violations are bugs.

### Tool Access Control — Main Context (TALK + DELEGATE only)
NEVER call these tools in main context:

| Tool | Correct Usage | Delegate To |
|------|--------------|-------------|
| \`edit\` | Changes source files | Language-specific subagent |
| \`write\` | Creates/modifies files | Language-specific subagent |
| \`bash\` | Runs commands | @executor or language-specific subagent |
| \`glob\` | Searches codebase | @search-agent |
| \`grep\` | Searches file contents | @search-agent |

### Self-Audit Before Every Tool Call
Before calling ANY tool, ask:
1. "Does this tool edit, write, or run commands?" → DELEGATE via \`task\` tool.
2. "Does this tool search source code?" → DELEGATE via \`task\` tool.
3. "Could a subagent do this in parallel while I handle something else?" → DELEGATE via \`task\` tool.
4. "Am I about to do work directly instead of delegating?" → STOP. Spawn a subagent.
If any answer is YES, use the \`task\` tool to spawn a subagent. No exceptions.`

const COMPLETION_CONTRACT = `### Before responding
1. Did you delegate analysis/planning work to a subagent when appropriate?
2. Did you verify results (not assume)?
3. Is the response concise and synthesized?
When done: place \`---\` followed by **Status:** ✅ Done | 🚧 Blocked | 🔄 In Progress`

// ── Agent Definitions ────────────────────────────────────────────────────

interface AgentEntry {
  name: string
  desc: string
  permission?: Record<string, string>
}

interface CommandEntry {
  name: string
  desc: string
  agent?: string
  subtask?: boolean
}

const AGENTS: AgentEntry[] = [
  { name: "planner", desc: "Expert planning specialist for complex features and refactoring.", permission: { edit: "deny", write: "deny", task: "deny" } },
  { name: "architect", desc: "Software architecture specialist for system design and technical decisions.", permission: { edit: "deny", write: "deny", task: "deny" } },
  { name: "code-reviewer", desc: "Expert code review specialist. Reviews code for quality, security, maintainability.", permission: { edit: "deny", write: "deny", task: "deny" } },
  { name: "security-reviewer", desc: "Security vulnerability detection and remediation.", permission: { task: "deny" } },
  { name: "tdd-guide", desc: "Test-Driven Development specialist. 80%+ test coverage.", permission: { task: "deny" } },
  { name: "build-error-resolver", desc: "Build and TypeScript error resolution. Minimal diffs.", permission: { task: "deny" } },
  { name: "search-agent", desc: "Low-cost search specialist. grep/glob/webfetch/websearch.", permission: { edit: "deny", write: "deny", bash: "deny", task: "deny" } },
  { name: "plan-ceo-reviewer", desc: "Business/product perspective plan review.", permission: { edit: "deny", write: "deny", task: "deny" } },
  { name: "plan-eng-reviewer", desc: "Engineering/architecture plan review.", permission: { edit: "deny", write: "deny", task: "deny" } },
  { name: "plan-design-reviewer", desc: "UX/design perspective plan review.", permission: { edit: "deny", write: "deny", task: "deny" } },
  { name: "plan-devex-reviewer", desc: "Developer experience plan review.", permission: { edit: "deny", write: "deny", task: "deny" } },
]

const COMMANDS: CommandEntry[] = [
  { name: "plan", desc: "Create a detailed implementation plan", agent: "planner", subtask: true },
  { name: "code-review", desc: "Review code for quality, security, maintainability", agent: "code-reviewer", subtask: true },
  { name: "security", desc: "Run comprehensive security review", agent: "security-reviewer", subtask: true },
  { name: "tdd", desc: "Enforce TDD with 80%+ coverage", agent: "tdd-guide", subtask: true },
  { name: "build-fix", desc: "Fix build/type errors", agent: "build-error-resolver", subtask: true },
  { name: "swarm", desc: "Full pipeline: think → plan → review → build → test → ship", agent: "planner", subtask: true },
]

// ── Plugin Entrypoint ────────────────────────────────────────────────────

export const OpenECCPlugin: Plugin = async ({ client, directory, worktree }) => {
  const worktreePath = worktree || directory
  let projectProfile: ProjectProfile | null = null
  const goalTracker = new GoalTracker()
  const editedFiles = new Set<string>()

  return {
    "tool.definition": async (input, output) => {
      if (input.toolID === "edit" || input.toolID === "write") {
        output.description = `[OPENECC ENFORCEMENT] This tool MUST be called inside a subagent, not in main context. Delegate via \`task\` tool. Rule: no direct work in main context. | ${output.description}`
      }
      if (input.toolID === "glob" || input.toolID === "grep") {
        output.description = `[OPENECC ENFORCEMENT] Source code search must be delegated to a subagent. | ${output.description}`
      }
      if (input.toolID === "bash") {
        output.description = `[OPENECC ENFORCEMENT] All commands must run inside a subagent. | ${output.description}`
      }
    },

    "command.execute.before": async (input: { command: string; arguments: string }, output: { parts: any[] }) => {
      if (input.command === "goal") {
        const args = input.arguments
        if (!args || args.trim() === "") {
          output.parts = [{ type: "text", text: "Usage: /goal <condition> | /goal status | /goal clear", id: "", sessionID: "", messageID: "" }]
          return
        }
        const parts = args.trim().split(/\s+/)
        const sub = parts[0]?.toLowerCase()
        if (sub === "status") {
          output.parts = [{ type: "text", text: goalTracker.status(), id: "", sessionID: "", messageID: "" }]
        } else if (sub === "clear") {
          goalTracker.clear()
          output.parts = [{ type: "text", text: "Goal cleared.", id: "", sessionID: "", messageID: "" }]
        } else {
          goalTracker.start(args.trim())
          output.parts = [{ type: "text", text: `Goal started: "${args.trim()}".`, id: "", sessionID: "", messageID: "" }]
        }
        return
      }

      if (input.command === "plan") {
        const planArgs = input.arguments?.trim() || ""
        const planParts = planArgs.split(/\s+/)
        const sub = planParts[0]?.toLowerCase()
        if (!sub) {
          output.parts = [{ type: "text", text: "Usage: /plan list | /plan status | /plan create <summary> | /plan transition <id> <status>", id: "", sessionID: "", messageID: "" }]
          return
        }
        if (sub === "list") {
          const idx = readPlanIndex(worktreePath)
          if (!idx || idx.plans.length === 0) {
            output.parts = [{ type: "text", text: "No plans found.", id: "", sessionID: "", messageID: "" }]
            return
          }
          const lines = ["## Plans"]
          for (const p of idx.plans) lines.push(`- ${p.id}: ${p.summary} (${p.status}, ${p.completed}/${p.total})`)
          output.parts = [{ type: "text", text: lines.join("\n"), id: "", sessionID: "", messageID: "" }]
          return
        }
        if (sub === "status") {
          const active = getActivePlan(worktreePath)
          output.parts = [{ type: "text", text: active ? `Active plan ${active.id}: ${active.summary} (${active.status}, ${active.completed}/${active.total})` : "No active plan.", id: "", sessionID: "", messageID: "" }]
          return
        }
        if (sub === "create") {
          const summary = planParts.slice(1).join(" ")
          if (!summary) {
            output.parts = [{ type: "text", text: "Usage: /plan create <summary>", id: "", sessionID: "", messageID: "" }]
            return
          }
          const result = createPlan(worktreePath, { summary, status: "approved" })
          if (result) {
            output.parts = [{ type: "text", text: `Plan ${result.id} created and activated: "${summary}"`, id: "", sessionID: "", messageID: "" }]
          } else {
            output.parts = [{ type: "text", text: "Failed to create plan.", id: "", sessionID: "", messageID: "" }]
          }
          return
        }
        if (sub === "transition") {
          const pid = planParts[1] || ""
          const newStatus = planParts[2]
          if (!pid || !newStatus) {
            output.parts = [{ type: "text", text: "Usage: /plan transition <id> <status>", id: "", sessionID: "", messageID: "" }]
            return
          }
          const VALID_STATUSES: readonly string[] = ["draft", "reviewed", "ready", "approved", "in_progress", "done", "blocked", "abandoned"]
          if (!VALID_STATUSES.includes(newStatus)) {
            output.parts = [{ type: "text", text: `Invalid status: "${newStatus}". Valid: ${VALID_STATUSES.join(", ")}`, id: "", sessionID: "", messageID: "" }]
            return
          }
          const err = updatePlanStatus(worktreePath, pid, newStatus)
          output.parts = [{ type: "text", text: err ? `Error: ${err}` : `Plan ${pid} transitioned to ${newStatus}.`, id: "", sessionID: "", messageID: "" }]
          return
        }
        output.parts = [{ type: "text", text: `Unknown: ${sub}. Try: list, status, create, transition`, id: "", sessionID: "", messageID: "" }]
      }
    },

    config: async (config: any) => {
      config.skills = config.skills || {}
      config.skills.paths = config.skills.paths || []
      if (!config.skills.paths.includes(skillsDir)) config.skills.paths.push(skillsDir)

      config.instructions = config.instructions || []
      if (!config.instructions.some((i: string) => i === agentsMDPath)) config.instructions.push(agentsMDPath)

      config.agent = config.agent || {}
      for (const agent of AGENTS) {
        if (!config.agent[agent.name]) {
          const prompt = readFileSafe(path.join(agentsDir, `${agent.name}.txt`))
          if (prompt) {
            const agentConfig: Record<string, unknown> = { description: agent.desc, mode: "subagent", prompt }
            if (agent.permission) agentConfig.permission = agent.permission
            config.agent[agent.name] = agentConfig
          }
        }
      }

      config.command = config.command || {}
      for (const cmd of COMMANDS) {
        if (!config.command[cmd.name]) {
          const templateContent = readFileSafe(path.join(commandsDir, `${cmd.name}.md`))
          const cleanTemplate = stripYamlFrontmatter(templateContent)
          if (cleanTemplate) {
            config.command[cmd.name] = { description: cmd.desc, template: `${cleanTemplate}\n\n$ARGUMENTS`, ...(cmd.agent ? { agent: cmd.agent } : {}), ...(cmd.subtask ? { subtask: true } : {}) }
          }
        }
      }
    },

    "experimental.chat.system.transform": async (_input, output: any) => {
      if (!projectProfile) projectProfile = detectProject(worktreePath)

      const pkg = getPackageInfo()
      const shell = detectShell()

      const soulPath = path.join(skillsDir, "soul", "SKILL.md")
      const soulContent = readFileSafe(soulPath)
      const cleanSoul = stripYamlFrontmatter(soulContent)

      const identityBlock = `<EXTREMELY_IMPORTANT>
I am OpenECC, your engineering workflow layer.

I know my version (\`${pkg.version}\`), my install path (\`${pkg.root}\`), and my job: route work to specialists, gate plans until approved, track goals, and never claim done without verification. I report to you directly with synthesized results. Everything else is delegated.

You have a soul — the principles below are always active. They are ALREADY LOADED.

${cleanSoul}
</EXTREMELY_IMPORTANT>`

      const runtimeBlock = `<structured type="runtime">
type: runtime
openecc_version: ${pkg.version}
package_root: ${pkg.root}
skills_directory: ${pkg.skillsDir}
cache_root: ${pkg.cacheRoot}
</structured>`

      const shellBlock = `<structured type="shell">
type: shell
detected: ${shell.shellType}
preferred_syntax: ${shell.preferredSyntax}
anti_patterns: [${shell.antiPatterns.join(", ")}]
guidance: ${shell.guidance}
</structured>`

      const systemMessages = output.systemMessages || []
      if (!systemMessages.some((p: any) => p.text?.includes("EXTREMELY_IMPORTANT"))) {
        const fullBootstrap = [
          identityBlock,
          runtimeBlock,
          shellBlock,
          buildExecutionContextBlock(),
          DELEGATOR_ROLE,
          DELEGATION_ENFORCEMENT,
          buildToolAccessBlock(),
          COMPLETION_CONTRACT,
          buildProjectProfileSection(projectProfile),
        ].join("\n\n")

        systemMessages.unshift({ type: "text", text: fullBootstrap })
        output.systemMessages = systemMessages
      }

      // Inject plan state
      try {
        const activeEntry = getActivePlan(worktreePath)
        if (activeEntry) {
          const planBlock = `<structured type="plan_state">
active_plan: ${activeEntry.id}
status: ${activeEntry.status}
completed: ${activeEntry.completed}
total: ${activeEntry.total}
goal: ${activeEntry.summary}
</structured>`
          if (!systemMessages.some((p: any) => p.text?.includes("plan_state"))) {
            systemMessages.push({ type: "text", text: planBlock })
          }
        }
      } catch {}

      // Inject goal state
      if (goalTracker.isActive()) {
        const gs = goalTracker.getState()!
        const goalBlock = `<goal_objective>
condition: ${gs.condition}
turns: ${gs.turnCount}
</goal_objective>`
        if (!systemMessages.some((p: any) => p.text?.includes("goal_objective"))) {
          systemMessages.push({ type: "text", text: goalBlock })
        }
      }
    },

    "experimental.chat.messages.transform": async (_input, output: any) => {
      if (!output.messages?.length) return
      const firstUser = output.messages.find((m: any) => m.info?.role === "user")
      if (!firstUser || !firstUser.parts?.length) return
      if (firstUser.parts.some((p: any) => p.type === "text" && typeof p.text === "string" && (p as any).text.includes("EXTREMELY_IMPORTANT"))) return

      const parts = firstUser.parts as Array<{ type: string; text?: string }>
      const userText = parts.filter(p => p.type === "text" && typeof p.text === "string").map(p => p.text as string).join(" ")
      if (!userText || userText.length >= 2000) return

      // ── Execution tracking ────────────────────────────────────
      incrementAttempt()

      // ── Plan Gate (3-tier routing) ─────────────────────────────
      try {
        const intent = classifyIntent(userText)
        if (intent.isWork && isValidProjectDir(worktreePath)) {
          const scope = classifyTaskScope(userText)
          if (scope === "trivial") {
            // No plan needed for trivial tasks
          } else {
            const existingPlan = getActivePlan(worktreePath)
            if (!existingPlan || existingPlan.status === "done" || existingPlan.status === "abandoned" || existingPlan.status === "blocked") {
              const result = scope === "complex"
                ? createPlan(worktreePath, { summary: userText, status: "draft" })
                : createBuiltinPlan(worktreePath, userText, "auto")
              if (result) {
                const firstText = parts.find(p => p.type === "text")
                if (firstText && typeof firstText.text === "string") {
                  const planStatus = result.plan.status
                  firstText.text = planStatus === "draft"
                    ? `[plan:${result.id}] Auto-created DRAFT plan for: "${result.summary}". Tasks: ${result.plan.tasks.length}. Approve via /plan transition ${result.id} approved.\n\n${firstText.text}`
                    : `[plan:${result.id}] Auto-created plan for: "${result.summary}". Tasks: ${result.plan.tasks.length}. Proceeding.\n\n${firstText.text}`
                }
              }
            }
          }
        }
      } catch {}

      // ── Goal tracking ─────────────────────────────────────────
      if (goalTracker.isActive()) {
        for (const msg of output.messages ?? []) {
          if (msg.info?.role === "assistant") {
            const text = (msg.parts || []).map((p: any) => p.text || "").join(" ")
            if (text.includes("[goal:complete]")) { goalTracker.clear(); continue }
            if (text.includes("[goal:blocked]")) { goalTracker.clear(); continue }
          }
        }
        goalTracker.turnCount++
      }
    },

    "experimental.session.compacting": async (_input, output: any) => {
      const pkg = getPackageInfo()
      output.context.push("# OpenECC Context (preserve across compaction)")
      output.context.push("", `## OpenECC v${pkg.version}`)
      output.context.push(`- Package root: ${pkg.root}`)
      output.context.push("- Primary role: delegate to subagents, synthesize results, verify before claiming")
      output.context.push("- Soul: Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution")
      output.context.push("- Route by task type: planning, review, build-fix, TDD, docs, language-specific")
      output.context.push("- Answer directly when no tools are needed", "")
      if (projectProfile) {
        output.context.push("## Project Profile")
        output.context.push(`- Languages: ${projectProfile.languages.join(", ") || "none detected"}`)
        output.context.push(`- Package manager: ${projectProfile.packageManager}`, "")
      }
      if (goalTracker.isActive()) {
        const s = goalTracker.getState()!
        output.context.push("## Active Goal")
        output.context.push(`- Condition: ${s.condition}`, `- Turns: ${s.turnCount}`, "")
      }
      if (editedFiles.size > 0) {
        output.context.push("## Recently Edited Files")
        for (const f of editedFiles) output.context.push(`- ${f}`)
        output.context.push("")
      }
    },

    "file.edited": async (event: { path: string }) => {
      editedFiles.add(event.path)
    },

    "tool.execute.after": async (input: { tool: string; args?: Record<string, unknown> }, _output: unknown) => {
      const filePath = input.args?.filePath as string | undefined
      if ((input.tool === "edit" || input.tool === "write") && filePath) editedFiles.add(filePath)
    },

    "session.created": async () => {
      const pkg = getPackageInfo()
      await client.app.log({ body: { service: "openecc", level: "info" as const, message: `Session started — OpenECC v${pkg.version} active` } })
    },

    "session.deleted": async () => {
      editedFiles.clear()
    },
  }
}

export default OpenECCPlugin
