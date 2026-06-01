import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import {
  discoverAgents,
  discoverCommands,
  discoverSkills,
  clearDiscoveryCache,
} from "./discovery"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_BASE = path.join(__dirname, "..", ".openecc-test")

function tmpRoot(): string {
  if (!fs.existsSync(TEST_BASE)) fs.mkdirSync(TEST_BASE, { recursive: true })
  return fs.mkdtempSync(path.join(TEST_BASE, "disc-test-"))
}

let tmpDir: string

function testDir(...segments: string[]): string {
  const dir = path.join(tmpDir, ...segments)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, "utf8")
}

// ── Agent Tests ────────────────────────────────────────────────────────────

describe("discoverAgents", () => {
  beforeEach(() => {
    clearDiscoveryCache()
    tmpDir = tmpRoot()
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it("discovers bundled agents from openecc package", () => {
    const agents = discoverAgents(tmpDir)
    expect(agents.length).toBeGreaterThanOrEqual(15)
    const names = agents.map((a) => a.name)
    expect(names).toContain("planner")
    expect(names).toContain("architect")
    expect(names).toContain("code-reviewer")
  })

  it("discovers agents from workspace .opencode directory", () => {
    const agDir = testDir(".opencode", "prompts", "agents")
    writeFile(path.join(agDir, "project-agent.txt"), "You are a project agent.\nDo project things.\n")
    const agents = discoverAgents(tmpDir)
    const agent = agents.find((a) => a.name === "project-agent")
    expect(agent).toBeDefined()
    expect(agent!.source).toBe("workspace")
  })

  it("bundled priority beats workspace on name conflict", () => {
    const agDir = testDir(".opencode", "prompts", "agents")
    writeFile(path.join(agDir, "architect.txt"), "You are a WORKSPACE architect.\nDo things.\n")
    const agents = discoverAgents(tmpDir)
    const agent = agents.find((a) => a.name === "architect")
    expect(agent).toBeDefined()
    expect(agent!.source).toBe("openecc")
  })

  it("workspace agents are additive for unique names", () => {
    const agDir = testDir(".opencode", "prompts", "agents")
    writeFile(path.join(agDir, "team-custom.txt"), "You are a team custom agent.\nDo things.\n")
    const agents = discoverAgents(tmpDir)
    const workspace = agents.filter((a) => a.source === "workspace")
    expect(workspace.length).toBe(1)
    expect(workspace[0].name).toBe("team-custom")
  })

  it("handles missing workspace directory gracefully", () => {
    clearDiscoveryCache()
    const agents = discoverAgents(path.join(tmpDir, "nonexistent"))
    const bundled = agents.filter((a) => a.source === "openecc")
    expect(bundled.length).toBeGreaterThanOrEqual(15)
  })

  it("permission inference works for discovered agents", () => {
    const agents = discoverAgents(tmpDir)
    const searchAgent = agents.find((a) => a.name === "search-agent")
    expect(searchAgent).toBeDefined()
    expect(searchAgent!.permission).toBeDefined()
    expect(searchAgent!.permission!.edit).toBe("deny")
    const planner = agents.find((a) => a.name === "planner")
    expect(planner).toBeDefined()
    expect(planner!.permission!.edit).toBe("deny")
  })
})

// ── Command Tests ──────────────────────────────────────────────────────────

describe("discoverCommands", () => {
  beforeEach(() => {
    clearDiscoveryCache()
    tmpDir = tmpRoot()
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it("discovers bundled commands from openecc package", () => {
    const cmds = discoverCommands(tmpDir)
    expect(cmds.length).toBeGreaterThanOrEqual(20)
    const names = cmds.map((c) => c.name)
    expect(names).toContain("plan")
    expect(names).toContain("code-review")
  })

  it("discovers commands from workspace .opencode directory", () => {
    const cmdDir = testDir(".opencode", "commands")
    writeFile(cmdDir + "/ship-it.md", "---\ndescription: Ship it command\n---\nDeploy to production.\n")
    const cmds = discoverCommands(tmpDir)
    const cmd = cmds.find((c) => c.name === "ship-it")
    expect(cmd).toBeDefined()
    expect(cmd!.source).toBe("workspace")
    expect(cmd!.desc).toBe("Ship it command")
  })

  it("bundled priority beats workspace on name conflict", () => {
    const cmdDir = testDir(".opencode", "commands")
    writeFile(cmdDir + "/plan.md", "---\ndescription: Plan command\n---\nOverride.\n")
    const cmds = discoverCommands(tmpDir)
    const cmd = cmds.find((c) => c.name === "plan")
    expect(cmd).toBeDefined()
    expect(cmd!.source).toBe("openecc")
  })

  it("workspace commands are additive for unique names", () => {
    const cmdDir = testDir(".opencode", "commands")
    writeFile(cmdDir + "/my-custom.md", "---\ndescription: My custom\n---\nDo the thing.\n")
    const cmds = discoverCommands(tmpDir)
    const workspace = cmds.filter((c) => c.source === "workspace")
    expect(workspace.length).toBe(1)
  })

  it("handles frontmatter parsing for workspace commands", () => {
    const cmdDir = testDir(".opencode", "commands")
    writeFile(cmdDir + "/custom.md", "---\ndescription: Custom\nagent: planner\nsubtask: true\n---\nRun planner.\n")
    const cmds = discoverCommands(tmpDir)
    const cmd = cmds.find((c) => c.name === "custom")
    expect(cmd).toBeDefined()
    expect(cmd!.agent).toBe("planner")
    expect(cmd!.subtask).toBe(true)
  })

  it("handles missing workspace directory gracefully", () => {
    clearDiscoveryCache()
    const cmds = discoverCommands(path.join(tmpDir, "nonexistent"))
    const bundled = cmds.filter((c) => c.source === "openecc")
    expect(bundled.length).toBeGreaterThanOrEqual(20)
  })
})

// ── Skill Tests ────────────────────────────────────────────────────────────

describe("discoverSkills", () => {
  beforeEach(() => {
    clearDiscoveryCache()
    tmpDir = tmpRoot()
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it("discovers bundled skills from openecc package", () => {
    const skills = discoverSkills(tmpDir)
    expect(skills.length).toBeGreaterThanOrEqual(10)
    expect(skills.some((s) => s.endsWith("soul"))).toBe(true)
    expect(skills.some((s) => s.endsWith("orchestrator"))).toBe(true)
  })

  it("discovers skills from workspace .opencode directory", () => {
    const skillDir = testDir(".opencode", "skills", "ws-skill")
    writeFile(path.join(skillDir, "SKILL.md"), "# Workspace Skill\nDo things.\n")
    const skills = discoverSkills(tmpDir)
    expect(skills.some((s) => s.endsWith("ws-skill"))).toBe(true)
  })

  it("deduplicates skill paths", () => {
    const skills = discoverSkills(tmpDir)
    const dirs = skills.map((s) => path.basename(s))
    expect(new Set(dirs).size).toBe(dirs.length)
  })

  it("handles missing workspace directory gracefully", () => {
    clearDiscoveryCache()
    const skills = discoverSkills(path.join(tmpDir, "nonexistent"))
    expect(skills.length).toBeGreaterThanOrEqual(10)
  })
})

// ── Caching Tests ──────────────────────────────────────────────────────────

describe("discovery caching", () => {
  beforeEach(() => {
    clearDiscoveryCache()
    tmpDir = tmpRoot()
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it("discoverAgents returns cached result on second call", () => {
    const first = discoverAgents(tmpDir)
    const agDir = testDir(".opencode", "prompts", "agents")
    writeFile(path.join(agDir, "late-agent.txt"), "You are a late agent.\nDo things.\n")
    const second = discoverAgents(tmpDir)
    expect(second.length).toBe(first.length)
  })

  it("clearDiscoveryCache resets and picks up new agents", () => {
    discoverAgents(tmpDir)
    clearDiscoveryCache()
    const agDir = testDir(".opencode", "prompts", "agents")
    writeFile(path.join(agDir, "fresh-agent.txt"), "You are a fresh agent.\nDo things.\n")
    const agents = discoverAgents(tmpDir)
    expect(agents.some((a) => a.name === "fresh-agent")).toBe(true)
  })

  it("each discovery type has independent cache", () => {
    clearDiscoveryCache()
    discoverAgents(tmpDir)
    const cmds = discoverCommands(tmpDir)
    expect(cmds.length).toBeGreaterThanOrEqual(20)
  })
})
