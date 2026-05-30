import { tool, type Plugin } from "@opencode-ai/plugin"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as fs from "node:fs"
import * as os from "node:os"
import { exec as execCb } from "node:child_process"
import { promisify } from "node:util"
const exec = promisify(execCb) as (cmd: string, opts?: { cwd?: string; timeout?: number }) => Promise<{ stdout: string; stderr: string }>
import { detectProject, detectPackageManager, detectFormatter, detectLinter, type ProjectProfile } from "./routing/detect"
import { buildAgentRegistry, buildSkillRegistry } from "./routing/registry"
import { autoDelegate as autoDelegateFn, analyzeTask as analyzeTaskFn } from "./routing/classifier"
import { DELEGATION_ENFORCEMENT, TOOL_ACCESS_BLOCK, DELEGATOR_ROLE, QUICK_ROUTING, COMPLETION_CONTRACT } from "./constants"
import { GoalManager } from "./goal"
import { buildToolAccessBlock, classifyIntent, getPlanGate, getActivePlan, updatePlanStatus, readPlanIndex, writePlanIndex } from "./plan-gate"

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
  return?: Array<{ prompt?: string; command?: string }>
}

export interface TransformOutput {
  systemMessages?: Array<{ type: string; text: string }>
}

import { buildProjectProfileSection, readFileSafe, resolveProjectFile, stripYamlFrontmatter } from "./utils"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const skillsDir = path.resolve(__dirname, "..", "skills")
const agentsDir = path.resolve(__dirname, "..", "prompts", "agents")
const commandsDir = path.resolve(__dirname, "..", "commands")
const agentsMDPath = path.resolve(__dirname, "..", "..", "AGENTS.md")

let _delegationDepth = 0
const _capturedResults = new Map<string, unknown>()
const _editedFiles = new Set<string>()
const _namedResults = new Map<string, string>()
const _pendingReturns = new Map<string, Array<{ prompt?: string; command?: string }>>()
let _autoContinuePending = false
const IDLE_CONTINUE_GUARD_MS = 180_000 // 2 * IDLE_DELAY_MS (90s from goal.ts)

interface MessagePart {
  type: string
  text?: string
  id: string
  sessionID: string
  messageID: string
}

interface ChatMessage {
  info?: { role: string }
  parts: MessagePart[]
}

interface SessionPromptClient {
  session?: {
    prompt: (opts: { sessionID: string; parts: { type: string; text: string }[] }) => void | Promise<void>
  }
}

interface OverrideResult {
  agent?: string
  model?: string
  loop?: number
  as?: string
  cleanText: string
}

function parseOverrides(text: string): OverrideResult {
  const result: OverrideResult = { cleanText: text }
  const prefix = text.slice(0, 200) // only parse overrides from command prefix area
  
  const agentMatch = prefix.match(/\{agent:(\w+)\}/)
  if (agentMatch) {
    result.agent = agentMatch[1]
    result.cleanText = result.cleanText.replace(agentMatch[0], "").trim()
  }
  
  const modelMatch = prefix.match(/\{model:([\w\/\-\.]+)\}/)
  if (modelMatch) {
    result.model = modelMatch[1]
    result.cleanText = result.cleanText.replace(modelMatch[0], "").trim()
  }
  
  const loopMatch = prefix.match(/\{loop:(\d+)\}/)
  if (loopMatch) {
    result.loop = parseInt(loopMatch[1], 10)
    result.cleanText = result.cleanText.replace(loopMatch[0], "").trim()
  }
  
  const asMatch = prefix.match(/\{as:(\w+)\}/)
  if (asMatch) {
    result.as = asMatch[1]
    result.cleanText = result.cleanText.replace(asMatch[0], "").trim()
  }
  
  return result
}

const testCommandTool = tool({
  description:
    "[ADVISORY] Returns the test command string to run the test suite with optional coverage, watch mode, or specific test patterns. Automatically detects package manager (npm, pnpm, yarn, bun) and test framework. Does NOT execute the command — use the returned command with bash.",
  args: {
    pattern: tool.schema.string().optional().describe("Test file pattern or specific test name to run"),
    coverage: tool.schema.boolean().optional().describe("Run with coverage reporting"),
    watch: tool.schema.boolean().optional().describe("Run in watch mode"),
  },
  async execute(args, context) {
    const cwd = context.worktree || context.directory
    const pm = detectPackageManager(cwd)
    const cmd = pm === "npm" ? `${pm} run test` : `${pm} test`
    const flags = []
    if (args.coverage) flags.push("--coverage")
    if (args.watch) flags.push("--watch")
    if (args.pattern) flags.push("--", ...args.pattern.split(/\s+/))

    return JSON.stringify({
      command: flags.length ? `${cmd} ${flags.join(" ")}` : cmd,
      packageManager: pm,
      instructions: `Run this command to execute tests:\n\n${flags.length ? `${cmd} ${flags.join(" ")}` : cmd}`,
    })
  },
})

const changedFilesTool = tool({
  description: "List files that have been created or modified during this session.",
  args: {},
  async execute(_args, _context) {
    return JSON.stringify({
      files: Array.from(_editedFiles),
      count: _editedFiles.size,
    })
  },
})

const gitSummaryTool = tool({
  description: "Show git branch, status, recent commits, and staged/unstaged diffs for the current repository.",
  args: {},
  async execute(_args, context) {
    const cwd = context.worktree || context.directory
    const result: Record<string, string> = {}

    try {
      const { stdout } = await exec("git rev-parse --abbrev-ref HEAD", { cwd, timeout: 3000 })
      result.branch = stdout.trim()
    } catch {
      result.branch = "(not a git repo)"
    }

    try {
      const { stdout } = await exec("git status --short", { cwd, timeout: 3000 })
      result.status = stdout.trim()
    } catch {
      result.status = ""
    }

    try {
      const { stdout } = await exec("git log --oneline -5", { cwd, timeout: 3000 })
      result.recentCommits = stdout.trim()
    } catch {
      result.recentCommits = ""
    }

    try {
      const { stdout } = await exec("git diff --cached --name-only", { cwd, timeout: 3000 })
      result.stagedFiles = stdout.trim()
    } catch {
      result.stagedFiles = ""
    }

    try {
      const { stdout } = await exec("git diff --name-only", { cwd, timeout: 3000 })
      result.unstagedFiles = stdout.trim()
    } catch {
      result.unstagedFiles = ""
    }

    return JSON.stringify(result, null, 2)
  },
})

const formatCommandTool = tool({
  description:
    "[ADVISORY] Detect the code formatter (Biome, Prettier, Black, gofmt, rustfmt) and return the exact command to format the project. Does NOT execute the command — use the returned command with bash.",
  args: {
    path: tool.schema.string().optional().describe("Specific file or directory to format"),
    check: tool.schema.boolean().optional().describe("Check mode (don't write, just report issues)"),
  },
  async execute(args, context) {
    const cwd = context.worktree || context.directory
    const formatter = detectFormatter(cwd)
    const target = args.path || "."

    const formatterCommands: Record<string, { command: string; checkFlag: string }> = {
      biome: { command: `npx biome format --write ${target}`, checkFlag: `npx biome format ${target}` },
      prettier: { command: `npx prettier --write ${target}`, checkFlag: `npx prettier --check ${target}` },
      black: { command: `black ${target}`, checkFlag: `black --check ${target}` },
      gofmt: { command: `gofmt -w ${target}`, checkFlag: `gofmt -d ${target}` },
      rustfmt: { command: `rustfmt ${target}`, checkFlag: `rustfmt --check ${target}` },
    }

    if (!formatter) {
      return JSON.stringify({
        detected: false,
        formatter: null,
        command: null,
        instructions: "No formatter config detected. Options: create biome.json, .prettierrc, or configure Black, gofmt, rustfmt.",
      })
    }

    const entry = formatterCommands[formatter]
    return JSON.stringify({
      detected: true,
      formatter,
      command: args.check ? entry.checkFlag : entry.command,
      instructions: `Detected formatter: ${formatter}. Run: ${args.check ? entry.checkFlag : entry.command}`,
    })
  },
})

const lintCommandTool = tool({
  description:
    "[ADVISORY] Detect the linter (ESLint, Biome, Ruff, Pylint, golangci-lint, Clippy) and return the exact command. Does NOT execute the command — use the returned command with bash.",
  args: {
    path: tool.schema.string().optional().describe("Specific file or directory to lint"),
    fix: tool.schema.boolean().optional().describe("Auto-fix issues when supported"),
  },
  async execute(args, context) {
    const cwd = context.worktree || context.directory
    const linter = detectLinter(cwd)
    const target = args.path || "."

    const linterCommands: Record<string, { command: string; fixFlag: string }> = {
      biome: { command: `npx biome lint ${target}`, fixFlag: `npx biome lint --fix ${target}` },
      eslint: { command: `npx eslint ${target}`, fixFlag: `npx eslint --fix ${target}` },
      golangci_lint: { command: `golangci-lint run ${target}`, fixFlag: `golangci-lint run --fix ${target}` },
      clippy: { command: `cargo clippy -- ${target}`, fixFlag: `cargo clippy --fix -- ${target}` },
    }

    if (!linter) {
      return JSON.stringify({
        detected: false,
        linter: null,
        command: null,
        instructions: "No linter config detected. Options: create biome.json, eslint.config.*, or configure golangci-lint, Clippy.",
      })
    }

    const entry = linterCommands[linter]
    return JSON.stringify({
      detected: true,
      linter,
      command: args.fix ? entry.fixFlag : entry.command,
      instructions: `Detected linter: ${linter}. Run: ${args.fix ? entry.fixFlag : entry.command}`,
    })
  },
})

const securityAuditTool = tool({
  description:
    "Run a three-phase security audit: dependency audit (npm audit), secret scanning (regex for API keys/tokens), and code anti-pattern detection (eval, innerHTML, SQL injection).",
  args: {},
  async execute(_args, context) {
    const cwd = context.worktree || context.directory
    const report: string[] = []
    const commands: string[] = []

    report.push("# Security Audit Report")
    report.push("")

    const hasPackageJson = fs.existsSync(path.join(cwd, "package.json"))
    if (hasPackageJson) {
      report.push("## Phase 1: Dependency Audit")
      report.push("Run: `npm audit` to check for vulnerable dependencies")
      commands.push("npm audit --audit-level=high")
      report.push("")
    }

    const isWin = os.platform() === "win32"
    const secretPattern = '"api[_-]?key|sk-[A-Za-z0-9]|ghp_|gho_|ghu_|xox[abp]|AKIA[0-9A-Z]|-----BEGIN RSA PRIVATE KEY-----"'

    report.push("## Phase 2: Secret Scanning")
    report.push("Run the following to scan for hardcoded secrets:")
    if (isWin) {
      commands.push(`Select-String -Pattern ${secretPattern} -Path @(Get-ChildItem -Recurse -Include "*.ts","*.js","*.py","*.rs","*.go","*.java" -Exclude "*node_modules*") | Select-Object -First 30`)
    } else {
      commands.push(`grep -rn ${secretPattern} --include="*.ts" --include="*.js" --include="*.py" --include="*.rs" --include="*.go" --include="*.java" --exclude-dir=node_modules . | head -30`)
    }
    report.push("")

    report.push("## Phase 3: Anti-Pattern Detection")
    report.push("Run the following to detect dangerous patterns:")
    if (isWin) {
      commands.push('Select-String -Pattern "eval\\(|innerHTML|dangerouslySetInnerHTML|execSync|child_process|fromCharCode|document\\.write|new Function\\(" -Path @(Get-ChildItem -Recurse -Include "*.ts","*.tsx","*.js","*.jsx" -Exclude "*node_modules*") | Select-Object -First 20')
      commands.push("Get-ChildItem -Recurse -Include '*.ts','*.js' -Exclude '*node_modules*' | Select-String -Pattern 'req\\.(query|body|params)' | Select-Object -First 10")
    } else {
      commands.push('grep -rn "eval(\|innerHTML\|dangerouslySetInnerHTML\|execSync\|child_process\|fromCharCode\|document\.write\|new Function(" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --exclude-dir=node_modules . | head -20')
      commands.push('grep -rn "req\\.(query|body|params)" --include="*.ts" --include="*.js" --exclude-dir=node_modules . | head -10')
    }
    report.push("")

    report.push("## Commands to Run")
    commands.forEach(c => report.push(`- \`${c}\``))
    report.push("")
    report.push("**IMPORTANT**: Review the output of each command. Fix CRITICAL issues before committing.")

    return JSON.stringify({
      commands,
      instructions: report.join("\n"),
    })
  },
})

const autoDelegateTool = tool({
  description: "Analyze a user message and recommend which subagent(s) and skill(s) to use. Calls the classification engine with project context for relevance scoring.",
  args: {
    message: tool.schema.string().describe("The user's task description or question"),
    as: tool.schema.string().optional().describe("Optional name to store this result under for later reference"),
  },
  async execute(args, context) {
    _delegationDepth++

    if (_delegationDepth >= 2) {
      return JSON.stringify({
        task: "general",
        confidence: 0,
        recommendedAgents: [],
        recommendedSkills: [],
        reasoning: "Loop guard active: delegation depth limit reached. Subagents cannot delegate further.",
      }, null, 2)
    }

    const cwd = context.worktree || context.directory
    const profile = detectProject(cwd)
    const agentRegistry = buildAgentRegistry()
    const skillRegistry = buildSkillRegistry(skillsDir)
    const result = autoDelegateFn(args.message, profile, agentRegistry, skillRegistry)

    if (args.as) {
      _capturedResults.set(args.as, result)
    }

    return JSON.stringify(result, null, 2)
  },
})

const analyzeTaskTool = tool({
  description: "Classify a user message into a task category and extract keywords. Does not use project context.",
  args: {
    message: tool.schema.string().describe("The user's task description or question"),
  },
  async execute(args, _context) {
    const result = analyzeTaskFn(args.message)
    return JSON.stringify(result, null, 2)
  },
})

export const OpenECCPlugin: Plugin = async ({ client, directory, $, worktree }) => {
  const worktreePath = worktree || directory
  let _projectProfile: ProjectProfile | null = null
  let _skillRegistryCache: ReturnType<typeof buildSkillRegistry> | null = null
  const goalManager = new GoalManager(path.join(worktreePath, ".openecc"))

  const agents: AgentEntry[] = [
    { name: "planner", desc: "Expert planning specialist for complex features and refactoring. Use for implementation planning, architectural changes, or complex refactoring. Trigger: when a task needs structured planning before coding.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "architect", desc: "Software architecture specialist for system design, scalability, and technical decision-making. Use when evaluating architecture, designing systems, or making technical decisions. Trigger: when architecture review or design decisions are needed.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "code-reviewer", desc: "Expert code review specialist. Reviews code for quality, security, and maintainability. Use immediately after writing or modifying code. Trigger: when a file has been edited or written.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "security-reviewer", desc: "Security vulnerability detection and remediation specialist. Use after writing code that handles user input, authentication, API endpoints, or sensitive data. Trigger: when auth, input validation, secrets, or API security is involved.", permission: { task: "deny" } },
    { name: "tdd-guide", desc: "Test-Driven Development specialist enforcing write-tests-first methodology. Use when writing new features, fixing bugs, or refactoring code. Ensures 80%+ test coverage. Trigger: when a feature or bug fix needs tests.", permission: { task: "deny" } },
    { name: "build-error-resolver", desc: "Build and TypeScript error resolution specialist. Use when build fails or type errors occur. Fixes build/type errors only with minimal diffs. Trigger: when tsc, bundler, or runtime errors are present.", permission: { task: "deny" } },
    { name: "e2e-runner", desc: "End-to-end testing specialist using Playwright. Generates, maintains, and runs E2E tests for critical user flows. Use when E2E test coverage is needed. Trigger: when Playwright tests need creation, fixing, or maintenance.", permission: { task: "deny" } },
    { name: "doc-updater", desc: "Documentation and codemap specialist. Keeps docs in sync with code. Use after code changes to update README, API docs, and architecture docs. Trigger: when code changes affect public APIs, README, or architecture docs.", permission: { task: "deny" } },
    { name: "refactor-cleaner", desc: "Dead code cleanup and consolidation specialist. Removes unused code and consolidates duplicates without changing behavior. Use when the codebase has dead code or duplication. Trigger: when unused exports, dead parameters, or duplicates are found.", permission: { task: "deny" } },
    { name: "docs-lookup", desc: "Documentation specialist using web fetch and MCP to research current library/API documentation. Use when you need up-to-date docs for a library, API, or framework. Trigger: when library documentation or API reference lookups are needed.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "harness-optimizer", desc: "Analyzes and improves agent harness configuration for reliability, cost, and throughput. Use to audit and optimize harness setups. Trigger: when harness configuration needs review or optimization.", permission: { task: "deny" } },
    { name: "loop-operator", desc: "Operates autonomous agent loops, monitors progress, and intervenes safely when stuck. Use for long-running multi-iteration tasks. Trigger: when an autonomous multi-step loop needs operation and monitoring.", permission: { task: "deny" } },
    { name: "go-reviewer", desc: "Go code reviewer specializing in idiomatic Go, concurrency patterns, and error handling. Use after writing Go code. Trigger: when Go code has been written or modified.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "go-build-resolver", desc: "Go build and vet error resolution specialist. Use when `go build` or `go vet` fails. Fixes with minimal changes. Trigger: when Go compilation or vet errors occur.", permission: { task: "deny" } },
    { name: "python-reviewer", desc: "Python code reviewer specializing in PEP 8, type hints, security, and performance. Use after writing Python code. Trigger: when Python code has been written or modified.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "rust-reviewer", desc: "Rust code reviewer specializing in ownership, lifetimes, concurrency, and safety. Use after writing Rust code. Trigger: when Rust code has been written or modified.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "rust-build-resolver", desc: "Rust build and Cargo error resolution specialist. Use when `cargo check`, `build`, or `test` fails. Fixes with minimal changes. Trigger: when Rust compilation or test errors occur.", permission: { task: "deny" } },
    { name: "cpp-reviewer", desc: "C++ code reviewer specializing in memory safety, modern C++, and performance. Use after writing C++ code. Trigger: when C++ code has been written or modified.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "cpp-build-resolver", desc: "C++ build and CMake error resolution specialist. Use when C++ or CMake builds fail. Fixes linker, template, and configuration errors with minimal changes. Trigger: when C++ compilation, linking, or CMake errors occur.", permission: { task: "deny" } },
    { name: "java-reviewer", desc: "Java and Spring Boot reviewer specializing in layered architecture, JPA, and security. Use after writing Java/Spring code. Trigger: when Java or Spring Boot code has been written or modified.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "java-build-resolver", desc: "Java/Maven/Gradle build error resolution specialist. Use when Java build or tests fail. Fixes with minimal changes. Trigger: when Java compilation, Maven, or Gradle errors occur.", permission: { task: "deny" } },
    { name: "kotlin-reviewer", desc: "Kotlin and Android reviewer specializing in coroutines, Jetpack Compose, and idiomatic patterns. Use after writing Kotlin/Android code. Trigger: when Kotlin or Android code has been written or modified.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "kotlin-build-resolver", desc: "Kotlin/Gradle build error resolution specialist. Use when Kotlin or Gradle builds fail. Fixes with minimal changes. Trigger: when Kotlin compilation or Gradle configuration errors occur.", permission: { task: "deny" } },
    { name: "database-reviewer", desc: "PostgreSQL and Supabase database specialist for query optimization, schema design, and security. Use after writing database queries, migrations, or RLS policies. Trigger: when SQL queries, schema changes, or RLS policies need review.", permission: { task: "deny" } },
    { name: "swarm-coordinator", desc: "Orchestrates full engineering pipeline: think → plan → review → build → test → ship → reflect. Spawns and coordinates multiple subagents in parallel. Hard max 5 live subagents. Use for end-to-end feature delivery. Trigger: when a complete engineering pipeline is needed from ideation to ship.", permission: { edit: "deny", write: "deny" } },
    { name: "plan-ceo-reviewer", desc: "Reviews implementation plans from business/product perspective. Returns structured feedback: Block (critical issue), Warn (risky), Suggest (improvement), Questions (clarifications needed). Use when a plan needs business viability or product alignment review. Trigger: when a plan has been created and needs business/product review.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "plan-design-reviewer", desc: "Reviews implementation plans from UX/design perspective. Returns structured feedback: Block (critical issue), Warn (risky), Suggest (improvement), Questions (clarifications needed). Use when a plan needs UX or design review. Trigger: when a plan has been created and needs design review.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "plan-devex-reviewer", desc: "Reviews implementation plans from developer experience perspective. Returns structured feedback: Block (critical issue), Warn (risky), Suggest (improvement), Questions (clarifications needed). Use when a plan needs DX/API ergonomics review. Trigger: when a plan has been created and needs developer experience review.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "plan-eng-reviewer", desc: "Reviews implementation plans from engineering/architecture perspective. Returns structured feedback: Block (critical issue), Warn (risky), Suggest (improvement), Questions (clarifications needed). Use when a plan needs technical architecture or engineering review. Trigger: when a plan has been created and needs engineering review.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "goal-evaluator", desc: "Evaluates whether a swarm session goal has been met based on conversation context. Read-only: does not run commands or read files. Returns Met | Not Met | Partial with evidence and recommendations. Use as the completion gate in the /swarm pipeline. Trigger: after build and review phases to determine if the goal condition is satisfied.", permission: { edit: "deny", write: "deny", bash: "deny", glob: "deny", grep: "deny", task: "deny" } },
  ]
  const commands: CommandEntry[] = [
    { name: "plan", desc: "Create a detailed implementation plan for complex features or refactoring", agent: "planner", subtask: true },
    { name: "code-review", desc: "Review code for quality, security, and maintainability", agent: "code-reviewer", subtask: true },
    { name: "security", desc: "Run comprehensive security review using OWASP guidelines", agent: "security-reviewer", subtask: true },
    { name: "tdd", desc: "Enforce TDD workflow with 80%+ test coverage", agent: "tdd-guide", subtask: true },
    { name: "quality-gate", desc: "Run quality pipeline: format, lint, type-check, test, security scan", subtask: false },
    { name: "build-fix", desc: "Fix build and TypeScript errors with minimal changes", agent: "build-error-resolver", subtask: true },
    { name: "e2e", desc: "Generate and run E2E tests with Playwright", agent: "e2e-runner", subtask: true },
    { name: "refactor-clean", desc: "Remove dead code and consolidate duplicates", agent: "refactor-cleaner", subtask: true },
    { name: "orchestrate", desc: "Orchestrate multiple agents for complex tasks", agent: "planner", subtask: true },
    { name: "update-docs", desc: "Update documentation to reflect current codebase", agent: "doc-updater", subtask: true },
    { name: "update-codemaps", desc: "Update codemaps to reflect current architecture", agent: "doc-updater", subtask: true },
    { name: "test-coverage", desc: "Analyze and improve test coverage", agent: "tdd-guide", subtask: true },
    { name: "learn", desc: "Extract patterns and learnings from current session" },
    { name: "checkpoint", desc: "Save verification state and progress checkpoint" },
    { name: "verify", desc: "Run verification loop: build, lint, test, security" },
    { name: "eval", desc: "Run evaluation against acceptance criteria" },
    { name: "setup-pm", desc: "Configure package manager for the project" },
    { name: "go-review", desc: "Review Go code for idiomatic patterns and correctness", agent: "go-reviewer", subtask: true },
    { name: "go-test", desc: "Run Go TDD workflow", agent: "tdd-guide", subtask: true },
    { name: "go-build", desc: "Fix Go build and vet errors", agent: "go-build-resolver", subtask: true },
    { name: "rust-review", desc: "Review Rust code for safety and correctness", agent: "rust-reviewer", subtask: true },
    { name: "rust-test", desc: "Run Rust TDD workflow", agent: "tdd-guide", subtask: true },
    { name: "rust-build", desc: "Fix Rust build and Cargo errors", agent: "rust-build-resolver", subtask: true },
    { name: "security-scan", desc: "Run dependency, secret, and anti-pattern scan" },
    { name: "harness-audit", desc: "Audit harness configuration quality and coverage" },
    { name: "loop-start", desc: "Start autonomous agent loop with safety defaults" },
    { name: "loop-status", desc: "Check autonomous loop status and progress" },
    { name: "skill-create", desc: "Generate skill files from git history patterns" },
    { name: "instinct-status", desc: "View learned instinct patterns" },
    { name: "instinct-import", desc: "Import instincts from a file" },
    { name: "instinct-export", desc: "Export instincts to a file" },
    { name: "evolve", desc: "Cluster instincts into reusable skills" },
    { name: "promote", desc: "Promote project instincts to global scope" },
    { name: "projects", desc: "List known projects and instinct statistics" },
    { name: "swarm", desc: "Execute full engineering pipeline: think → plan → review → build → test → evaluate → ship → reflect. Coordinates multiple subagents via the swarm-coordinator. The /swarm argument IS the goal condition, evaluated by goal-evaluator before shipping.", agent: "swarm-coordinator", subtask: true },
    { name: "make", desc: "Alias for /swarm. Execute full engineering pipeline end-to-end.", agent: "swarm-coordinator", subtask: true },
  ]

  return {
    "tool.definition": async (input, output) => {
      if (input.toolID === "edit" || input.toolID === "write") {
        output.description = `[OPENECC ENFORCEMENT] This tool MUST be called inside a subagent, not in main context. Delegate via \`task\` tool to @builder or language-specific subagent. Rule: no direct work in main context. | ${output.description}`
      }
      if (input.toolID === "glob" || input.toolID === "grep") {
        output.description = `[OPENECC ENFORCEMENT] Source code search must be delegated to a subagent. In main context, delegate via \`task\` tool. Rule: main context is TALK + DELEGATE only. | ${output.description}`
      }
      if (input.toolID === "bash") {
        output.description = `[OPENECC ENFORCEMENT] All commands must run inside a subagent. In main context, delegate via \`task\` tool to @executor or language-specific subagent. Rule: no commands in main context. | ${output.description}`
      }
    },

    "command.execute.before": async (input: { command: string; arguments: string }, output: { parts: any[] }) => {
      if (input.command === "goal") {
      const args = input.arguments
      if (!args || args.trim() === "") {
        output.parts = [{ type: "text", text: "Usage: /goal <condition> | /goal status | /goal clear | /goal resume | /goal history", id: "", sessionID: "", messageID: "" }]
        return
      }
      const parts = args.trim().split(/\s+/)
      const sub = parts[0]?.toLowerCase()
      if (sub === "status") {
        output.parts = [{ type: "text", text: goalManager.status().display, id: "", sessionID: "", messageID: "" }]
      } else if (sub === "clear") {
        goalManager.clear()
        output.parts = [{ type: "text", text: "Goal cleared.", id: "", sessionID: "", messageID: "" }]
      } else if (sub === "resume") {
        goalManager.resume()
        output.parts = [{ type: "text", text: "Goal resumed.", id: "", sessionID: "", messageID: "" }]
      } else if (sub === "history") {
        output.parts = [{ type: "text", text: JSON.stringify(goalManager.hist(), null, 2), id: "", sessionID: "", messageID: "" }]
      } else {
        const condition = args.trim()
        goalManager.start(condition)
        output.parts = [{ type: "text", text: `Goal started: "${condition}". I will work toward this goal and stop when complete, blocked, or budget exhausted.`, id: "", sessionID: "", messageID: "" }]
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
          for (const p of idx.plans) {
            lines.push(`- #${p.id}: ${p.summary} (${p.status}, ${p.done}/${p.total})`)
          }
          output.parts = [{ type: "text", text: lines.join("\n"), id: "", sessionID: "", messageID: "" }]
          return
        }

        if (sub === "status") {
          const active = getActivePlan(worktreePath)
          if (!active) {
            output.parts = [{ type: "text", text: "No active plan.", id: "", sessionID: "", messageID: "" }]
            return
          }
          output.parts = [{ type: "text", text: `Active plan #${active.id}: ${active.summary} (${active.status}, ${active.done}/${active.total})`, id: "", sessionID: "", messageID: "" }]
          return
        }

        if (sub === "create") {
          const summary = planParts.slice(1).join(" ")
          if (!summary) {
            output.parts = [{ type: "text", text: "Usage: /plan create <summary>", id: "", sessionID: "", messageID: "" }]
            return
          }
          const idx = readPlanIndex(worktreePath)
          const index = idx || { nextId: 1, activePlanId: null, plans: [] }
          const newId = index.nextId || 1
          index.nextId = newId + 1
          index.plans.push({ id: newId, summary: summary.length > 80 ? summary.slice(0, 77) + "..." : summary, status: "approved", done: 0, total: 1 })
          index.activePlanId = newId
          writePlanIndex(worktreePath, index)
          output.parts = [{ type: "text", text: `Plan #${newId} created and activated: "${summary}"`, id: "", sessionID: "", messageID: "" }]
          return
        }

        if (sub === "transition") {
          const id = parseInt(planParts[1], 10)
          const newStatus = planParts[2]
          if (isNaN(id) || !newStatus) {
            output.parts = [{ type: "text", text: "Usage: /plan transition <id> <status>", id: "", sessionID: "", messageID: "" }]
            return
          }
          const VALID_STATUSES: readonly string[] = ["draft", "reviewed", "ready", "approved", "in_progress", "done", "blocked", "abandoned"]
          if (!VALID_STATUSES.includes(newStatus)) {
            output.parts = [{ type: "text", text: `Invalid status: "${newStatus}". Valid statuses: ${VALID_STATUSES.join(", ")}`, id: "", sessionID: "", messageID: "" }]
            return
          }
          const err = updatePlanStatus(worktreePath, id, newStatus)
          if (err) {
            output.parts = [{ type: "text", text: `Error: ${err}`, id: "", sessionID: "", messageID: "" }]
            return
          }
          output.parts = [{ type: "text", text: `Plan #${id} transitioned to ${newStatus}.`, id: "", sessionID: "", messageID: "" }]
          return
        }

        output.parts = [{ type: "text", text: `Unknown subcommand: ${sub}. Try: list, status, create, transition`, id: "", sessionID: "", messageID: "" }]
        return
      }
    },

    config: async (config: any) => {
      config.skills = config.skills || {}
      config.skills.paths = config.skills.paths || []
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir)
      }

      config.instructions = config.instructions || []
      const agentsMDAbs = agentsMDPath
      if (!config.instructions.some((i: string) => i === agentsMDAbs)) {
        config.instructions.push(agentsMDAbs)
      }

      config.agent = config.agent || {}
      for (const agent of agents) {
        if (!config.agent[agent.name]) {
          const prompt = readFileSafe(path.join(agentsDir, `${agent.name}.txt`))
          if (prompt) {
            const agentConfig: Record<string, unknown> = {
              description: agent.desc,
              mode: "subagent",
              prompt,
            }
            if (agent.permission) {
              agentConfig.permission = agent.permission
            }
            config.agent[agent.name] = agentConfig
          }
        }
      }

      config.command = config.command || {}
      for (const cmd of commands) {
        if (!config.command[cmd.name]) {
          const templateContent = readFileSafe(path.join(commandsDir, `${cmd.name}.md`))
          const cleanTemplate = stripYamlFrontmatter(templateContent)
          if (cleanTemplate) {
            config.command[cmd.name] = {
              description: cmd.desc,
              template: `${cleanTemplate}\n\n$ARGUMENTS`,
              ...(cmd.agent ? { agent: cmd.agent } : {}),
              ...(cmd.subtask ? { subtask: true } : {}),
            }
          }
        }
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      if (!_projectProfile) {
        _projectProfile = detectProject(worktreePath)
      }

      const soulPath = path.join(skillsDir, "soul", "SKILL.md")
      const soulContent = readFileSafe(soulPath)
      const cleanSoul = stripYamlFrontmatter(soulContent)

      const systemBootstrap = `<EXTREMELY_IMPORTANT>
You have a soul — the principles below are always active. They are ALREADY LOADED.

${cleanSoul}
</EXTREMELY_IMPORTANT>

${DELEGATOR_ROLE}

${DELEGATION_ENFORCEMENT}

${TOOL_ACCESS_BLOCK}

${QUICK_ROUTING}

${COMPLETION_CONTRACT}

${buildProjectProfileSection(_projectProfile)}`

      const sysOutput = output as TransformOutput
      const systemMessages: TransformOutput["systemMessages"] = sysOutput.systemMessages || []
      if (!systemMessages.some((p) => p.text?.includes("EXTREMELY_IMPORTANT"))) {
        systemMessages.unshift({ type: "text", text: systemBootstrap })
        sysOutput.systemMessages = systemMessages
      }

      try {
        const openeccDir = path.join(worktreePath, ".openecc")
        const indexJsonPath = path.join(openeccDir, "index.json")
        if (!fs.existsSync(openeccDir)) fs.mkdirSync(openeccDir, { recursive: true })
        if (!fs.existsSync(indexJsonPath)) {
          fs.writeFileSync(indexJsonPath, JSON.stringify({ nextId: 1, activePlanId: null, plans: [] }, null, 2))
        }
        const indexData = JSON.parse(fs.readFileSync(indexJsonPath, "utf8"))
        const activeId = indexData.activePlanId
        const activePlan = indexData.plans?.find((p: Record<string, unknown>) => p.id === activeId)
        if (activePlan) {
          const planBlock = `<structured type="plan_state">
active_plan: ${activePlan.id}
status: ${activePlan.status || "unknown"}
done: ${activePlan.done ?? 0}
total: ${activePlan.total ?? 0}
goal: ${activePlan.summary || ""}
</structured>`
          if (!systemMessages.some((p) => p.text?.includes("plan_state"))) {
            systemMessages.push({ type: "text", text: planBlock })
            sysOutput.systemMessages = systemMessages
          }

          // inject tool access block
          const toolBlock = buildToolAccessBlock()
          if (!systemMessages.some((p) => p.text?.includes("tool_access"))) {
            systemMessages.push({ type: "text", text: toolBlock })
          }
        }
      } catch {
        // .openecc init or read failed — skip silently
      }

      if (goalManager.isActive()) {
        const goalState = goalManager.getState()
        const goalBlock = `<goal_objective>
condition: ${goalState!.condition}
turns: ${goalState!.turnCount}
budget_warned: ${goalState!.budgetWarned}
</goal_objective>`
        if (!systemMessages.some((p) => p.text?.includes("goal_objective"))) {
          systemMessages.push({ type: "text", text: goalBlock })
          sysOutput.systemMessages = systemMessages
        }
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages?.length) return
      const firstUser = output.messages.find((m: ChatMessage) => m.info?.role === "user")
      if (!firstUser || !firstUser.parts?.length) return
      if (firstUser.parts.some((p: MessagePart) => p.type === "text" && p.text?.includes("EXTREMELY_IMPORTANT"))) return

      if (!_skillRegistryCache) {
        _skillRegistryCache = buildSkillRegistry(skillsDir)
      }
      const cache = _skillRegistryCache!
      const firstTextPart: MessagePart | undefined = firstUser.parts.find((p: MessagePart) => p.type === "text")
      const firstUserText = firstTextPart?.text || ""
      if (firstUserText.length >= 2000) return

      const taskAnalysis = analyzeTaskFn(firstUserText.slice(0, 500))
      if (taskAnalysis.category === "general") return

      const skillEntries = Object.entries(cache)
      const matchResults = skillEntries.map(([name, trigger]) => {
        const tokens = firstUserText.toLowerCase().split(/[\s,;:.!?()]+/).filter((w: string) => w.length > 1)
        const lowerKeywords = trigger.keywords.map(k => k.toLowerCase())
        const matches = tokens.filter((t: string) => lowerKeywords.includes(t)).length
        const confidence = trigger.keywords.length > 0 ? matches / Math.max(trigger.keywords.length, 1) : 0
        return { name, confidence }
      })
      matchResults.sort((a, b) => b.confidence - a.confidence)
      const topSkill = matchResults[0]
      if (!topSkill || topSkill.confidence < 0.7) return

      const skillPath = path.join(skillsDir, topSkill.name, "SKILL.md")
      const skillContent = readFileSafe(skillPath)
      const cleanContent = stripYamlFrontmatter(skillContent)
      if (!cleanContent) return

      const autoLoadedSkill = `\n### Auto-Loaded Skill: ${topSkill.name}\n(injected based on task analysis)\n${cleanContent.slice(0, 3000)}\n`

      // ── Plan Gate + Auto-Plan ──────────────────────────────────────────
      try {
        const gate = getPlanGate(worktreePath)
        const parts = output.messages[0].parts as Array<{ type: string; text?: string }>
        const userText = parts.filter(p => p.type === "text" && typeof p.text === "string").map(p => p.text as string).join(" ")
        const intent = classifyIntent(userText)

        const TRIVIAL_PATTERNS = ["typo", "semicolon", "rename", "format", "comment", "spelling"]
        const isTrivial = TRIVIAL_PATTERNS.some(p => userText.toLowerCase().includes(p))

        if (!gate && intent.isWork) {
          // Gate is open — all good
        } else if (gate && intent.isWork && !isTrivial) {
          // Check if this is lightweight enough to auto-create a plan
          const tokens = userText.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
          const isLightweight = tokens.length <= 20 && !["refactor", "migrate", "architecture", "redesign"].some(k => userText.toLowerCase().includes(k))

          if (isLightweight) {
            // Auto-create plan
            const index = readPlanIndex(worktreePath)
            const idx = index || { nextId: 1, activePlanId: null, plans: [] }
            const newId = idx.nextId || 1
            idx.nextId = newId + 1
            const summary = userText.length > 60 ? userText.slice(0, 57) + "..." : userText
            idx.plans.push({
              id: newId,
              summary,
              status: "approved",
              done: 0,
              total: 1,
            })
            idx.activePlanId = newId
            writePlanIndex(worktreePath, idx)

            // Prepend auto-plan notice
            const firstText = parts.find(p => p.type === "text")
            if (firstText && typeof firstText.text === "string") {
              firstText.text = `[AUTO-PLAN] Created plan ${newId} for: "${summary}". Proceeding.\n\n---\n${firstText.text}`
            }
          } else {
            // Prepend gate warning
            const firstText = parts.find(p => p.type === "text")
            if (firstText && typeof firstText.text === "string") {
              firstText.text = `[PLAN GATE]\n${gate}\n\n---\n${firstText.text}`
            }
          }
        }
      } catch {
        // non-fatal
      }

      const originalPart = firstUser.parts[0] as { sessionID?: string; messageID?: string }
      firstUser.parts.unshift({
        type: "text" as const,
        text: autoLoadedSkill,
        id: `skill-inject-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sessionID: originalPart.sessionID || "",
        messageID: originalPart.messageID || "",
      })

      if (goalManager.isActive()) {
        const msgs = (output.messages ?? []) as ChatMessage[]
        for (const msg of msgs) {
          const parts = msg.parts || []
          for (const part of parts) {
            const text = (part as MessagePart).text || ""
            if (msg.info?.role === "assistant") {
              goalManager.parseMarkers(text)
              goalManager.trackChars(text.length)
            } else if (msg.info?.role === "user") {
              goalManager.trackChars(text.length)
            }
          }
        }
      }

      // resolve $RESULT[name] references
      const resolveMessages = (output.messages ?? []) as ChatMessage[]
      for (const msg of resolveMessages) {
        for (const part of msg.parts || []) {
          if (part.type === "text") {
            const textPart = part as MessagePart
            if (typeof textPart.text === "string") {
              textPart.text = textPart.text.replace(/\$RESULT\[(\w+)\]/g, (_: string, name: string) => {
                return _namedResults.get(name) || `[RESULT ${name}: not found]`
              })
            }
          }
        }
      }

      // execute pending returns
      const sessionKey = "default"
      const pending = _pendingReturns.get(sessionKey)
      if (pending && pending.length > 0) {
        const next = pending.shift()!
        if (next.command) {
          const textPart = output.messages?.[0]?.parts?.[0] as MessagePart | undefined
          if (textPart) {
            textPart.text = `/${next.command}\n\n${textPart.text || ""}`
          }
        } else if (next.prompt) {
          ;(output.messages as ChatMessage[])?.push({
            info: { role: "user" },
            parts: [{ type: "text", text: `[return chain] ${next.prompt}`, id: "", sessionID: "", messageID: "" }],
          })
        }
        if (pending.length === 0) _pendingReturns.delete(sessionKey)
      }
    },

    "experimental.session.compacting": async (_input, output) => {
      output.context.push("# OpenECC Context (preserve across compaction)")
      output.context.push("")
      output.context.push("## OpenECC Delegator")
      output.context.push("- Primary role: delegate to subagents, synthesize results, verify before claiming")
      output.context.push("- Soul: Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution")
      output.context.push("- Route by task type: planning, review, build-fix, TDD, docs, language-specific")
      output.context.push("- Answer directly when no tools are needed")
      output.context.push("")
      if (_projectProfile) {
        output.context.push("## Project Profile")
        output.context.push(`- Languages: ${_projectProfile.languages.join(", ") || "none detected"}`)
        if (_projectProfile.frameworks.length > 0) {
          output.context.push(`- Frameworks: ${_projectProfile.frameworks.join(", ")}`)
        }
        if (_projectProfile.testFrameworks.length > 0) {
          output.context.push(`- Test tools: ${_projectProfile.testFrameworks.join(", ")}`)
        }
        output.context.push(`- Package manager: ${_projectProfile.packageManager}`)
        output.context.push("")
      }
      if (_capturedResults.size > 0) {
        output.context.push("## Captured Delegation Results")
        for (const [name] of _capturedResults) {
          output.context.push(`- ${name}: available`)
        }
        output.context.push("")
      }
      if (goalManager.isActive()) {
        const s = goalManager.getState()!
        output.context.push("## Active Goal")
        output.context.push(`- Condition: ${s.condition}`)
        output.context.push(`- Turns: ${s.turnCount}`)
        output.context.push(`- Chars tracked: ${s.totalChars}`)
        output.context.push(`- No-progress stalls: ${s.noProgressTurns}`)
        output.context.push("")
      }
      if (_namedResults.size > 0) {
        output.context.push("## Named Results")
        for (const [name] of _namedResults) {
          output.context.push(`- ${name}: available`)
        }
        output.context.push("")
      }
      if (_editedFiles.size > 0) {
        output.context.push("## Recently Edited Files")
        for (const f of _editedFiles) output.context.push(`- ${f}`)
        output.context.push("")
      }
    },

    "file.edited": async (event: { path: string }) => {
      _editedFiles.add(event.path)

      if (event.path.match(/\.(ts|tsx|js|jsx)$/)) {
        try {
          const content = fs.readFileSync(event.path, "utf-8")
          const matches = content.match(/console\.log/g)
          if (matches) {
            await client.app.log({
              body: {
                service: "openecc",
                level: "warn" as const,
                message: `console.log found in ${event.path} (${matches.length} occurrence${matches.length > 1 ? "s" : ""})`,
              },
            })
          }
        } catch {}
      }
    },

    "tool.execute.after": async (input: { tool: string; args?: Record<string, unknown> }, _output: unknown) => {
      const filePath = input.args?.filePath as string | undefined
      if ((input.tool === "edit" || input.tool === "write") && filePath) {
        _editedFiles.add(filePath)
      }

      // named result capture from task calls
      if (input.tool === "task") {
        const promptText = typeof input.args?.prompt === "string" ? input.args.prompt : ""
        const overrides = parseOverrides(promptText)
        if (overrides.as) {
          const outputStr = typeof _output === "string" ? _output : JSON.stringify(_output)
          _namedResults.set(overrides.as, outputStr)
        }
      }

      // return chaining from subtask commands
      if (input.tool === "task") {
        const promptText = typeof input.args?.prompt === "string" ? input.args.prompt : ""
        if (promptText.includes("{return:")) {
          const returnMatch = promptText.match(/\{return:([^}]+)\}/)
          if (returnMatch) {
            const sessionKey: string = (input.args?.sessionID as string) || "default"
            const existing = _pendingReturns.get(sessionKey) || []
            existing.push({ prompt: returnMatch[1] })
            _pendingReturns.set(sessionKey, existing)
          }
        }
      }
    },

    "session.idle": async () => {
      _delegationDepth = 0

      if (_editedFiles.size === 0) return

      let count = 0
      const files: string[] = []
      for (const file of _editedFiles) {
        if (!file.match(/\.(ts|tsx|js|jsx)$/)) continue
        try {
          const content = fs.readFileSync(file, "utf-8")
          const matches = content.match(/console\.log/g)
          const n = matches ? matches.length : 0
          if (n > 0) { count += n; files.push(file) }
        } catch {}
      }

      if (count > 0) {
        await client.app.log({
          body: {
            service: "openecc",
            level: "warn" as const,
            message: `Session idle audit: ${count} console.log(s) in ${files.length} file(s). Remove before committing.`,
          },
        })
      }

      // Auto-block plan on sustained no-progress
      if (goalManager.isActive()) {
        const gs = goalManager.getState()
        if (gs && gs.noProgressTurns >= 3 && gs.stopped === "no_progress") {
          const currentPlan = getActivePlan(worktreePath)
          if (currentPlan && currentPlan.status !== "blocked" && currentPlan.status !== "done") {
            const err = updatePlanStatus(worktreePath, currentPlan.id, "blocked")
            if (!err) {
              await client.app.log({
                body: {
                  service: "openecc",
                  level: "warn" as const,
                  message: `Plan ${currentPlan.id} auto-blocked: no progress for ${gs.noProgressTurns} turns`,
                },
              })
            }
          }
        }
      }

      if (goalManager.shouldAutoContinue()) {
        const gs = goalManager.getState()
        if (gs) {
          const budget = goalManager.checkBudget(gs.turnCount, gs.totalChars, Date.now() - gs.startedAt)
          if (budget?.stop) {
            await client.app.log({
              body: {
                service: "openecc",
                level: "warn" as const,
                message: `Goal auto-stopped: ${budget.reason}`,
              },
            })
          } else {
            if (_autoContinuePending) return
            _autoContinuePending = true
            const promptClient = client as unknown as SessionPromptClient
            if (promptClient.session?.prompt) {
              promptClient.session.prompt({ sessionID: "", parts: [{ type: "text", text: `[auto-continue] Continue working toward goal: "${gs.condition}"` }] })
            }
            setTimeout(() => { _autoContinuePending = false }, IDLE_CONTINUE_GUARD_MS)
          }
        }
      }

      _editedFiles.clear()
    },

    "session.deleted": async () => {
      _editedFiles.clear()
      goalManager.persist()
      _namedResults.clear()
    },

    "shell.env": async (_input, output) => {
      output.env.ECC_VERSION = "1.0.0"
      output.env.ECC_PLUGIN = "true"
      output.env.PROJECT_ROOT = worktreePath

      const pm = detectPackageManager(worktreePath)
      if (pm) output.env.PACKAGE_MANAGER = pm

      const langDetectors: Record<string, string> = {
        "tsconfig.json": "typescript",
        "go.mod": "go",
        "pyproject.toml": "python",
        "Cargo.toml": "rust",
      }
      const detected: string[] = []
      for (const [file, lang] of Object.entries(langDetectors)) {
        if (resolveProjectFile(worktreePath, file)) detected.push(lang)
      }
      if (detected.length > 0) {
        output.env.DETECTED_LANGUAGES = detected.join(",")
        output.env.PRIMARY_LANGUAGE = detected[0]
      }
    },

    tool: {
      "test-command": testCommandTool,
      "changed-files": changedFilesTool,
      "git-summary": gitSummaryTool,
      "format-command": formatCommandTool,
      "lint-command": lintCommandTool,
      "security-audit": securityAuditTool,
      "auto-delegate": autoDelegateTool,
      "analyze-task": analyzeTaskTool,
    },
  }
}

export default OpenECCPlugin
