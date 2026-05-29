import * as fs from "node:fs"
import * as path from "node:path"
import { type ProjectProfile } from "./routing/detect"

export function buildProjectProfileSection(p: ProjectProfile): string {
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

export function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return ""
  }
}

export function resolveProjectFile(worktreePath: string, relativePath: string): boolean {
  try {
    return fs.statSync(path.join(worktreePath, relativePath)).isFile()
  } catch {
    return false
  }
}

export function stripYamlFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n/, "")
}

export function detectPackageManager(cwd: string): string {
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

export function detectFormatter(cwd: string): string | null {
  if (fs.existsSync(path.join(cwd, "biome.json")) || fs.existsSync(path.join(cwd, "biome.jsonc"))) return "biome"
  if (fs.existsSync(path.join(cwd, ".prettierrc")) || fs.existsSync(path.join(cwd, ".prettierrc.json")) || fs.existsSync(path.join(cwd, "prettier.config.js")) || fs.existsSync(path.join(cwd, ".prettierrc.yaml"))) return "prettier"
  if (fs.existsSync(path.join(cwd, "pyproject.toml"))) return "black"
  if (fs.existsSync(path.join(cwd, "go.mod"))) return "gofmt"
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return "rustfmt"
  return null
}

export function detectLinter(cwd: string): string | null {
  if (fs.existsSync(path.join(cwd, "biome.json")) || fs.existsSync(path.join(cwd, "biome.jsonc"))) return "biome"
  try {
    if (fs.readdirSync(cwd).some((f: string) => f.startsWith("eslint.config."))) return "eslint"
  } catch {}
  if (fs.existsSync(path.join(cwd, "go.mod"))) return "golangci-lint"
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return "clippy"
  return null
}
