import { type ProjectProfile } from "./detect"
import { type AgentTrigger, type SkillTrigger, SWARM_TRIGGERS, matchTriggers } from "./registry"

export type TaskCategory = "planning" | "review" | "build-fix" | "test" | "docs" | "security" | "debug" | "refactor" | "general"

const PATTERNS: Record<TaskCategory, RegExp[]> = {
  planning: [/^(plan|design|architecture|how should|what's the best|think about|strategy)/i, /\/swarm/i, /\/make/i, /full pipeline/i, /end to end/i, /build and ship/i, /pipeline/i],
  review: [/(review|check|audit|look over|inspect)/i],
  "build-fix": [/(build error|compilation error|type error|doesn't compile|fails to build|build fail)/i],
  test: [/(test|spec|coverage|tdd|unit test|integration test)/i],
  docs: [/(document|readme|docs|api docs|explain how)/i],
  security: [/(security|vulnerability|owasp|injection|xss|csrf|auth|authentication)/i],
  debug: [/(debug|bug|not working|unexpected|broken|error|exception|doesn't work)/i],
  refactor: [/(refactor|clean up|restructure|technical debt|simplify|consolidate)/i],
  general: [],
}

const SUB_CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  api: [/(api|endpoint|route|rest|graphql)/i],
  frontend: [/(ui|component|react|vue|angular|frontend|css|html)/i],
  backend: [/(backend|server|middleware|express|database|sql)/i],
  performance: [/(performance|slow|optimize|bottleneck|latency)/i],
  testing: [/(unit test|integration test|e2e|playwright|jest|vitest)/i],
  database: [/(database|sql|query|schema|migration|orm)/i],
  config: [/(config|configuration|setup|install|deploy)/i],
  dependency: [/(dependency|package|module|library|version)/i],
}

export function analyzeTask(input: string): {
  category: TaskCategory
  subCategories: string[]
  keywords: string[]
} {
  let primary: TaskCategory = "general"
  let highestScore = 0

  for (const [cat, regexps] of Object.entries(PATTERNS)) {
    if (cat === "general") continue
    let score = 0
    for (const re of regexps) {
      const matches = input.match(re)
      if (matches) score += matches.length
    }
    if (score > highestScore) {
      highestScore = score
      primary = cat as TaskCategory
    }
  }

  const subCategories: string[] = []
  for (const [sub, regexps] of Object.entries(SUB_CATEGORY_PATTERNS)) {
    for (const re of regexps) {
      if (re.test(input)) {
        subCategories.push(sub)
        break
      }
    }
  }

  const keywords = input
    .toLowerCase()
    .split(/[\s,;:.!?()]+/)
    .filter(w => w.length > 2)

  return { category: primary, subCategories, keywords }
}

export function autoDelegate(
  input: string,
  projectProfile: ProjectProfile | null,
  agentRegistry: Record<string, AgentTrigger>,
  skillRegistry: Record<string, SkillTrigger>,
): {
  task: TaskCategory
  confidence: number
  recommendedAgents: { name: string; confidence: number; reason: string }[]
  recommendedSkills: { name: string; confidence: number; reason: string }[]
  reasoning: string
} {
  const analysis = analyzeTask(input)
  const matches = matchTriggers(input, projectProfile, agentRegistry, skillRegistry)

  const recommendedAgents = matches
    .filter(m => m.type === "agent" && m.confidence > 0)
    .map(m => ({
      name: m.name,
      confidence: Math.round(m.confidence * 100) / 100,
      reason: domainReason(m.domain),
    }))

  const recommendedSkills = matches
    .filter(m => m.type === "skill" && m.confidence > 0)
    .map(m => ({
      name: m.name,
      confidence: Math.round(m.confidence * 100) / 100,
      reason: `Matched task keywords: ${m.domain}`,
    }))

  const isSwarm = SWARM_TRIGGERS.some(k => input.toLowerCase().includes(k))

  if (isSwarm) {
    recommendedAgents.unshift({
      name: "swarm-coordinator",
      confidence: 0.9,
      reason: "Swarm/multi-step pipeline coordination",
    })
    if (analysis.category === "general") {
      analysis.category = "planning"
    }
  }

  let confidence = 0.5
  if (analysis.category !== "general") confidence = 0.7
  if (recommendedAgents.length > 0) confidence = Math.min(1, confidence + 0.15)

  let reasoning = `Classified as "${analysis.category}"`
  if (analysis.subCategories.length > 0) {
    reasoning += ` (sub: ${analysis.subCategories.join(", ")})`
  }
  reasoning += `. Found ${recommendedAgents.length} agent(s) and ${recommendedSkills.length} skill(s).`
  if (isSwarm) {
    reasoning += ` Swarm pipeline detected — routed to swarm-coordinator.`
  }
  if (projectProfile) {
    reasoning += ` Project: ${projectProfile.projectName} (${projectProfile.languages.join(", ") || "unknown"})`
  }

  return {
    task: analysis.category,
    confidence: Math.round(confidence * 100) / 100,
    recommendedAgents,
    recommendedSkills,
    reasoning,
  }
}

function domainReason(domain: string): string {
  const reasons: Record<string, string> = {
    planning: "Planning and architecture task",
    review: "Code review or quality check",
    "build-fix": "Build or compilation error resolution",
    test: "Testing or TDD workflow",
    docs: "Documentation task",
    security: "Security review needed",
    refactor: "Refactoring or cleanup task",
    general: "General task",
  }
  return reasons[domain] || `Task domain: ${domain}`
}
