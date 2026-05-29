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
