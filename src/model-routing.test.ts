import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { fileURLToPath } from "node:url"
import {
  generateDefaultConfig,
  getConfigPath,
  writeConfig,
  loadModelRoutingConfig,
  applyModelRouting,
  type ModelRoutingConfig,
} from "./model-routing"

const DEFAULT_MODEL = "opencode-go/deepseek-v4-flash"
const REASONING_MODEL = "opencode-go/deepseek-v4-pro"

const REASONING_AGENTS = [
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

const LIGHT_AGENTS = [
  "search-agent",
  "docs-lookup",
  "loop-operator",
]

const ALL_AGENTS = [...REASONING_AGENTS, ...LIGHT_AGENTS]

// ── Helpers ────────────────────────────────────────────────────────────────

let testDir: string

function tmpRootDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const base = path.join(currentDir, "..", ".openecc-test")
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true })
  return fs.mkdtempSync(path.join(base, "mr-test-"))
}

function setTestDir(): string {
  testDir = tmpRootDir()
  return path.join(testDir, "openecc.json")
}

describe("generateDefaultConfig", () => {
  it("returns enabled: true", () => {
    const cfg = generateDefaultConfig()
    expect(cfg.enabled).toBe(true)
  })

  it("uses deepseek-v4-flash as default model", () => {
    const cfg = generateDefaultConfig()
    expect(cfg.default_model).toBe(DEFAULT_MODEL)
  })

  it("assigns deepseek-v4-pro to all reasoning agents", () => {
    const cfg = generateDefaultConfig()
    for (const name of REASONING_AGENTS) {
      expect(cfg.agents[name]).toBe(REASONING_MODEL)
    }
  })

  it("does not assign models to light agents", () => {
    const cfg = generateDefaultConfig()
    for (const name of LIGHT_AGENTS) {
      expect(cfg.agents[name]).toBeUndefined()
    }
  })

  it("includes all 15 reasoning agents", () => {
    const cfg = generateDefaultConfig()
    expect(Object.keys(cfg.agents).length).toBe(REASONING_AGENTS.length)
  })
})

describe("writeConfig", () => {
  let configPath: string

  beforeEach(() => {
    configPath = setTestDir()
  })

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }) } catch {}
  })

  it("writes config to disk correctly", () => {
    const cfg: ModelRoutingConfig = {
      enabled: true,
      default_model: "test-model",
      agents: { planner: "test-pro" },
    }
    writeConfig(configPath, cfg)
    const loaded = JSON.parse(fs.readFileSync(configPath, "utf8"))
    expect(loaded.enabled).toBe(true)
    expect(loaded.default_model).toBe("test-model")
    expect(loaded.agents.planner).toBe("test-pro")
  })

  it("generates valid JSON", () => {
    const cfg = generateDefaultConfig()
    writeConfig(configPath, cfg)
    const loaded = JSON.parse(fs.readFileSync(configPath, "utf8"))
    expect(loaded.enabled).toBe(true)
    expect(Object.keys(loaded.agents).length).toBe(15)
  })
})

describe("applyModelRouting", () => {
  function defaultRouting(): ModelRoutingConfig {
    return generateDefaultConfig()
  }

  function makeConfig(): any {
    const agent: Record<string, any> = {}
    for (const name of ALL_AGENTS) {
      agent[name] = {}
    }
    // Simulate a pre-configured user agent (should not be touched)
    agent["build"] = { model: "user-set-model" }
    return { agent }
  }

  it("assigns reasoning_model to reasoning agents", () => {
    const config = makeConfig()
    applyModelRouting(config, defaultRouting())
    for (const name of REASONING_AGENTS) {
      expect(config.agent[name].model).toBe(REASONING_MODEL)
    }
  })

  it("assigns default_model to light agents", () => {
    const config = makeConfig()
    applyModelRouting(config, defaultRouting())
    for (const name of LIGHT_AGENTS) {
      expect(config.agent[name].model).toBe(DEFAULT_MODEL)
    }
  })

  it("does not override user-configured agent models", () => {
    const config = makeConfig()
    applyModelRouting(config, defaultRouting())
    expect(config.agent.build.model).toBe("user-set-model")
  })

  it("skips routing when enabled is false", () => {
    const config = makeConfig()
    applyModelRouting(config, { enabled: false, default_model: DEFAULT_MODEL, agents: {} })
    for (const name of ALL_AGENTS) {
      expect(config.agent[name].model).toBeUndefined()
    }
  })

  it("applies custom per-agent overrides", () => {
    const config = makeConfig()
    applyModelRouting(config, {
      enabled: true,
      default_model: DEFAULT_MODEL,
      agents: { planner: "custom-model" },
    })
    expect(config.agent.planner.model).toBe("custom-model")
    expect(config.agent["code-reviewer"].model).toBe(DEFAULT_MODEL)
  })

  it("applies custom default_model", () => {
    const config = makeConfig()
    applyModelRouting(config, {
      enabled: true,
      default_model: "custom-flash",
      agents: { planner: REASONING_MODEL },
    })
    expect(config.agent.planner.model).toBe(REASONING_MODEL)
    expect(config.agent["search-agent"].model).toBe("custom-flash")
  })

  it("never sets config.model (primary model untouched)", () => {
    const config = makeConfig()
    config.model = "user-primary-model"
    applyModelRouting(config, defaultRouting())
    expect(config.model).toBe("user-primary-model")
  })
})
