import { describe, it, expect, afterAll } from "bun:test"
import * as path from "node:path"
import * as fs from "node:fs"
import { parseInstinctYaml, readInstincts, buildInstinctStatusTable, instinctConfidence } from "./instinct"

describe("instinctConfidence", () => {
  it("returns 0 for 0 repetitions", () => {
    expect(instinctConfidence(0)).toBe(0)
  })

  it("returns 20 for 1 repetition (10 base + 10 bonus)", () => {
    expect(instinctConfidence(1)).toBe(20)
  })

  it("returns 50 for 3 repetitions (30 base + 20 bonus)", () => {
    expect(instinctConfidence(3)).toBe(50)
  })

  it("returns 50 for 5 repetitions (50 base + 0 bonus)", () => {
    expect(instinctConfidence(5)).toBe(50)
  })

  it("caps at 100 for 10+ repetitions", () => {
    expect(instinctConfidence(10)).toBe(100)
    expect(instinctConfidence(15)).toBe(100)
  })

  it("returns 30 for 2 repetitions (20 base + 10 bonus)", () => {
    expect(instinctConfidence(2)).toBe(30)
  })
})

describe("parseInstinctYaml", () => {
  it("parses a valid instinct YAML", () => {
    const yaml = `name: test-instinct
description: A test instinct
source: manual
repetitions: 3
status: active
domain: testing
tags:
  - test
  - example`
    const result = parseInstinctYaml(yaml)
    expect(result).not.toBeNull()
    expect(result!.name).toBe("test-instinct")
    expect(result!.description).toBe("A test instinct")
    expect(result!.source).toBe("manual")
    expect(result!.repetitions).toBe(3)
    expect(result!.status).toBe("active")
    expect(result!.domain).toBe("testing")
    expect(result!.tags).toEqual(["test", "example"])
  })

  it("returns null for empty input", () => {
    expect(parseInstinctYaml("")).toBeNull()
  })

  it("returns null for YAML with no name", () => {
    const yaml = `description: missing name
source: manual
repetitions: 1`
    expect(parseInstinctYaml(yaml)).toBeNull()
  })

  it("handles repetitions: 0 correctly", () => {
    const yaml = `name: zero-reps
description: Zero repetitions
source: manual
repetitions: 0
status: active`
    const result = parseInstinctYaml(yaml)
    expect(result).not.toBeNull()
    expect(result!.repetitions).toBe(0)
  })

  it("handles invalid repetitions value gracefully", () => {
    const yaml = `name: bad-reps
description: Bad reps
source: manual
repetitions: abc
status: active`
    const result = parseInstinctYaml(yaml)
    expect(result).not.toBeNull()
    expect(result!.repetitions).toBe(1) // default
  })

  it("handles quoted values", () => {
    const yaml = `name: "quoted-name"
description: "Quoted description with : colon"
source: manual
repetitions: 2
status: active`
    const result = parseInstinctYaml(yaml)
    expect(result).not.toBeNull()
    expect(result!.name).toBe("quoted-name")
    expect(result!.description).toBe("Quoted description with : colon")
  })

  it("handles single-quoted values", () => {
    const yaml = `name: 'single-quoted'
description: A test
source: manual
repetitions: 1
status: active`
    const result = parseInstinctYaml(yaml)
    expect(result).not.toBeNull()
    expect(result!.name).toBe("single-quoted")
  })

  it("ignores comment lines", () => {
    const yaml = `# this is a comment
name: has-comment
description: With comment
source: manual
repetitions: 2
status: active`
    const result = parseInstinctYaml(yaml)
    expect(result).not.toBeNull()
    expect(result!.name).toBe("has-comment")
  })

  it("defaults source, status, domain when not provided", () => {
    const yaml = `name: minimal
description: Minimal instinct`
    const result = parseInstinctYaml(yaml)
    expect(result).not.toBeNull()
    expect(result!.source).toBe("manual")
    expect(result!.status).toBe("active")
    expect(result!.domain).toBe("general")
    expect(result!.repetitions).toBe(1)
    expect(result!.tags).toEqual([])
  })

  it("rejects invalid source value", () => {
    const yaml = `name: bad-source
description: Invalid source
source: invalid-source
repetitions: 1`
    const result = parseInstinctYaml(yaml)
    expect(result).not.toBeNull()
    expect(result!.source).toBe("manual") // default preserved
  })

  it("rejects invalid status value", () => {
    const yaml = `name: bad-status
description: Invalid status
source: manual
repetitions: 1
status: invalid-status`
    const result = parseInstinctYaml(yaml)
    expect(result).not.toBeNull()
    expect(result!.status).toBe("active") // default preserved
  })
})

describe("buildInstinctStatusTable", () => {
  it("returns empty message for empty list", () => {
    const result = buildInstinctStatusTable([])
    expect(result).toBe("No instincts found in `.opencode/instincts/`.")
  })

  it("groups instincts by status", () => {
    const instincts = [
      { name: "a1", description: "Active one", source: "manual" as const, repetitions: 2, status: "active" as const, domain: "typescript", tags: [] },
      { name: "pr1", description: "Pending review one", source: "manual" as const, repetitions: 1, status: "pending-review" as const, domain: "testing", tags: [] },
      { name: "a2", description: "Active two", source: "git-history" as const, repetitions: 5, status: "active" as const, domain: "typescript", tags: [] },
      { name: "d1", description: "Deprecated one", source: "manual" as const, repetitions: 3, status: "deprecated" as const, domain: "legacy", tags: [] },
    ]
    const result = buildInstinctStatusTable(instincts)
    expect(result).toContain("### Active (2)")
    expect(result).toContain("### Pending Review (1)")
    expect(/- \*\*pr1\*\*/.test(result)).toBe(true)
  })

  it("includes domain summary", () => {
    const instincts = [
      { name: "a", description: "A", source: "manual" as const, repetitions: 1, status: "active" as const, domain: "typescript", tags: [] },
      { name: "b", description: "B", source: "manual" as const, repetitions: 2, status: "active" as const, domain: "testing", tags: [] },
    ]
    const result = buildInstinctStatusTable(instincts)
    expect(result).toContain("typescript: 1 instinct")
    expect(result).toContain("testing: 1 instinct")
    expect(result).toContain("**Total: 2**")
  })

  it("shows confidence percentage", () => {
    const instincts = [
      { name: "c", description: "C", source: "git-history" as const, repetitions: 5, status: "active" as const, domain: "typescript", tags: [] },
    ]
    const result = buildInstinctStatusTable(instincts)
    expect(result).toContain("Confidence: 50%")
    expect(result).toContain("5 reps")
  })

  it("handles single repetition grammar", () => {
    const instincts = [
      { name: "solo", description: "Solo", source: "manual" as const, repetitions: 1, status: "active" as const, domain: "typescript", tags: [] },
    ]
    const result = buildInstinctStatusTable(instincts)
    expect(result).toContain("1 rep")
  })
})

describe("readInstincts", () => {
  const tmpBase = path.join(import.meta.dir, "..", ".opencode", ".test-instincts-tmp")

  function writeInstinct(dir: string, name: string, content: string): string {
    const filePath = path.join(dir, `${name}.yaml`)
    fs.writeFileSync(filePath, content, "utf8")
    return filePath
  }

  function makeWorktree(subdir: string): string {
    const dir = path.join(tmpBase, subdir)
    const instinctsDir = path.join(dir, ".opencode", "instincts")
    fs.mkdirSync(instinctsDir, { recursive: true })
    return dir
  }

  afterAll(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it("reads .yaml files from .opencode/instincts/", () => {
    const worktree = makeWorktree("reads-yaml")
    writeInstinct(path.join(worktree, ".opencode", "instincts"), "test-one", `name: test-one\ndescription: First\nsource: manual\nrepetitions: 1\nstatus: active`)
    writeInstinct(path.join(worktree, ".opencode", "instincts"), "test-two", `name: test-two\ndescription: Second\nsource: git-history\nrepetitions: 3\nstatus: active`)

    const instincts = readInstincts(worktree)
    expect(instincts.length).toBe(2)
    expect(instincts.map(i => i.name).sort()).toEqual(["test-one", "test-two"])
  })

  it("skips non-yaml files", () => {
    const worktree = makeWorktree("skips-non-yaml")
    const instinctDir = path.join(worktree, ".opencode", "instincts")
    writeInstinct(instinctDir, "valid", `name: valid\ndescription: YAML file\nsource: manual\nrepetitions: 1\nstatus: active`)
    fs.writeFileSync(path.join(instinctDir, "not-me.txt"), "not yaml", "utf8")
    fs.writeFileSync(path.join(instinctDir, "not-me.md"), "# Not yaml", "utf8")

    const instincts = readInstincts(worktree)
    expect(instincts.length).toBe(1)
    expect(instincts[0].name).toBe("valid")
  })

  it("returns empty array when directory does not exist", () => {
    const result = readInstincts(path.join(tmpBase, "no-such-dir"))
    expect(result).toEqual([])
  })

  it("returns empty array for empty instincts directory", () => {
    const worktree = makeWorktree("empty-dir")
    const instincts = readInstincts(worktree)
    expect(instincts).toEqual([])
  })

  it("silently skips malformed yaml files", () => {
    const worktree = makeWorktree("malformed")
    const instinctDir = path.join(worktree, ".opencode", "instincts")
    writeInstinct(instinctDir, "good", `name: good\ndescription: Good one\nsource: manual\nrepetitions: 1\nstatus: active`)
    fs.writeFileSync(path.join(instinctDir, "bad.yaml"), "garbage: [[[invalid yaml", "utf8")

    const instincts = readInstincts(worktree)
    expect(instincts.length).toBe(1)
    expect(instincts[0].name).toBe("good")
  })
})
