import { describe, it, expect } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { buildCompactionContext, buildSystemBootstrap, detectProject } from "./plugin-support"

describe("plugin-support", () => {
  it("detects project profile from files", () => {
    const tmp = fs.mkdtempSync(path.join(path.dirname(import.meta.dir), "plugin-support-"))
    try {
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "demo" }), "utf8")
      fs.writeFileSync(path.join(tmp, "tsconfig.json"), "{}", "utf8")
      fs.writeFileSync(path.join(tmp, "bun.lock"), "", "utf8")

      const profile = detectProject(tmp)
      expect(profile.projectName).toBe("demo")
      expect(profile.languages).toContain("typescript")
      expect(profile.packageManager).toBe("bun")
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("builds the system bootstrap string", () => {
    const text = buildSystemBootstrap({
      pkg: { version: "1.2.3", root: "/tmp/openecc", skillsDir: "/tmp/openecc/.opencode/skills" },
      soulContent: "Soul text",
      projectProfile: { projectName: "demo", languages: ["typescript"], packageManager: "bun" },
      executionBlock: "<structured type=\"execution\">x</structured>",
      toolAccessBlock: "<structured type=\"tool_access\">y</structured>",
    })

    expect(text).toContain("EXTREMELY_IMPORTANT")
    expect(text).toContain("Soul text")
    expect(text).toContain("tool_access")
    expect(text).toContain("Project Profile")
  })

  it("builds compaction context with edited files", () => {
    const lines = buildCompactionContext({
      pkg: { version: "1.2.3", root: "/tmp/openecc", skillsDir: "/tmp/openecc/.opencode/skills" },
      projectProfile: { projectName: "demo", languages: ["typescript"], packageManager: "bun" },
      editedFiles: new Set(["src/a.ts", "src/b.ts"]),
    })

    expect(lines.join("\n")).toContain("src/a.ts")
    expect(lines.join("\n")).toContain("Languages: typescript")
  })
})
