import * as fs from "node:fs"
import * as path from "node:path"

export interface AgentTrigger {
  domain: string
  keywords: string[]
  permissions: Record<string, string>
}

export interface SkillTrigger {
  domain: string
  keywords: string[]
  description: string
}

export interface ScoredRecommendation {
  name: string
  type: "agent" | "skill"
  confidence: number
  domain: string
}

interface ProjectProfile {
  languages: string[]
  frameworks: string[]
  testFrameworks: string[]
  cssFrameworks: string[]
  packageManager: string
  formatter: string | null
  linter: string | null
  hasDocker: boolean
  hasCI: boolean
  projectName: string
}

const AGENT_TRIGGERS: Record<string, AgentTrigger> = {
  planner: { domain: "planning", keywords: ["plan", "planning", "architecture", "organize", "structure", "feature", "refactoring", "strategy", "roadmap"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  architect: { domain: "planning", keywords: ["architecture", "design", "system", "scalability", "decision", "technical decision"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "code-reviewer": { domain: "review", keywords: ["review", "code review", "quality", "inspect", "audit", "check code", "look over"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "security-reviewer": { domain: "security", keywords: ["security", "vulnerability", "auth", "authentication", "input validation", "secrets", "owasp", "injection", "xss", "csrf", "api security"], permissions: { task: "deny" } },
  "tdd-guide": { domain: "test", keywords: ["test", "tdd", "spec", "coverage", "unit test", "integration test", "test-driven", "test coverage"], permissions: { task: "deny" } },
  "build-error-resolver": { domain: "build-fix", keywords: ["build error", "compilation", "type error", "compile", "tsc", "bundler", "doesn't compile", "fails to build"], permissions: { task: "deny" } },
  "e2e-runner": { domain: "test", keywords: ["e2e", "playwright", "end to end", "end-to-end", "integration test", "browser test"], permissions: { task: "deny" } },
  "doc-updater": { domain: "docs", keywords: ["document", "docs", "readme", "api docs", "update docs", "documentation update"], permissions: { task: "deny" } },
  "refactor-cleaner": { domain: "refactor", keywords: ["refactor", "clean up", "dead code", "unused", "duplicate", "consolidate", "cleanup"], permissions: { task: "deny" } },
  "docs-lookup": { domain: "docs", keywords: ["documentation", "api reference", "library docs", "lookup", "research", "find docs"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "harness-optimizer": { domain: "general", keywords: ["harness", "optimize", "configuration", "agent setup", "harness config"], permissions: { task: "deny" } },
  "loop-operator": { domain: "general", keywords: ["loop", "autonomous", "multi-step", "monitor", "iteration", "long-running"], permissions: { task: "deny" } },
  "go-reviewer": { domain: "review", keywords: ["go", "golang", "go code", "go review"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "go-build-resolver": { domain: "build-fix", keywords: ["go", "golang", "go build", "go vet", "go compilation"], permissions: { task: "deny" } },
  "python-reviewer": { domain: "review", keywords: ["python", "py", "python code", "python review"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "rust-reviewer": { domain: "review", keywords: ["rust", "rust code", "rust review"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "rust-build-resolver": { domain: "build-fix", keywords: ["rust", "rust build", "cargo", "rust compilation", "rust test"], permissions: { task: "deny" } },
  "cpp-reviewer": { domain: "review", keywords: ["c++", "cpp", "c plus plus", "c++ code", "cpp review"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "cpp-build-resolver": { domain: "build-fix", keywords: ["c++", "cpp", "c plus plus", "cpp build", "cmake", "linker", "compilation"], permissions: { task: "deny" } },
  "java-reviewer": { domain: "review", keywords: ["java", "spring", "spring boot", "java code", "java review"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "java-build-resolver": { domain: "build-fix", keywords: ["java", "maven", "gradle", "java build", "java compilation"], permissions: { task: "deny" } },
  "kotlin-reviewer": { domain: "review", keywords: ["kotlin", "android", "kotlin code", "kotlin review"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "kotlin-build-resolver": { domain: "build-fix", keywords: ["kotlin", "android", "kotlin build", "gradle", "kotlin compilation"], permissions: { task: "deny" } },
  "database-reviewer": { domain: "review", keywords: ["database", "sql", "postgresql", "supabase", "query", "schema", "migration", "rls", "row level security"], permissions: { task: "deny" } },
  "swarm-coordinator": { domain: "orchestration", keywords: ["swarm", "pipeline", "end-to-end", "full workflow", "build pipeline", "ci pipeline", "make"], permissions: { edit: "deny", write: "deny" } },
  "plan-ceo-reviewer": { domain: "review", keywords: ["ceo review", "business review", "scope review", "product review", "value assessment"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "plan-design-reviewer": { domain: "review", keywords: ["design review", "ux review", "api design review", "interface review"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "plan-devex-reviewer": { domain: "review", keywords: ["devex review", "developer experience", "developer workflow", "friction review"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "plan-eng-reviewer": { domain: "review", keywords: ["engineering review", "architecture review", "technical review", "code review plan"], permissions: { edit: "deny", write: "deny", task: "deny" } },
  "goal-evaluator": { domain: "evaluation", keywords: ["goal", "evaluate", "completion", "done check", "condition met", "acceptance criteria"], permissions: { edit: "deny", write: "deny", task: "deny", bash: "deny", glob: "deny", grep: "deny" } },
}

export function buildAgentRegistry(): Record<string, AgentTrigger> {
  return { ...AGENT_TRIGGERS }
}

function parseYamlDescription(content: string): string {
  const match = content.match(/^---\n(?:.*\n)*?description:\s*(.*?)\n(?:.*\n)*?---/)
  if (match) return match[1].trim()
  return ""
}

export function buildSkillRegistry(skillsDir: string): Record<string, SkillTrigger> {
  const registry: Record<string, SkillTrigger> = {}
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = path.join(skillsDir, entry.name, "SKILL.md")
      if (!fs.existsSync(skillPath)) continue
      const content = fs.readFileSync(skillPath, "utf8")
      const description = parseYamlDescription(content)
      const body = content.replace(/^---[\s\S]*?---\n/, "")
      const bodyPreview = body.slice(0, 500).toLowerCase()
      const words = new Set<string>()
      for (const word of description.toLowerCase().split(/[\s,]+/)) {
        if (word.length > 2) words.add(word)
      }
      for (const word of bodyPreview.split(/[\s,;:.!?()]+/)) {
        if (word.length > 3) words.add(word)
      }
      const domainKeywords = ["api", "backend", "frontend", "test", "security", "e2e", "coding", "refactor", "design", "docs"]
      let domain = "general"
      for (const dk of domainKeywords) {
        if (description.toLowerCase().includes(dk) || bodyPreview.includes(dk)) {
          domain = dk
          break
        }
      }
      registry[entry.name] = {
        domain,
        keywords: Array.from(words).slice(0, 30),
        description,
      }
    }
  } catch {}
  return registry
}

function tokenize(input: string): string[] {
  return input.toLowerCase().split(/[\s,;:.!?()\[\]{}\\'"|/]+/).filter(w => w.length > 1)
}

function scoreMatch(inputTokens: string[], keywords: string[]): number {
  if (keywords.length === 0) return 0
  const lowerKeywords = keywords.map(k => k.toLowerCase())
  const inputJoined = inputTokens.join(" ")
  const exactMatches = inputTokens.filter(t => lowerKeywords.includes(t)).length
  const phraseMatches = lowerKeywords.filter(k => k.includes(" ") && inputJoined.includes(k)).length
  const totalKeywords = keywords.length
  return (exactMatches + phraseMatches) / Math.max(totalKeywords, 1)
}

export function matchTriggers(
  input: string,
  projectProfile: ProjectProfile | null,
  agentRegistry: Record<string, AgentTrigger>,
  skillRegistry: Record<string, SkillTrigger>,
): ScoredRecommendation[] {
  const tokens = tokenize(input)
  const inputLower = input.toLowerCase()
  const results: ScoredRecommendation[] = []

  const langAgentMap: Record<string, string[]> = {
    go: ["go-reviewer", "go-build-resolver"],
    rust: ["rust-reviewer", "rust-build-resolver"],
    python: ["python-reviewer"],
    java: ["java-reviewer", "java-build-resolver"],
    kotlin: ["kotlin-reviewer", "kotlin-build-resolver"],
    cpp: ["cpp-reviewer", "cpp-build-resolver"],
  }
  const frameworkAgentMap: Record<string, string[]> = {
    nextjs: ["code-reviewer"],
    angular: ["code-reviewer"],
  }
  const testAgentMap: Record<string, string[]> = {
    jest: ["tdd-guide"],
    vitest: ["tdd-guide"],
    playwright: ["e2e-runner"],
  }

  for (const [name, trigger] of Object.entries(agentRegistry)) {
    let confidence = scoreMatch(tokens, trigger.keywords)
    if (trigger.keywords.some(k => k.includes(" ") && inputLower.includes(k))) {
      confidence = Math.min(1, confidence + 0.2)
    }
    if (projectProfile) {
      for (const lang of projectProfile.languages) {
        if (langAgentMap[lang]?.includes(name)) {
          confidence = Math.min(1, confidence + 0.15)
        }
      }
      for (const fw of projectProfile.frameworks) {
        if (frameworkAgentMap[fw]?.includes(name)) {
          confidence = Math.min(1, confidence + 0.1)
        }
      }
      for (const tf of projectProfile.testFrameworks) {
        if (testAgentMap[tf]?.includes(name)) {
          confidence = Math.min(1, confidence + 0.15)
        }
      }
    }
    if (confidence > 0) {
      results.push({ name, type: "agent", confidence, domain: trigger.domain })
    }
  }

  for (const [name, trigger] of Object.entries(skillRegistry)) {
    let confidence = scoreMatch(tokens, trigger.keywords)
    if (confidence > 0) {
      results.push({ name, type: "skill", confidence, domain: trigger.domain })
    }
  }

  results.sort((a, b) => b.confidence - a.confidence)
  return results.slice(0, 5)
}
