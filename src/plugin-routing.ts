import type { ExecutionContext } from "./execution"
import { incrementAttempt } from "./execution"
import { classifyIntent, classifyTaskScope, createBuiltinPlan, createPlan, getActivePlan, isValidProjectDir } from "./plan-gate"

export function applyFirstUserPlanGate(input: {
  worktreePath: string
  messages: any[]
  executionContext: ExecutionContext
}): void {
  if (!input.messages?.length) return
  const firstUser = input.messages.find((m: any) => m.info?.role === "user")
  if (!firstUser || !firstUser.parts?.length) return
  if (firstUser.parts.some((p: any) => p.type === "text" && typeof p.text === "string" && (p as any).text.includes("EXTREMELY_IMPORTANT"))) return

  const parts = firstUser.parts as Array<{ type: string; text?: string }>
  const userText = parts.filter(p => p.type === "text" && typeof p.text === "string").map(p => p.text as string).join(" ")
  if (!userText || userText.length >= 2000) return

  incrementAttempt(input.executionContext)

  try {
    const intent = classifyIntent(userText)
    if (!intent.isWork || !isValidProjectDir(input.worktreePath)) return

    const scope = classifyTaskScope(userText)
    if (scope === "trivial") return

    const existingPlan = getActivePlan(input.worktreePath)
    if (existingPlan && existingPlan.status !== "done" && existingPlan.status !== "abandoned" && existingPlan.status !== "blocked") return

    const result = scope === "complex"
      ? createPlan(input.worktreePath, { summary: userText, status: "draft" })
      : createBuiltinPlan(input.worktreePath, userText, "auto")

    if (result) {
      const firstText = parts.find(p => p.type === "text")
      if (firstText && typeof firstText.text === "string") {
        if (result.plan.status === "draft") {
          firstText.text = `<PLAN_GATE>\nPlan ${result.id} created in DRAFT for: "${result.summary}"\nTasks: ${result.plan.tasks.length}\nGate: BLOCKED — this plan needs approval before any implementation.\nApprove: /plan transition ${result.id} approved\n</PLAN_GATE>\n\n${firstText.text}`
        } else {
          firstText.text = `[plan:${result.id}] Auto-approved plan for: "${result.summary}". ${result.plan.tasks.length} tasks. Proceeding.\n\n${firstText.text}`
        }
      }
    }
  } catch {}
}
