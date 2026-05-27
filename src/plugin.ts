import { tool, type Plugin } from "@opencode-ai/plugin"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as fs from "node:fs"
import { execSync } from "node:child_process"
import { detectProject, type ProjectProfile } from "./routing/detect"
import { buildAgentRegistry, buildSkillRegistry } from "./routing/registry"
import { autoDelegate as autoDelegateFn, analyzeTask as analyzeTaskFn } from "./routing/classifier"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const skillsDir = path.resolve(__dirname, "..", "skills")
const agentsDir = path.resolve(__dirname, "..", "prompts", "agents")
const commandsDir = path.resolve(__dirname, "..", "commands")
const agentsMDPath = path.resolve(__dirname, "..", "..", "AGENTS.md")

const DELEGATOR_ROLE = `## Your Role (OpenECC Delegator)

Your primary job is to delegate, synthesize, and verify — not to do work directly.

### When to delegate to a subagent (@mention):
- Planning / architecture → @planner
- Code review / quality → @code-reviewer
- Security review → @security-reviewer
- Build/type errors → @build-error-resolver
- Test-first development → @tdd-guide
- E2E tests → @e2e-runner
- Documentation → @doc-updater / @docs-lookup
- Dead code cleanup → @refactor-cleaner
- Language-specific (Go/Rust/C++/Java/Kotlin/Python) → respective reviewer
- Complex multi-step tasks → @planner (orchestrate mode)

### When to load a skill:
- API design → skill tool → api-design
- Backend patterns → skill tool → backend-patterns
- Frontend patterns → skill tool → frontend-patterns
- Testing patterns → skill tool → tdd-workflow / e2e-testing
- Security review → skill tool → security-review

### When to answer directly:
- Simple factual questions
- Quick clarifications ("what is X?")
- Status checks
- Anything that requires zero tools

### Completion protocol:
1. **Verify before claiming** — run the command, read the output, then speak
2. **Synthesize** — distill subagent results into 3-5 sentences max
3. **Signature** — end with \`---\` and a brief status summary`

const QUICK_ROUTING = `### Quick Routing
Task \\u2192 Subagent:
  plan/architect   \\u2192 @planner
  code review      \\u2192 @code-reviewer
  security         \\u2192 @security-reviewer
  build/type error \\u2192 @build-error-resolver
  test-first/TDD   \\u2192 @tdd-guide
  docs             \\u2192 @doc-updater / @docs-lookup
  cleanup/refactor \\u2192 @refactor-cleaner
  debug            \\u2192 @build-error-resolver
  e2e              \\u2192 @e2e-runner
  language-specific \\u2192 <lang>-reviewer / <lang>-build-resolver
  complex multi    \\u2192 @planner (orchestrate)

Skill \\u2192 Task:
  api-design          \\u2192 API routes, resources, pagination
  backend-patterns    \\u2192 Node.js, Express, Next.js API
  frontend-patterns   \\u2192 React, Next.js, state, UI
  tdd-workflow        \\u2192 red-green-refactor, 80% coverage
  e2e-testing         \\u2192 Playwright, Page Object Model
  security-review     \\u2192 auth, input validation, secrets
  coding-standards    \\u2192 naming, immutability, quality
  verification-loop   \\u2192 build, types, lint, test, security
  strategic-compact   \\u2192 context compaction strategy
  api-security        \\u2192 authZ, rate limiting, OWASP`

const COMPLETION_CONTRACT = `### Before responding
1. Did you delegate analysis/planning work to a subagent when appropriate?
2. Did you verify results (not assume)?
3. Is the response concise and synthesized?

When done: place \`---\` followed by \`**Status:** \\u2705 Done | \\u1f6a7 Blocked | \\ud83d\\udd04 In Progress\``

let _projectProfile: ProjectProfile | null = null
let _skillRegistryCache: ReturnType<typeof buildSkillRegistry> | null = null
let _delegationDepth = 0
let _ignoredRecommendations = 0
const _capturedResults = new Map<string, any>()

function buildProjectProfileSection(p: ProjectProfile): string {
  const lines: string[] = []
  lines.push("### Project Profile (auto-detected)")
  if (p.languages.length > 0) lines.push(`- Languages: ${p.languages.join(", ")}`)
  if (p.frameworks.length > 0) lines.push(`- Frameworks: ${p.frameworks.join(", ")}`)
  if (p.testFrameworks.length > 0) lines.push(`- Test tools: ${p.testFrameworks.join(", ")}`)
  lines.push(`- Package manager: ${p.packageManager}`)
  lines.push("")

  const subagentLines: string[] = []
  const langAgentMap: Record<string, string[]> = {
    go: ["go-reviewer", "go-build-resolver"],
    rust: ["rust-reviewer", "rust-build-resolver"],
    python: ["python-reviewer"],
    typescript: [],
  }
  for (const lang of p.languages) {
    const agents = langAgentMap[lang] || []
    for (const agent of agents) {
      subagentLines.push(`- @${agent} — ${lang} code detected`)
    }
  }
  for (const tf of p.testFrameworks) {
    if (tf === "jest" || tf === "vitest") subagentLines.push("- @tdd-guide — tests detected")
    if (tf === "playwright") subagentLines.push("- @e2e-runner — Playwright detected")
  }
  if (subagentLines.length > 0) {
    lines.push("### Priority Subagents")
    lines.push(...subagentLines)
    lines.push("")
  }

  const skillLines: string[] = []
  for (const fw of p.frameworks) {
    if (fw === "nextjs") skillLines.push("- frontend-patterns — Next.js framework")
    if (fw === "angular") skillLines.push("- angular-best-practices — Angular framework")
  }
  if (p.testFrameworks.includes("playwright")) skillLines.push("- e2e-testing — Playwright detected")
  if (p.testFrameworks.some(t => t === "jest" || t === "vitest")) skillLines.push("- tdd-workflow — tests detected")
  if (p.languages.some(l => l === "javascript" || l === "typescript")) {
    skillLines.push("- backend-patterns — JS/TS backend support")
  }
  if (skillLines.length > 0) {
    lines.push("### Recommended Skills")
    lines.push(...skillLines)
    lines.push("")
  }

  lines.push("At the start of each significant task, use `auto-delegate` to get routing recommendations.")
  return lines.join("\n")
}

function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return ""
  }
}

function resolveProjectFile(worktreePath: string, relativePath: string): boolean {
  try {
    return fs.statSync(path.join(worktreePath, relativePath)).isFile()
  } catch {
    return false
  }
}

function stripYamlFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n/, "")
}

function detectPackageManager(cwd: string): string {
  const lockfiles: Record<string, string> = {
    "bun.lockb": "bun",
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "package-lock.json": "npm",
  }
  for (const [lock, name] of Object.entries(lockfiles)) {
    if (fs.existsSync(path.join(cwd, lock))) return name
  }
  return "npm"
}

function detectFormatter(cwd: string): string | null {
  if (fs.existsSync(path.join(cwd, "biome.json")) || fs.existsSync(path.join(cwd, "biome.jsonc"))) return "biome"
  if (fs.existsSync(path.join(cwd, ".prettierrc")) || fs.existsSync(path.join(cwd, ".prettierrc.json")) || fs.existsSync(path.join(cwd, "prettier.config.js")) || fs.existsSync(path.join(cwd, ".prettierrc.yaml"))) return "prettier"
  if (fs.existsSync(path.join(cwd, "pyproject.toml"))) return "black"
  if (fs.existsSync(path.join(cwd, "go.mod"))) return "gofmt"
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return "rustfmt"
  return null
}

function detectLinter(cwd: string): string | null {
  if (fs.existsSync(path.join(cwd, "biome.json")) || fs.existsSync(path.join(cwd, "biome.jsonc"))) return "biome"
  try {
    if (fs.readdirSync(cwd).some((f: string) => f.startsWith("eslint.config."))) return "eslint"
  } catch {}
  if (fs.existsSync(path.join(cwd, "go.mod"))) return "golangci-lint"
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return "clippy"
  return null
}

const editedFiles = new Set<string>()

const runTestsTool = tool({
  description:
    "Run the test suite with optional coverage, watch mode, or specific test patterns. Automatically detects package manager (npm, pnpm, yarn, bun) and test framework.",
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
      files: Array.from(editedFiles),
      count: editedFiles.size,
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
      result.branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf8", timeout: 3000 }).trim()
    } catch {
      result.branch = "(not a git repo)"
    }

    try {
      result.status = execSync("git status --short", { cwd, encoding: "utf8", timeout: 3000 }).trim()
    } catch {
      result.status = ""
    }

    try {
      const log = execSync("git log --oneline -5", { cwd, encoding: "utf8", timeout: 3000 }).trim()
      result.recentCommits = log
    } catch {
      result.recentCommits = ""
    }

    try {
      const staged = execSync("git diff --cached --name-only", { cwd, encoding: "utf8", timeout: 3000 }).trim()
      result.stagedFiles = staged
    } catch {
      result.stagedFiles = ""
    }

    try {
      const unstaged = execSync("git diff --name-only", { cwd, encoding: "utf8", timeout: 3000 }).trim()
      result.unstagedFiles = unstaged
    } catch {
      result.unstagedFiles = ""
    }

    return JSON.stringify(result, null, 2)
  },
})

const formatCodeTool = tool({
  description:
    "Detect the code formatter (Biome, Prettier, Black, gofmt, rustfmt) and return the exact command to format the project.",
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

const lintCheckTool = tool({
  description:
    "Detect the linter (ESLint, Biome, Ruff, Pylint, golangci-lint, Clippy) and build the run command.",
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

    report.push("## Phase 2: Secret Scanning")
    report.push("Run the following to scan for hardcoded secrets:")
    commands.push('grep -rn "api[_-]\\?key\\|sk-[A-Za-z0-9]\\|ghp_\\|gho_\\|ghu_\\|xox[abp]\\|AKIA[0-9A-Z]\\|-----BEGIN RSA PRIVATE KEY-----" --include="*.{ts,js,py,rs,go,java}" --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null | grep -v "node_modules" | head -30')
    report.push("")

    report.push("## Phase 3: Anti-Pattern Detection")
    report.push("Run the following to detect dangerous patterns:")
    commands.push('grep -rn "eval(\\|innerHTML\\|dangerouslySetInnerHTML\\|execSync\\|child_process\\|fromCharCode\\|document.write\\|new Function(" --include="*.{ts,tsx,js,jsx}" --exclude-dir=node_modules . 2>/dev/null | head -20')
    commands.push('grep -rn "\${.*\\(req\\.query\\|req\\.body\\|req\\.params\\)" --include="*.{ts,js}" --exclude-dir=node_modules . 2>/dev/null | head -10')
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

  const agents = [
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
  ]
  const commands = [
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
  ]

  return {
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
            if ((agent as any).permission) {
              agentConfig.permission = (agent as any).permission
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
      const cleanSoul = soulContent.replace(/^---[\s\S]*?---\n/, "")

      const systemBootstrap = `<EXTREMELY_IMPORTANT>
You have a soul — the principles below are always active. They are ALREADY LOADED.

${cleanSoul}
</EXTREMELY_IMPORTANT>

${DELEGATOR_ROLE}

${QUICK_ROUTING}

${COMPLETION_CONTRACT}

${buildProjectProfileSection(_projectProfile)}`

      const systemMessages: any[] = (output as any).systemMessages || []
      if (!systemMessages.some((p: any) => p.text?.includes("EXTREMELY_IMPORTANT"))) {
        systemMessages.unshift({ type: "text", text: systemBootstrap })
        ;(output as any).systemMessages = systemMessages
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages?.length) return
      const firstUser = output.messages.find((m: any) => m.info?.role === "user")
      if (!firstUser || !firstUser.parts?.length) return
      if (firstUser.parts.some((p: any) => p.type === "text" && p.text?.includes("EXTREMELY_IMPORTANT"))) return

      if (!_skillRegistryCache) {
        _skillRegistryCache = buildSkillRegistry(skillsDir)
      }
      const firstTextPart: any = firstUser.parts.find((p: any) => p.type === "text")
      const firstUserText = firstTextPart?.text || ""
      if (firstUserText.length >= 2000) return

      const taskAnalysis = analyzeTaskFn(firstUserText.slice(0, 500))
      if (taskAnalysis.category === "general") return

      const skillEntries = Object.entries(_skillRegistryCache)
      const matchResults = skillEntries.map(([name, trigger]) => {
        const tokens = firstUserText.toLowerCase().split(/[\s,;:.!?()]+/).filter((w: string) => w.length > 1)
        const lowerKeywords = trigger.keywords.map(k => k.toLowerCase())
        const matches = tokens.filter((t: string) => lowerKeywords.includes(t)).length
        const confidence = trigger.keywords.length > 0 ? matches / Math.max(trigger.keywords.length, 1) : 0
        return { name, confidence, trigger }
      })
      matchResults.sort((a: any, b: any) => b.confidence - a.confidence)
      const topSkill = matchResults[0]
      if (!topSkill || topSkill.confidence < 0.7) return

      const skillPath = path.join(skillsDir, topSkill.name, "SKILL.md")
      const skillContent = readFileSafe(skillPath)
      const cleanContent = stripYamlFrontmatter(skillContent)
      if (!cleanContent) return

      const autoLoadedSkill = `\n### Auto-Loaded Skill: ${topSkill.name}\n(injected based on task analysis)\n${cleanContent.slice(0, 3000)}\n`

      firstUser.parts.unshift({
        type: "text",
        text: autoLoadedSkill,
        id: firstUser.parts[0].id,
        sessionID: (firstUser.parts[0] as any).sessionID,
        messageID: (firstUser.parts[0] as any).messageID,
      })
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
      if (editedFiles.size > 0) {
        output.context.push("## Recently Edited Files")
        for (const f of editedFiles) output.context.push(`- ${f}`)
        output.context.push("")
      }
    },

    "file.edited": async (event: { path: string }) => {
      editedFiles.add(event.path)

      if (event.path.match(/\.(ts|tsx|js|jsx)$/)) {
        try {
          const result = await $`grep -n "console\\.log" ${event.path} 2>/dev/null`.text()
          if (result.trim()) {
            const lines = result.trim().split("\n").length
            await client.app.log({
              body: {
                service: "openecc",
                level: "warn" as const,
                message: `console.log found in ${event.path} (${lines} occurrence${lines > 1 ? "s" : ""})`,
              },
            })
          }
        } catch {}
      }
    },

    "tool.execute.after": async (input: { tool: string; args?: Record<string, unknown> }, _output: unknown) => {
      const filePath = input.args?.filePath as string | undefined
      if ((input.tool === "edit" || input.tool === "write") && filePath) {
        editedFiles.add(filePath)
      }
    },

    "session.idle": async () => {
      _delegationDepth = 0

      if (_ignoredRecommendations >= 3) {
        _ignoredRecommendations = 0
      }

      if (editedFiles.size === 0) return

      let count = 0
      const files: string[] = []
      for (const file of editedFiles) {
        if (!file.match(/\.(ts|tsx|js|jsx)$/)) continue
        try {
          const result = await $`grep -c "console\\.log" ${file} 2>/dev/null`.text()
          const n = parseInt(result.trim(), 10)
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

      editedFiles.clear()
    },

    "session.deleted": async () => {
      editedFiles.clear()
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
      "run-tests": runTestsTool,
      "changed-files": changedFilesTool,
      "git-summary": gitSummaryTool,
      "format-code": formatCodeTool,
      "lint-check": lintCheckTool,
      "security-audit": securityAuditTool,
      "auto-delegate": autoDelegateTool,
      "analyze-task": analyzeTaskTool,
    },
  }
}

export default OpenECCPlugin
