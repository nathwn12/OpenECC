import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import { fileURLToPath } from "node:url"

// ── Bundled Paths (resolve from package root, works in both source + bundle) ──

function findPluginRoot(fromDir: string): string {
  for (let i = 0; i < 5; i++) {
    const pj = path.join(fromDir, "package.json")
    if (fs.existsSync(pj)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pj, "utf8"))
        if (pkg.name === "openecc") return fromDir
      } catch {}
    }
    const parent = path.resolve(fromDir, "..")
    if (parent === fromDir) break
    fromDir = parent
  }
  return path.resolve(fromDir, "..", "..")
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = findPluginRoot(__dirname)
const BUNDLED_AGENTS_DIR = path.join(pluginRoot, ".opencode", "prompts", "agents")
const BUNDLED_COMMANDS_DIR = path.join(pluginRoot, ".opencode", "commands")
const BUNDLED_SKILLS_DIR = path.join(pluginRoot, ".opencode", "skills")

// ── Interfaces ───────────────────────────────────────────────

export interface AgentDiscovery {
  name: string
  desc: string
  prompt: string
  permission?: Record<string, string>
  source: "openecc" | "global" | "workspace"
}

export interface CommandDiscovery {
  name: string
  desc: string
  template: string
  agent?: string
  subtask?: boolean
  source: "openecc" | "global" | "workspace"
}

// ── Helpers ──────────────────────────────────────────────────

function readFileSafe(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf8") } catch { return "" }
}

function stripYamlFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n/, "")
}

function parseCommandFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result: Record<string, unknown> = {}
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/)
    if (kv) {
      let value: unknown = kv[2].trim()
      if (value === "true") value = true
      else if (value === "false") value = false
      else if ((value as string).startsWith('"') && (value as string).endsWith('"')) value = (value as string).slice(1, -1)
      result[kv[1]] = value
    }
  }
  return result
}

function inferAgentDesc(name: string, prompt: string): string {
  const firstLine = prompt.split("\n")[0]?.trim() || ""
  if (firstLine) {
    return firstLine.replace(/^You are an?\s+/i, "").replace(/\.$/, "")
  }
  return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function inferAgentPermission(name: string): Record<string, string> | undefined {
  if (name === "search-agent" || name === "docs-lookup") {
    return { edit: "deny", write: "deny", bash: "deny", task: "deny" }
  }
  if (name === "code-reviewer" || name === "planner" || name === "architect" ||
      (name.startsWith("plan-") && name.endsWith("-reviewer"))) {
    return { edit: "deny", write: "deny", task: "deny" }
  }
  return undefined
}

function homeDir(): string {
  return process.env.USERPROFILE || os.homedir()
}

// ── Scan Functions (single directory) ────────────────────────

function scanAgentDir(dir: string, source: AgentDiscovery["source"]): AgentDiscovery[] {
  const results: AgentDiscovery[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".txt")) continue
      const name = entry.name.slice(0, -4)
      const prompt = readFileSafe(path.join(dir, entry.name))
      if (!prompt) continue
      results.push({ name, desc: inferAgentDesc(name, prompt), prompt, permission: inferAgentPermission(name), source })
    }
  } catch { /* dir missing — skip */ }
  return results
}

function scanCommandDir(dir: string, source: CommandDiscovery["source"]): CommandDiscovery[] {
  const results: CommandDiscovery[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const name = entry.name.slice(0, -3)
      const content = readFileSafe(path.join(dir, entry.name))
      if (!content) continue
      const fm = parseCommandFrontmatter(content)
      const template = stripYamlFrontmatter(content)
      if (!template) continue
      results.push({
        name,
        desc: (fm.description as string) || name.replace(/-/g, " "),
        template,
        agent: fm.agent as string | undefined,
        subtask: fm.subtask as boolean | undefined,
        source,
      })
    }
  } catch { /* dir missing — skip */ }
  return results
}

function scanSkillDir(dir: string): string[] {
  const results: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (fs.existsSync(path.join(dir, entry.name, "SKILL.md"))) {
        results.push(path.join(dir, entry.name))
      }
    }
  } catch { /* dir missing — skip */ }
  return results
}

// ── Priority Merge ───────────────────────────────────────────

function mergeByName<T extends { name: string }>(priorityGroups: T[][]): T[] {
  const seen = new Map<string, T>()
  for (const group of priorityGroups) {
    for (const item of group) {
      if (!seen.has(item.name)) {
        seen.set(item.name, item)
      }
    }
  }
  return [...seen.values()]
}

// ── Source Resolvers ─────────────────────────────────────────

function globalDir(sub: string): string {
  return path.join(homeDir(), ".config", "opencode", sub)
}

function workspaceDir(worktree: string, sub: string): string {
  return path.join(worktree, ".opencode", sub)
}

// ── Caches ───────────────────────────────────────────────────

let cachedAgents: AgentDiscovery[] | null = null
let cachedCommands: CommandDiscovery[] | null = null
let cachedSkills: string[] | null = null

export function clearDiscoveryCache(): void {
  cachedAgents = null
  cachedCommands = null
  cachedSkills = null
}

// ── Public API ───────────────────────────────────────────────

export function discoverAgents(worktreePath: string): AgentDiscovery[] {
  if (cachedAgents) return cachedAgents
  cachedAgents = mergeByName([
    scanAgentDir(BUNDLED_AGENTS_DIR, "openecc"),
    scanAgentDir(globalDir(path.join("prompts", "agents")), "global"),
    scanAgentDir(workspaceDir(worktreePath, path.join("prompts", "agents")), "workspace"),
  ])
  return cachedAgents
}

export function discoverCommands(worktreePath: string): CommandDiscovery[] {
  if (cachedCommands) return cachedCommands
  cachedCommands = mergeByName([
    scanCommandDir(BUNDLED_COMMANDS_DIR, "openecc"),
    scanCommandDir(globalDir("commands"), "global"),
    scanCommandDir(workspaceDir(worktreePath, "commands"), "workspace"),
  ])
  return cachedCommands
}

export function discoverSkills(worktreePath: string): string[] {
  if (cachedSkills) return cachedSkills
  const bundled = scanSkillDir(BUNDLED_SKILLS_DIR)
  const global = scanSkillDir(globalDir("skills"))
  const workspace = scanSkillDir(workspaceDir(worktreePath, "skills"))
  const seen = new Set<string>()
  const results: string[] = []
  for (const dir of [...bundled, ...global, ...workspace]) {
    if (!seen.has(dir)) {
      seen.add(dir)
      results.push(dir)
    }
  }
  cachedSkills = results
  return cachedSkills
}
