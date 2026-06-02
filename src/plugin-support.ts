import * as fs from "node:fs"
import * as path from "node:path"

export interface ProjectProfile {
  projectName: string
  languages: string[]
  packageManager: string
}

export interface PackageInfoLike {
  version: string
  root: string
  skillsDir: string
}

export function readFileSafe(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf8") } catch { return "" }
}

export function stripYamlFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n/, "")
}

export function detectProject(cwd: string): ProjectProfile {
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
  for (const [lock, name] of Object.entries(lockfiles)) {
    if (fs.existsSync(path.join(cwd, lock))) {
      packageManager = name
      break
    }
  }

  return { projectName, languages, packageManager }
}

export function buildProjectProfileSection(profile: ProjectProfile): string {
  const lines: string[] = ["### Project Profile (auto-detected)"]
  if (profile.languages.length > 0) lines.push(`- Languages: ${profile.languages.join(", ")}`)
  lines.push(`- Package manager: ${profile.packageManager}`, "")
  return lines.join("\n")
}

export const DELEGATOR_ROLE = `## Your Role (OpenECC Delegator)
Your primary job is to delegate, synthesize, and verify — not to do work directly.

### When to delegate to a subagent (@mention):
- Planning / architecture → @planner, @architect
- Code review / quality → @code-reviewer
- Security review → @security-reviewer
- Build/type errors → @build-error-resolver
- Test-first development → @tdd-guide
- Database design → @database-reviewer
- E2E testing → @e2e-runner
- Documentation → @doc-updater, @docs-lookup
- Codebase/web search → @search-agent
- Loop operations → @loop-operator
- Code cleanup → @refactor-cleaner
- Plan reviews → @plan-ceo-reviewer, @plan-eng-reviewer, @plan-design-reviewer, @plan-devex-reviewer
- Harness optimization → @harness-optimizer

### When to answer directly:
- Simple factual questions, quick clarifications, status checks
- Anything that requires zero tools

### Completion protocol:
1. **Verify before claiming** — run the command, read the output, then speak
2. **Synthesize** — distill subagent results into 3-5 sentences max
3. Place \`---\` followed by **Status:** ✅ Done | 🚧 Blocked | 🔄 In Progress`

export const DELEGATION_ENFORCEMENT = `## OpenECC Delegation Enforcement (HARD RULES)
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

export const COMPLETION_CONTRACT = `### Before responding
1. Did you delegate analysis/planning work to a subagent when appropriate?
2. Did you verify results (not assume)?
3. Is the response concise and synthesized?
When done: place \`---\` followed by **Status:** ✅ Done | 🚧 Blocked | 🔄 In Progress`

export function buildIdentityBlock(pkg: PackageInfoLike, soulContent: string): string {
  return `<EXTREMELY_IMPORTANT>
I am OpenECC, your engineering workflow layer.

I know my version (\`${pkg.version}\`), my install path (\`${pkg.root}\`), and my job: route work to specialists, gate plans until approved, and never claim done without verification. I report to you directly with synthesized results. Everything else is delegated.

You have a soul — the principles below are always active. They are ALREADY LOADED.

${soulContent}
</EXTREMELY_IMPORTANT>`
}

export function buildRuntimeBlock(pkg: PackageInfoLike): string {
  return `<structured type="runtime">
type: runtime
openecc_version: ${pkg.version}
package_root: ${pkg.root}
skills_directory: ${pkg.skillsDir}
</structured>`
}

export function buildSystemBootstrap(input: {
  pkg: PackageInfoLike
  soulContent: string
  projectProfile: ProjectProfile
  executionBlock: string
  toolAccessBlock: string
}): string {
  return [
    buildIdentityBlock(input.pkg, input.soulContent),
    buildRuntimeBlock(input.pkg),
    input.executionBlock,
    DELEGATOR_ROLE,
    DELEGATION_ENFORCEMENT,
    input.toolAccessBlock,
    COMPLETION_CONTRACT,
    buildProjectProfileSection(input.projectProfile),
  ].join("\n\n")
}

export function buildCompactionContext(input: {
  pkg: PackageInfoLike
  projectProfile: ProjectProfile | null
  editedFiles: Iterable<string>
}): string[] {
  const out: string[] = []
  out.push("# OpenECC Context (preserve across compaction)")
  out.push("", `## OpenECC v${input.pkg.version}`)
  out.push(`- Package root: ${input.pkg.root}`)
  out.push("- Primary role: delegate to subagents, synthesize results, verify before claiming")
  out.push("- Soul: Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution")
  out.push("- Route by task type: planning, review, build-fix, TDD, docs, language-specific")
  out.push("- Answer directly when no tools are needed", "")

  if (input.projectProfile) {
    out.push("## Project Profile")
    out.push(`- Languages: ${input.projectProfile.languages.join(", ") || "none detected"}`)
    out.push(`- Package manager: ${input.projectProfile.packageManager}`, "")
  }

  const edited = [...input.editedFiles]
  if (edited.length > 0) {
    out.push("## Recently Edited Files")
    for (const f of edited) out.push(`- ${f}`)
    out.push("")
  }

  return out
}
