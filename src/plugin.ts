import { tool, type Plugin } from "@opencode-ai/plugin"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as fs from "node:fs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const skillsDir = path.resolve(__dirname, "..", "skills")

let _soulCache: string | null = undefined

function getSoulContent(): string | null {
  if (_soulCache !== undefined) return _soulCache

  const soulPath = path.join(skillsDir, "soul", "SKILL.md")
  if (!fs.existsSync(soulPath)) {
    _soulCache = null
    return null
  }

  const fullContent = fs.readFileSync(soulPath, "utf8")
  const content = fullContent.replace(/^---[\s\S]*?---\n/, "")

  _soulCache = `<EXTREMELY_IMPORTANT>
You have a soul — the principles below are always active. They are ALREADY LOADED.

${content}
</EXTREMELY_IMPORTANT>`

  return _soulCache
}

function resolveProjectFile(worktreePath: string, relativePath: string): boolean {
  try {
    return fs.statSync(path.join(worktreePath, relativePath)).isFile()
  } catch {
    return false
  }
}

const editedFiles = new Set<string>()
const pendingToolChanges = new Map<string, { path: string; type: "added" | "modified" }>()
let writeCounter = 0

const runTestsTool = tool({
  description:
    "Run the test suite with optional coverage, watch mode, or specific test patterns. Automatically detects package manager (npm, pnpm, yarn, bun) and test framework.",
  args: {
    pattern: tool.schema.string().optional().describe("Test file pattern or specific test name to run"),
    coverage: tool.schema.boolean().optional().describe("Run with coverage reporting"),
    watch: tool.schema.boolean().optional().describe("Run in watch mode"),
  },
  async execute(args, context) {
    const cwd = context.worktree || context.directory
    const lockfiles: Record<string, string> = {
      "bun.lockb": "bun",
      "pnpm-lock.yaml": "pnpm",
      "yarn.lock": "yarn",
      "package-lock.json": "npm",
    }
    let pm = "npm"
    for (const [lock, name] of Object.entries(lockfiles)) {
      if (fs.existsSync(path.join(cwd, lock))) { pm = name; break }
    }

    const cmd = pm === "npm" ? `${pm} run test` : `${pm} test`
    const flags = []
    if (args.coverage) flags.push("--coverage")
    if (args.watch) flags.push("--watch")
    if (args.pattern) flags.push("--", ...args.pattern.split(/\s+/))

    return JSON.stringify({
      command: flags.length ? `${cmd} ${flags.join(" ")}` : cmd,
      packageManager: pm,
      instructions: `Run this command to execute tests:\n\n${flags.length ? `${cmd} ${flags.join(" ")}` : cmd}`,
    })
  },
})

const changedFilesTool = tool({
  description: "List files that have been created or modified during this session.",
  args: {},
  async execute(_args, _context) {
    return JSON.stringify({
      files: Array.from(editedFiles),
      count: editedFiles.size,
    })
  },
})

export const OpenECCPlugin: Plugin = async ({ client, directory, $, worktree }) => {
  const worktreePath = worktree || directory
  const soul = getSoulContent()

  return {
    config: async (config) => {
      config.skills = config.skills || {}
      config.skills.paths = config.skills.paths || []
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir)
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (!soul || !output.messages?.length) return
      const firstUser = output.messages.find((m: any) => m.info?.role === "user")
      if (!firstUser || !firstUser.parts?.length) return
      if (firstUser.parts.some((p: any) => p.type === "text" && p.text?.includes("EXTREMELY_IMPORTANT"))) return

      const ref = firstUser.parts[0]
      firstUser.parts.unshift({ ...ref, type: "text", text: soul })
    },

    "experimental.session.compacting": async () => {
      const contextBlocks = [
        "# OpenECC Context (preserve across compaction)",
        "",
        "## Active Soul",
        "- Think Before Coding: surface assumptions. Don't hide confusion.",
        "- Simplicity First: minimum code. Nothing speculative.",
        "- Surgical Changes: touch only what you must.",
        "- Goal-Driven Execution: define verifiable success criteria.",
        "",
      ]
      if (editedFiles.size > 0) {
        contextBlocks.push("## Recently Edited Files")
        for (const f of editedFiles) contextBlocks.push(`- ${f}`)
        contextBlocks.push("")
      }
      return {
        context: contextBlocks.join("\n"),
        compaction_prompt:
          "Preserve: 1) Current task status, 2) Key decisions, 3) Active files, 4) Remaining work, 5) Security concerns. Discard verbose tool outputs and redundant file listings.",
      }
    },

    "file.edited": async (event: { path: string }) => {
      editedFiles.add(event.path)

      if (event.path.match(/\.(ts|tsx|js|jsx)$/)) {
        try {
          const result = await $`grep -n "console\\.log" ${event.path} 2>/dev/null`.text()
          if (result.trim()) {
            const lines = result.trim().split("\n").length
            await client.app.log({
              body: {
                service: "openecc",
                level: "warn" as const,
                message: `console.log found in ${event.path} (${lines} occurrence${lines > 1 ? "s" : ""})`,
              },
            })
          }
        } catch {}
      }
    },

    "tool.execute.after": async (input: { tool: string; args?: Record<string, unknown> }, _output: unknown) => {
      const filePath = input.args?.filePath as string | undefined
      if (input.tool === "edit" && filePath) {
        editedFiles.add(filePath)
      }
      if (input.tool === "write" && filePath) {
        editedFiles.add(filePath)
      }

      if (
        input.tool === "edit" &&
        filePath?.match(/\.tsx?$/)
      ) {
        try {
          await $`npx tsc --noEmit 2>&1`
        } catch {
          await client.app.log({
            body: {
              service: "openecc",
              level: "warn" as const,
              message: "TypeScript errors detected after edit — run `npx tsc --noEmit` to see details",
            },
          })
        }
      }
    },

    "session.idle": async () => {
      if (editedFiles.size === 0) return

      let count = 0
      const files: string[] = []
      for (const file of editedFiles) {
        if (!file.match(/\.(ts|tsx|js|jsx)$/)) continue
        try {
          const result = await $`grep -c "console\\.log" ${file} 2>/dev/null`.text()
          const n = parseInt(result.trim(), 10)
          if (n > 0) { count += n; files.push(file) }
        } catch {}
      }

      if (count > 0) {
        await client.app.log({
          body: {
            service: "openecc",
            level: "warn" as const,
            message: `Session idle audit: ${count} console.log(s) in ${files.length} file(s). Remove before committing.`,
          },
        })
      }

      editedFiles.clear()
    },

    "session.deleted": async () => {
      editedFiles.clear()
      pendingToolChanges.clear()
    },

    "shell.env": async () => {
      const env: Record<string, string> = {
        ECC_VERSION: "1.0.0",
        ECC_PLUGIN: "true",
        PROJECT_ROOT: worktreePath,
      }
      const lockfiles: Record<string, string> = {
        "bun.lockb": "bun",
        "pnpm-lock.yaml": "pnpm",
        "yarn.lock": "yarn",
        "package-lock.json": "npm",
      }
      for (const [lock, name] of Object.entries(lockfiles)) {
        if (resolveProjectFile(worktreePath, lock)) {
          env.PACKAGE_MANAGER = name
          break
        }
      }
      const langDetectors: Record<string, string> = {
        "tsconfig.json": "typescript",
        "go.mod": "go",
        "pyproject.toml": "python",
        "Cargo.toml": "rust",
      }
      const detected: string[] = []
      for (const [file, lang] of Object.entries(langDetectors)) {
        if (resolveProjectFile(worktreePath, file)) detected.push(lang)
      }
      if (detected.length > 0) {
        env.DETECTED_LANGUAGES = detected.join(",")
        env.PRIMARY_LANGUAGE = detected[0]
      }
      return env
    },

    tool: {
      "run-tests": runTestsTool,
      "changed-files": changedFilesTool,
    },
  }
}

export default OpenECCPlugin
