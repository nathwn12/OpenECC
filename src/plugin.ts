import { type Plugin } from "@opencode-ai/plugin"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { discoverAgents, discoverCommands, discoverSkills } from "./discovery"
import { buildExecutionContextBlock, createExecutionContext } from "./execution"
import { getPackageInfo } from "./identity"
import {
  applyModelRouting,
  loadModelRoutingConfig,
  getConfigPath,
  writeConfig,
  populateAgentList,
} from "./model-routing"
import { buildPlanGateBlock, getActivePlan, migrateOpeneccState, buildToolAccessBlock } from "./plan-gate"
import { applyFirstUserPlanGate } from "./plugin-routing"
import { handleCommandExecuteBefore } from "./plugin-commands"
import {
  buildCompactionContext,
  buildSystemBootstrap,
  detectProject,
  readFileSafe,
  stripYamlFrontmatter,
  type ProjectProfile,
} from "./plugin-support"
import {
  memory_recall, memory_status,
  onSessionCreated, onSessionDeleted, onFileEdited, onToolExecuted,
  buildMemoryContinuityBlock,
} from "./memory"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const agentsMDPath = path.resolve(__dirname, "..", "..", "AGENTS.md")

export const OpenECCPlugin: Plugin = async ({ client, directory, worktree }) => {
  const worktreePath = worktree || directory
  let projectProfile: ProjectProfile | null = null
  const executionContext = createExecutionContext()
  const editedFiles = new Set<string>()

  return {
    "tool.definition": async (input, output) => {
      if (input.toolID === "edit" || input.toolID === "write") {
        output.description = `[OPENECC ENFORCEMENT] This tool MUST be called inside a subagent, not in main context. Delegate via \`task\` tool. Rule: no direct work in main context. | ${output.description}`
      }
      if (input.toolID === "glob" || input.toolID === "grep") {
        output.description = `[OPENECC ENFORCEMENT] Source code search must be delegated to a subagent. | ${output.description}`
      }
      if (input.toolID === "bash") {
        output.description = `[OPENECC ENFORCEMENT] All commands must run inside a subagent. | ${output.description}`
      }
    },

    tool: {
      memory_recall,
      memory_status,
    },

    "command.execute.before": async (input: { command: string; arguments: string }, output: { parts: any[] }) => {
      handleCommandExecuteBefore({ worktreePath, command: input.command, arguments: input.arguments }, output)
    },

    config: async (config: any) => {
      config.skills = config.skills || {}
      config.skills.paths = config.skills.paths || []
      for (const skillDir of discoverSkills(worktreePath)) {
        if (!config.skills.paths.includes(skillDir)) config.skills.paths.push(skillDir)
      }

      config.instructions = config.instructions || []
      if (!config.instructions.some((i: string) => i === agentsMDPath)) config.instructions.push(agentsMDPath)

      config.agent = config.agent || {}
      for (const agent of discoverAgents(worktreePath)) {
        if (!config.agent[agent.name]) {
          const agentConfig: Record<string, unknown> = { description: agent.desc, mode: "subagent", prompt: agent.prompt }
          if (agent.permission) agentConfig.permission = agent.permission
          config.agent[agent.name] = agentConfig
        }
      }

      const routing = loadModelRoutingConfig()
      const populated = populateAgentList(routing, Object.keys(config.agent))
      writeConfig(getConfigPath(), populated)
      applyModelRouting(config, populated)

      config.command = config.command || {}
      for (const cmd of discoverCommands(worktreePath)) {
        if (!config.command[cmd.name]) {
          config.command[cmd.name] = {
            description: cmd.desc,
            template: `${cmd.template}\n\n$ARGUMENTS`,
            ...(cmd.agent ? { agent: cmd.agent } : {}),
            ...(cmd.subtask ? { subtask: true } : {}),
          }
        }
      }
    },

    "experimental.chat.system.transform": async (_input, output: any) => {
      if (!projectProfile) projectProfile = detectProject(worktreePath)

      const pkg = getPackageInfo()
      const soulPath = path.join(pkg.skillsDir, "soul", "SKILL.md")
      const cleanSoul = stripYamlFrontmatter(readFileSafe(soulPath))

      const systemMessages = output.systemMessages || []
      if (!systemMessages.some((p: any) => p.text?.includes("EXTREMELY_IMPORTANT"))) {
        const fullBootstrap = buildSystemBootstrap({
          pkg,
          soulContent: cleanSoul,
          projectProfile,
          executionBlock: buildExecutionContextBlock(executionContext),
          toolAccessBlock: buildToolAccessBlock(),
        })
        systemMessages.unshift({ type: "text", text: fullBootstrap })
        output.systemMessages = systemMessages
      }

      try {
        const activeEntry = getActivePlan(worktreePath)
        if (activeEntry) {
          const planBlock = `<structured type="plan_state">\nactive_plan: ${activeEntry.id}\nstatus: ${activeEntry.status}\ncompleted: ${activeEntry.completed}\ntotal: ${activeEntry.total}\ngoal: ${activeEntry.summary}\n</structured>`
          if (!systemMessages.some((p: any) => p.text?.includes("plan_state"))) {
            systemMessages.push({ type: "text", text: planBlock })
          }
          const gateBlock = buildPlanGateBlock(activeEntry)
          if (!systemMessages.some((p: any) => p.text?.includes("plan_gate"))) {
            systemMessages.push({ type: "text", text: gateBlock })
          }
        }
      } catch {}
    },

    "experimental.chat.messages.transform": async (_input, output: any) => {
      applyFirstUserPlanGate({ worktreePath, messages: output.messages, executionContext })
    },

    "experimental.session.compacting": async (_input, output: any) => {
      const pkg = getPackageInfo()
      for (const line of buildCompactionContext({ pkg, projectProfile, editedFiles })) {
        output.context.push(line)
      }

      // Inject memory continuity block (persistent across compaction)
      try {
        const memBlock = buildMemoryContinuityBlock()
        if (memBlock) output.context.push(memBlock)
      } catch {}
    },

    "file.edited": async (event: { path: string }) => {
      editedFiles.add(event.path)
      try { onFileEdited(event.path) } catch {}
    },

    "tool.execute.after": async (input: { tool: string; args?: Record<string, unknown> }, _output: unknown) => {
      const filePath = input.args?.filePath as string | undefined
      if ((input.tool === "edit" || input.tool === "write") && filePath) {
        editedFiles.add(filePath)
        try { onToolExecuted(input.tool, input.args) } catch {}
      }
    },

    "session.created": async (event: any) => {
      const pkg = getPackageInfo()
      const sessionId: string = event?.sessionID ?? event?.id ?? ""
      await client.app.log({ body: { service: "openecc", level: "info" as const, message: `Session started — OpenECC v${pkg.version} active` } })
      try { migrateOpeneccState(worktreePath) } catch {}
      // Init memory store, log session start, run lightweight maintenance
      try { onSessionCreated(sessionId) } catch {}
    },

    "session.deleted": async () => {
      editedFiles.clear()
      try { onSessionDeleted() } catch {}
    },
  }
}

export default OpenECCPlugin
