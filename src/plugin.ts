import { tool, type Plugin } from "@opencode-ai/plugin"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as fs from "node:fs"
import { execSync } from "node:child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const skillsDir = path.resolve(__dirname, "..", "skills")
const promptsDir = path.resolve(__dirname, "..", "prompts")
const agentsDir = path.resolve(__dirname, "..", "prompts", "agents")
const commandsDir = path.resolve(__dirname, "..", "commands")
const agentsMDPath = path.resolve(__dirname, "..", "..", "AGENTS.md")

let _soulCache: string | null = null

function getSoulContent(): string | null {
  if (_soulCache !== null) return _soulCache

  const soulPath = path.join(skillsDir, "soul", "SKILL.md")
  if (!fs.existsSync(soulPath)) {
    _soulCache = null
    return null
  }

  const fullContent = fs.readFileSync(soulPath, "utf8")
  const content = fullContent.replace(/^---[\s\S]*?---\n/, "")

  _soulCache = `<EXTREMELY_IMPORTANT>
You have a soul — the principles below are always active. They are ALREADY LOADED.

${content}
</EXTREMELY_IMPORTANT>`

  return _soulCache
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
const pendingToolChanges = new Map<string, { path: string; type: "added" | "modified" }>()

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

export const OpenECCPlugin: Plugin = async ({ client, directory, $, worktree }) => {
  const worktreePath = worktree || directory
  const soul = getSoulContent()

  const agents = [
    { name: "planner", desc: "Expert planning specialist. Use for implementation plans, architectural changes, or complex refactoring.", model: "claude-opus-4-5", tools: { read: true, bash: true, write: false, edit: false } },
    { name: "architect", desc: "Software architecture specialist for system design, scalability, and technical decision-making.", model: "claude-opus-4-5", tools: { read: true, bash: true, write: false, edit: false } },
    { name: "code-reviewer", desc: "Expert code review specialist. Reviews code for quality, security, and maintainability.", model: "claude-opus-4-5", tools: { read: true, bash: true, write: false, edit: false } },
    { name: "security-reviewer", desc: "Security vulnerability detection specialist. Reviews auth, input validation, secrets, API endpoints.", model: "claude-opus-4-5", tools: { read: true, bash: true, write: true, edit: true } },
    { name: "tdd-guide", desc: "Test-Driven Development specialist enforcing write-tests-first. Ensures 80%+ test coverage.", model: "claude-opus-4-5", tools: { read: true, write: true, edit: true, bash: true } },
    { name: "build-error-resolver", desc: "Build and TypeScript error resolution specialist. Fixes errors with minimal diffs.", model: "claude-opus-4-5", tools: { read: true, write: true, edit: true, bash: true } },
    { name: "e2e-runner", desc: "End-to-end testing specialist using Playwright. Generates, maintains, and runs E2E tests.", model: "claude-opus-4-5", tools: { read: true, write: true, edit: true, bash: true } },
    { name: "doc-updater", desc: "Documentation and codemap specialist. Keeps docs in sync with code.", model: "claude-opus-4-5", tools: { read: true, write: true, edit: true, bash: true } },
    { name: "refactor-cleaner", desc: "Dead code cleanup and consolidation specialist. Removes unused code, duplicates.", model: "claude-opus-4-5", tools: { read: true, write: true, edit: true, bash: true } },
    { name: "docs-lookup", desc: "Documentation specialist using MCP to fetch current library and API documentation.", model: "claude-sonnet-4-5", tools: { read: true, bash: true, write: false, edit: false } },
    { name: "harness-optimizer", desc: "Analyzes and improves agent harness configuration for reliability, cost, throughput.", model: "claude-sonnet-4-5", tools: { read: true, bash: true, edit: true } },
    { name: "loop-operator", desc: "Operates autonomous agent loops, monitors progress, intervenes safely.", model: "claude-sonnet-4-5", tools: { read: true, bash: true, edit: true } },
    { name: "go-reviewer", desc: "Go code reviewer specializing in idiomatic Go, concurrency patterns, error handling.", model: "claude-opus-4-5", tools: { read: true, bash: true, write: false, edit: false } },
    { name: "go-build-resolver", desc: "Go build and vet error resolution specialist. Fixes with minimal changes.", model: "claude-opus-4-5", tools: { read: true, write: true, edit: true, bash: true } },
    { name: "python-reviewer", desc: "Python code reviewer specializing in PEP 8, type hints, security, and performance.", model: "claude-opus-4-5", tools: { read: true, bash: true, write: false, edit: false } },
    { name: "rust-reviewer", desc: "Rust code reviewer specializing in ownership, lifetimes, concurrency, and safety.", model: "claude-opus-4-5", tools: { read: true, bash: true, write: false, edit: false } },
    { name: "rust-build-resolver", desc: "Rust build and Cargo error resolution specialist. Fixes with minimal changes.", model: "claude-opus-4-5", tools: { read: true, write: true, edit: true, bash: true } },
    { name: "cpp-reviewer", desc: "C++ code reviewer specializing in memory safety, modern C++, and performance.", model: "claude-opus-4-5", tools: { read: true, bash: true, write: false, edit: false } },
    { name: "cpp-build-resolver", desc: "C++ build and CMake error resolution specialist. Fixes linker, template errors.", model: "claude-opus-4-5", tools: { read: true, write: true, edit: true, bash: true } },
    { name: "java-reviewer", desc: "Java and Spring Boot reviewer specializing in layered architecture, JPA, security.", model: "claude-opus-4-5", tools: { read: true, bash: true, write: false, edit: false } },
    { name: "java-build-resolver", desc: "Java/Maven/Gradle build error resolution specialist. Fixes with minimal changes.", model: "claude-opus-4-5", tools: { read: true, write: true, edit: true, bash: true } },
    { name: "kotlin-reviewer", desc: "Kotlin and Android reviewer specializing in coroutines, Compose, idiomatic patterns.", model: "claude-opus-4-5", tools: { read: true, bash: true, write: false, edit: false } },
    { name: "kotlin-build-resolver", desc: "Kotlin/Gradle build error resolution specialist. Fixes with minimal changes.", model: "claude-opus-4-5", tools: { read: true, write: true, edit: true, bash: true } },
    { name: "database-reviewer", desc: "PostgreSQL database specialist for query optimization, schema design, security.", model: "claude-opus-4-5", tools: { read: true, write: true, edit: true, bash: true } },
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
    { name: "model-route", desc: "Configure model routing for agents" },
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
            config.agent[agent.name] = {
              description: agent.desc,
              mode: "subagent",
              model: agent.model,
              tools: agent.tools,
              prompt,
            }
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

    "experimental.chat.messages.transform": async (_input, output) => {
      if (!soul || !output.messages?.length) return
      const firstUser = output.messages.find((m: any) => m.info?.role === "user")
      if (!firstUser || !firstUser.parts?.length) return
      if (firstUser.parts.some((p: any) => p.type === "text" && p.text?.includes("EXTREMELY_IMPORTANT"))) return

      const ref = firstUser.parts[0]
      firstUser.parts.unshift({ ...ref, type: "text", text: soul })
    },

    "experimental.session.compacting": async () => {
      const contextBlocks = [
        "# OpenECC Context (preserve across compaction)",
        "",
        "## Active Soul",
        "- Think Before Coding: surface assumptions. Don't hide confusion.",
        "- Simplicity First: minimum code. Nothing speculative.",
        "- Surgical Changes: touch only what you must.",
        "- Goal-Driven Execution: define verifiable success criteria.",
        "",
      ]
      if (editedFiles.size > 0) {
        contextBlocks.push("## Recently Edited Files")
        for (const f of editedFiles) contextBlocks.push(`- ${f}`)
        contextBlocks.push("")
      }
      return {
        context: contextBlocks.join("\n"),
        compaction_prompt:
          "Preserve: 1) Current task status, 2) Key decisions, 3) Active files, 4) Remaining work, 5) Security concerns. Discard verbose tool outputs and redundant file listings.",
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

      if (input.tool === "edit" && filePath?.match(/\.tsx?$/)) {
        try {
          await $`npx tsc --noEmit 2>&1`
        } catch {
          await client.app.log({
            body: {
              service: "openecc",
              level: "warn" as const,
              message: "TypeScript errors detected after edit — run `npx tsc --noEmit` to see details",
            },
          })
        }
      }
    },

    "session.idle": async () => {
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
      pendingToolChanges.clear()
    },

    "shell.env": async () => {
      const env: Record<string, string> = {
        ECC_VERSION: "1.0.0",
        ECC_PLUGIN: "true",
        PROJECT_ROOT: worktreePath,
      }
      const pm = detectPackageManager(worktreePath)
      if (pm) env.PACKAGE_MANAGER = pm

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
        env.DETECTED_LANGUAGES = detected.join(",")
        env.PRIMARY_LANGUAGE = detected[0]
      }
      return env
    },

    tool: {
      "run-tests": runTestsTool,
      "changed-files": changedFilesTool,
      "git-summary": gitSummaryTool,
      "format-code": formatCodeTool,
      "lint-check": lintCheckTool,
      "security-audit": securityAuditTool,
    },
  }
}

export default OpenECCPlugin
