import type { PlanData, PlanTask, TaskStatus } from "./plan-policy"

function yamlStr(s: string): string {
  if (/[:{}[\]&*!|>'"%@`]/.test(s) || s.includes("\n") || s.includes("#")) {
    const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    return `"${escaped}"`
  }
  return s
}

export function serializePlanYaml(plan: PlanData): string {
  const lines: string[] = []
  lines.push(`schema: ${plan.schema}`)
  lines.push(`id: ${plan.id}`)
  lines.push(`version: ${plan.version}`)
  lines.push(`createdAt: "${plan.createdAt}"`)
  lines.push(`updatedAt: "${plan.updatedAt}"`)
  lines.push(`status: ${plan.status}`)
  lines.push(`parent: ${plan.parent || "null"}`)
  lines.push(`goal: ${yamlStr(plan.goal)}`)
  lines.push(`check: ${yamlStr(plan.check)}`)
  lines.push(`summary: ${yamlStr(plan.summary)}`)
  lines.push("tasks:")
  for (const t of plan.tasks) {
    lines.push(`  - id: ${t.id}`)
    lines.push(`    summary: ${yamlStr(t.summary)}`)
    lines.push(`    status: ${t.status}`)
    lines.push("    files:")
    for (const f of t.files) lines.push(`      - ${yamlStr(f)}`)
    lines.push("    depends_on:")
    for (const d of t.depends_on) lines.push(`      - ${d}`)
    if (t.effort) lines.push(`    effort: ${t.effort}`)
    if (t.verification) lines.push(`    verification: ${yamlStr(t.verification)}`)
  }
  lines.push("plan_notes:")
  for (const n of plan.plan_notes) lines.push(`  - ${yamlStr(n)}`)
  if (plan.plannerMode) lines.push(`plannerMode: ${plan.plannerMode}`)
  if (plan.plannerSource) lines.push(`plannerSource: ${plan.plannerSource}`)
  return lines.join("\n") + "\n"
}

export function parsePlanYaml(raw: string): PlanData | null {
  try {
    const plan: Partial<PlanData> & Record<string, unknown> = {
      schema: "",
      id: "",
      version: 1,
      createdAt: "",
      updatedAt: "",
      status: "draft",
      parent: null,
      goal: "",
      check: "",
      summary: "",
      tasks: [],
      plan_notes: [],
    }

    const lines = raw.split("\n")
    let i = 0
    function peek(): string { return lines[i] || "" }
    function consume(): string { return lines[i++] || "" }
    function unquote(s: string): string {
      s = s.trim()
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1)
      }
      return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    }

    while (i < lines.length) {
      const line = peek()
      if (!line.trim() || line.trim().startsWith("#")) { consume(); continue }

      if (line.trim() === "tasks:") { consume(); break }

      const m = line.match(/^(\w+):\s*(.*)$/)
      if (m) {
        const [, key, val] = m
        if (key === "parent") {
          plan.parent = val.trim() === "null" ? null : val.trim()
        } else if (key === "version") {
          plan.version = parseInt(val.trim(), 10) || 1
        } else if (key === "tasks") {
          break
        } else {
          plan[key] = unquote(val)
        }
      }
      consume()
    }

    const tasks: PlanTask[] = []
    let currentTask: Partial<PlanTask> | null = null
    let inFiles = false
    let inDepends = false

    while (i < lines.length) {
      const line = consume()
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue

      if (trimmed.startsWith("- id:")) {
        if (currentTask && currentTask.id) tasks.push(currentTask as PlanTask)
        currentTask = { id: "", summary: "", status: "pending", files: [], depends_on: [] }
        currentTask.id = trimmed.replace("- id:", "").trim()
        inFiles = false
        inDepends = false
        continue
      }

      if (!currentTask) continue

      if (trimmed.startsWith("summary:")) {
        currentTask.summary = unquote(trimmed.slice("summary:".length))
        inFiles = false; inDepends = false; continue
      }
      if (trimmed.startsWith("status:")) {
        currentTask.status = trimmed.slice("status:".length).trim() as TaskStatus
        inFiles = false; inDepends = false; continue
      }
      if (trimmed === "files:") { inFiles = true; inDepends = false; continue }
      if (trimmed === "depends_on:") { inDepends = true; inFiles = false; continue }
      if (trimmed.startsWith("effort:")) {
        currentTask.effort = trimmed.slice("effort:".length).trim()
        inFiles = false; inDepends = false; continue
      }
      if (trimmed.startsWith("verification:")) {
        currentTask.verification = unquote(trimmed.slice("verification:".length))
        inFiles = false; inDepends = false; continue
      }

      if (inFiles && trimmed.startsWith("- ")) {
        currentTask.files = currentTask.files || []
        currentTask.files.push(unquote(trimmed.slice(2)))
      }
      if (inDepends && trimmed.startsWith("- ")) {
        currentTask.depends_on = currentTask.depends_on || []
        currentTask.depends_on.push(trimmed.slice(2).trim())
      }

      const tm = trimmed.match(/^(\w+):/)
      if (tm && !["summary", "status", "files", "depends_on", "effort", "verification", "id"].includes(tm[1])) {
        plan[tm[1]] = unquote(trimmed.slice(tm[1].length + 1))
      }
    }

    if (currentTask && currentTask.id) tasks.push(currentTask as PlanTask)
    plan.tasks = tasks

    const notes: string[] = []
    const notesSection = raw.split("\nplan_notes:\n")[1]
    if (notesSection) {
      for (const nl of notesSection.split("\n")) {
        const nm = nl.match(/^\s*-\s+(.*)$/)
        if (nm) notes.push(unquote(nm[1]))
      }
    }
    plan.plan_notes = notes

    return plan as PlanData
  } catch {
    return null
  }
}
