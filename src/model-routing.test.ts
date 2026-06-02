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

const TEST_AGENTS = [
  "planner",
  "architect",
  "code-reviewer",
  "search-agent",
  "docs-lookup",
]

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
  it("returns enabled: false", () => {
    const cfg = generateDefaultConfig()
    expect(cfg.enabled).toBe(false)
  })

  it("uses deepseek-v4-flash as global_default", () => {
    const cfg = generateDefaultConfig()
    expect(cfg.global_default).toBe(DEFAULT_MODEL)
  })

  it("has no agent overrides by default", () => {
    const cfg = generateDefaultConfig()
    expect(Object.keys(cfg.agents).length).toBe(0)
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
      global_default: "test-model",
      agents: { planner: "test-pro" },
    }
    writeConfig(configPath, cfg)
    const loaded = JSON.parse(fs.readFileSync(configPath, "utf8"))
    expect(loaded.enabled).toBe(true)
    expect(loaded.global_default).toBe("test-model")
    expect(loaded.agents.planner).toBe("test-pro")
  })

  it("generates valid JSON", () => {
    const cfg = generateDefaultConfig()
    writeConfig(configPath, cfg)
    const loaded = JSON.parse(fs.readFileSync(configPath, "utf8"))
    expect(loaded.enabled).toBe(false)
    expect(Object.keys(loaded.agents).length).toBe(0)
  })
})

describe("applyModelRouting", () => {
  function makeConfig(): any {
    const agent: Record<string, any> = {}
    for (const name of TEST_AGENTS) {
      agent[name] = {}
    }
    agent["build"] = { model: "user-set-model" }
    return { agent }
  }

  it("assigns global_default to all agents when no per-agent overrides", () => {
    const config = makeConfig()
    applyModelRouting(config, {
      enabled: true,
      global_default: DEFAULT_MODEL,
      agents: {},
    })
    for (const name of TEST_AGENTS) {
      expect(config.agent[name].model).toBe(DEFAULT_MODEL)
    }
  })

  it("does not override user-configured agent models", () => {
    const config = makeConfig()
    applyModelRouting(config, {
      enabled: true,
      global_default: DEFAULT_MODEL,
      agents: {},
    })
    expect(config.agent.build.model).toBe("user-set-model")
  })

  it("skips routing when enabled is false", () => {
    const config = makeConfig()
    applyModelRouting(config, {
      enabled: false,
      global_default: DEFAULT_MODEL,
      agents: {},
    })
    for (const name of TEST_AGENTS) {
      expect(config.agent[name].model).toBeUndefined()
    }
  })

  it("applies custom per-agent overrides", () => {
    const config = makeConfig()
    applyModelRouting(config, {
      enabled: true,
      global_default: DEFAULT_MODEL,
      agents: { planner: "custom-model" },
    })
    expect(config.agent.planner.model).toBe("custom-model")
    expect(config.agent["search-agent"].model).toBe(DEFAULT_MODEL)
  })

  it("empty string override falls back to global_default", () => {
    const config = makeConfig()
    applyModelRouting(config, {
      enabled: true,
      global_default: DEFAULT_MODEL,
      agents: { planner: "" },
    })
    expect(config.agent.planner.model).toBe(DEFAULT_MODEL)
  })

  it("applies custom global_default", () => {
    const config = makeConfig()
    applyModelRouting(config, {
      enabled: true,
      global_default: "custom-flash",
      agents: { planner: "opencode-go/deepseek-v4-pro" },
    })
    expect(config.agent.planner.model).toBe("opencode-go/deepseek-v4-pro")
    expect(config.agent["search-agent"].model).toBe("custom-flash")
  })

  it("never sets config.model (primary model untouched)", () => {
    const config = makeConfig()
    config.model = "user-primary-model"
    applyModelRouting(config, {
      enabled: true,
      global_default: DEFAULT_MODEL,
      agents: {},
    })
    expect(config.model).toBe("user-primary-model")
  })
})
