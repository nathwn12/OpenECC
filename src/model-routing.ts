import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

export interface ModelRoutingConfig {
  enabled: boolean
  default_model: string
  agents: Record<string, string>
}

const DEFAULT_MODEL = "opencode-go/deepseek-v4-flash"
const REASONING_MODEL = "opencode-go/deepseek-v4-pro"

const DEFAULT_REASONING_AGENTS = [
  "planner",
  "architect",
  "code-reviewer",
  "security-reviewer",
  "tdd-guide",
  "build-error-resolver",
  "database-reviewer",
  "doc-updater",
  "e2e-runner",
  "refactor-cleaner",
  "plan-ceo-reviewer",
  "plan-design-reviewer",
  "plan-eng-reviewer",
  "plan-devex-reviewer",
  "harness-optimizer",
]

export function getConfigPath(): string {
  const home = process.env.USERPROFILE || os.homedir()
  return path.join(home, ".config", "opencode", "openecc.json")
}

export function generateDefaultConfig(): ModelRoutingConfig {
  const agents: Record<string, string> = {}
  for (const name of DEFAULT_REASONING_AGENTS) {
    agents[name] = REASONING_MODEL
  }
  return {
    enabled: true,
    default_model: DEFAULT_MODEL,
    agents,
  }
}

export function writeConfig(configPath: string, config: ModelRoutingConfig): void {
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8")
}

export function loadModelRoutingConfig(): ModelRoutingConfig {
  const configPath = getConfigPath()
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf8").trim()
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ModelRoutingConfig>
        if (parsed.enabled === undefined) parsed.enabled = true
        return parsed as ModelRoutingConfig
      }
    }
  } catch {
    // Invalid JSON — fall through to regenerate
  }
  // Auto-heal: generate default and write it
  const defaults = generateDefaultConfig()
  writeConfig(configPath, defaults)
  return defaults
}

export function applyModelRouting(config: any, routing?: ModelRoutingConfig): void {
  if (!routing) routing = loadModelRoutingConfig()
  if (!routing.enabled) return

  const defaultModel = routing.default_model || DEFAULT_MODEL
  const agentModels = routing.agents || {}

  for (const [name, agentConfig] of Object.entries(config.agent || {})) {
    const agent = agentConfig as Record<string, unknown>
    if (agent.model) continue
    agent.model = agentModels[name] || defaultModel
  }
}
