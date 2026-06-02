import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import {
  type ModelRoutingConfig,
  DEFAULT_MODEL,
  generateDefaultConfig,
  populateAgentList,
  applyModelRouting as applyModelRoutingPolicy,
} from "./model-routing-policy"

export function getConfigPath(): string {
  const home = process.env.USERPROFILE || os.homedir()
  return path.join(home, ".config", "opencode", "openecc.json")
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
        if (parsed.enabled === undefined) parsed.enabled = false
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
  applyModelRoutingPolicy(config, routing || loadModelRoutingConfig())
}

export { DEFAULT_MODEL, generateDefaultConfig, populateAgentList }
