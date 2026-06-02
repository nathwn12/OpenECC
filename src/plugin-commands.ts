import { type CommandDiscovery } from "./discovery"
import { buildInstinctStatusTable, readInstincts } from "./instinct"
import { createPlan, getActivePlan, updatePlanStatus } from "./plan-gate"
import { readPlanIndex } from "./plan-gate"

export function handleCommandExecuteBefore(input: {
  worktreePath: string
  command: string
  arguments: string
}, output: { parts: any[] }): boolean {
  if (input.command === "plan") {
    const planArgs = input.arguments?.trim() || ""
    const planParts = planArgs.split(/\s+/)
    const sub = planParts[0]?.toLowerCase()
    if (!sub) {
      output.parts = [{ type: "text", text: "Usage: /plan list | /plan status | /plan create <summary> | /plan transition <id> <status>", id: "", sessionID: "", messageID: "" }]
      return true
    }
    if (sub === "list") {
      const idx = readPlanIndex(input.worktreePath)
      if (!idx || idx.plans.length === 0) {
        output.parts = [{ type: "text", text: "No plans found.", id: "", sessionID: "", messageID: "" }]
        return true
      }
      const lines = ["## Plans"]
      for (const p of idx.plans) lines.push(`- ${p.id}: ${p.summary} (${p.status}, ${p.completed}/${p.total})`)
      output.parts = [{ type: "text", text: lines.join("\n"), id: "", sessionID: "", messageID: "" }]
      return true
    }
    if (sub === "status") {
      const active = getActivePlan(input.worktreePath)
      output.parts = [{ type: "text", text: active ? `Active plan ${active.id}: ${active.summary} (${active.status}, ${active.completed}/${active.total})` : "No active plan.", id: "", sessionID: "", messageID: "" }]
      return true
    }
    if (sub === "create") {
      const summary = planParts.slice(1).join(" ")
      if (!summary) {
        output.parts = [{ type: "text", text: "Usage: /plan create <summary>", id: "", sessionID: "", messageID: "" }]
        return true
      }
      const result = createPlan(input.worktreePath, { summary, status: "approved" })
      if (result) {
        output.parts = [{ type: "text", text: `Plan ${result.id} created and activated: \"${summary}\"`, id: "", sessionID: "", messageID: "" }]
      } else {
        output.parts = [{ type: "text", text: "Failed to create plan.", id: "", sessionID: "", messageID: "" }]
      }
      return true
    }
    if (sub === "transition") {
      const pid = planParts[1] || ""
      const newStatus = planParts[2]
      if (!pid || !newStatus) {
        output.parts = [{ type: "text", text: "Usage: /plan transition <id> <status>", id: "", sessionID: "", messageID: "" }]
        return true
      }
      const VALID_STATUSES: readonly string[] = ["draft", "approved", "in_progress", "done", "blocked", "abandoned"]
      if (!VALID_STATUSES.includes(newStatus)) {
        output.parts = [{ type: "text", text: `Invalid status: \"${newStatus}\". Valid: ${VALID_STATUSES.join(", ")}`, id: "", sessionID: "", messageID: "" }]
        return true
      }
      const err = updatePlanStatus(input.worktreePath, pid, newStatus)
      output.parts = [{ type: "text", text: err ? `Error: ${err}` : `Plan ${pid} transitioned to ${newStatus}.`, id: "", sessionID: "", messageID: "" }]
      return true
    }
    output.parts = [{ type: "text", text: `Unknown: ${sub}. Try: list, status, create, transition`, id: "", sessionID: "", messageID: "" }]
    return true
  }

  if (input.command === "instinct") {
    const instArgs = input.arguments?.trim() || ""
    const instParts = instArgs.split(/\s+/)
    const sub = instParts[0]?.toLowerCase()
    if (sub === "status" || !sub) {
      const instincts = readInstincts(input.worktreePath)
      output.parts = [{ type: "text", text: buildInstinctStatusTable(instincts), id: "", sessionID: "", messageID: "" }]
      return true
    }
    output.parts = [{ type: "text", text: `Unknown instinct subcommand: \"${sub}\". Try: status`, id: "", sessionID: "", messageID: "" }]
    return true
  }

  return false
}
