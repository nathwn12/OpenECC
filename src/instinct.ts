import * as fs from "node:fs"
import * as path from "node:path"

export interface Instinct {
  name: string
  description: string
  source: "git-history" | "session-learning" | "manual"
  repetitions: number
  status: "active" | "pending-review" | "deprecated"
  domain: string
  tags: string[]
}

const VALID_SOURCES = ["git-history", "session-learning", "manual"] as const
const VALID_STATUSES = ["active", "pending-review", "deprecated"] as const
const STATUS_DISPLAY = [["active", "Active"], ["pending-review", "Pending Review"], ["deprecated", "Deprecated"]] as const
const KNOWN_KEYS = new Set(["name", "description", "source", "repetitions", "status", "domain", "tags"])

function unquote(s: string): string {
  s = s.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

export function parseInstinctYaml(raw: string): Instinct | null {
  try {
    const result: Record<string, unknown> = {
      name: "", description: "", source: "manual", repetitions: 1,
      status: "active", domain: "general", tags: [] as string[],
    }
    const lines = raw.split("\n")
    let currentKey: string | null = null
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const kv = trimmed.match(/^(\w[\w-]*):\s*(.*)$/)
      if (kv) {
        currentKey = kv[1]
        const val = kv[2].trim()
        if (currentKey === "repetitions") {
          const n = parseInt(val, 10)
          if (!isNaN(n) && n >= 0) result.repetitions = n
        } else if (currentKey === "tags") {
          result.tags = [] as string[]
        } else if (currentKey === "source") {
          if (isValidSource(val)) result.source = val
        } else if (currentKey === "status") {
          if (isValidStatus(val)) result.status = val
        } else if (KNOWN_KEYS.has(currentKey)) {
          result[currentKey] = unquote(val)
        }
      } else if (currentKey === "tags" && trimmed.startsWith("- ")) {
        const tags = result.tags as string[]
        tags.push(trimmed.slice(2))
      }
    }
    if (!result.name) return null
    return {
      name: result.name as string,
      description: result.description as string,
      source: result.source as Instinct["source"],
      repetitions: result.repetitions as number,
      status: result.status as Instinct["status"],
      domain: result.domain as string,
      tags: result.tags as string[],
    }
  } catch {
    return null
  }
}

function isValidSource(val: string): val is Instinct["source"] {
  return (VALID_SOURCES as readonly string[]).includes(val)
}

function isValidStatus(val: string): val is Instinct["status"] {
  return (VALID_STATUSES as readonly string[]).includes(val)
}

export function readInstincts(worktreePath: string): Instinct[] {
  const dir = path.join(worktreePath, ".opencode", "instincts")
  try {
    if (!fs.existsSync(dir)) return []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const results: Instinct[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue
      const raw = readFileSafe(path.join(dir, entry.name))
      if (!raw) continue
      const instinct = parseInstinctYaml(raw)
      if (instinct) results.push(instinct)
    }
    return results
  } catch {
    return []
  }
}

function readFileSafe(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf8") } catch { return "" }
}

export function instinctConfidence(repetitions: number): number {
  const base = Math.min(Math.round((repetitions / 10) * 100), 100)
  const bonus =
    repetitions >= 5 ? 0 :
    repetitions >= 3 ? 20 :
    repetitions >= 1 ? 10 : 0
  return Math.min(base + bonus, 100)
}

export function buildInstinctStatusTable(instincts: Instinct[]): string {
  if (instincts.length === 0) return "No instincts found in `.opencode/instincts/`."

  const lines: string[] = ["## Instinct Status\n"]
  const grouped: Record<string, Instinct[]> = Object.fromEntries(STATUS_DISPLAY.map(([k]) => [k, [] as Instinct[]]))
  const domainCount: Record<string, number> = {}

  for (const inst of instincts) {
    const key = inst.status || "active"
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(inst)
    domainCount[inst.domain] = (domainCount[inst.domain] || 0) + 1
  }

  for (const [statusLabel, label] of STATUS_DISPLAY) {
    const items = grouped[statusLabel] || []
    if (items.length === 0) continue
    lines.push(`### ${label} (${items.length})`)
    for (const inst of items) {
      const capped = instinctConfidence(inst.repetitions)
      lines.push(
        `- **${inst.name}** — ${inst.description}`,
        `  Source: ${inst.source} | Confidence: ${capped}% (${inst.repetitions} rep${inst.repetitions === 1 ? "" : "s"}) | Status: ${inst.status}`,
      )
    }
    lines.push("")
  }

  lines.push("**Summary by Domain:**")
  const sorted = Object.entries(domainCount).sort((a, b) => b[1] - a[1])
  for (const [domain, count] of sorted) {
    lines.push(`- ${domain}: ${count} instinct${count === 1 ? "" : "s"}`)
  }
  lines.push(`- **Total: ${instincts.length}**`)

  return lines.join("\n")
}
