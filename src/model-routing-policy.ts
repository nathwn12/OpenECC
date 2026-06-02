export interface ModelRoutingConfig {
  enabled: boolean
  global_default: string
  agents: Record<string, string>
}

export const DEFAULT_MODEL = "opencode-go/deepseek-v4-flash"

export function generateDefaultConfig(): ModelRoutingConfig {
  return {
    enabled: false,
    global_default: DEFAULT_MODEL,
    agents: {},
  }
}

export function populateAgentList(routing: ModelRoutingConfig, agentNames: string[]): ModelRoutingConfig {
  const agents = { ...routing.agents }
  for (const name of agentNames) {
    if (!(name in agents)) agents[name] = ""
  }
  return { ...routing, agents }
}

export function applyModelRouting(config: any, routing?: ModelRoutingConfig): void {
  if (!routing) routing = generateDefaultConfig()
  if (!routing.enabled) return

  const globalDefault = routing.global_default || DEFAULT_MODEL
  const agentModels = routing.agents || {}

  for (const [name, agentConfig] of Object.entries(config.agent || {})) {
    const agent = agentConfig as Record<string, unknown>
    if (agent.model) continue
    agent.model = agentModels[name] || globalDefault
  }
}
