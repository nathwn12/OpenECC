// @bun
// src/plugin.ts
import { tool } from "@opencode-ai/plugin";
import * as path4 from "path";
import { fileURLToPath } from "url";
import * as fs4 from "fs";
import { execSync } from "child_process";

// src/routing/detect.ts
import * as fs from "fs";
import * as path from "path";
function hasFile(dir, ...names) {
  for (const name of names) {
    if (fs.existsSync(path.join(dir, name)))
      return true;
  }
  return false;
}
function detectLanguages(cwd) {
  const langs = [];
  if (hasFile(cwd, "tsconfig.json"))
    langs.push("typescript");
  if (fs.existsSync(path.join(cwd, "go.mod")))
    langs.push("go");
  if (fs.existsSync(path.join(cwd, "Cargo.toml")))
    langs.push("rust");
  if (fs.existsSync(path.join(cwd, "pyproject.toml")))
    langs.push("python");
  if (hasFile(cwd, "package.json"))
    langs.push("javascript");
  return langs;
}
function detectFrameworks(cwd) {
  const frameworks = [];
  if (hasFile(cwd, "next.config.js", "next.config.mjs", "next.config.ts"))
    frameworks.push("nextjs");
  if (hasFile(cwd, "angular.json"))
    frameworks.push("angular");
  if (hasFile(cwd, "svelte.config.js", "svelte.config.cjs"))
    frameworks.push("svelte");
  if (hasFile(cwd, "nuxt.config.js", "nuxt.config.ts"))
    frameworks.push("nuxt");
  if (hasFile(cwd, "gatsby-config.js", "gatsby-config.ts"))
    frameworks.push("gatsby");
  if (hasFile(cwd, "astro.config.mjs", "astro.config.ts"))
    frameworks.push("astro");
  return frameworks;
}
function detectTestFrameworks(cwd) {
  const frameworks = [];
  if (hasFile(cwd, "jest.config.js", "jest.config.ts", "jest.config.mjs"))
    frameworks.push("jest");
  if (hasFile(cwd, "vitest.config.js", "vitest.config.ts"))
    frameworks.push("vitest");
  if (hasFile(cwd, "playwright.config.ts", "playwright.config.js"))
    frameworks.push("playwright");
  if (hasFile(cwd, ".mocharc.js", ".mocharc.yml", ".mocharc.json"))
    frameworks.push("mocha");
  if (fs.existsSync(path.join(cwd, "pytest.ini")))
    frameworks.push("pytest");
  if (fs.existsSync(path.join(cwd, "go.mod")))
    frameworks.push("go test");
  return frameworks;
}
function detectDocker(cwd) {
  return hasFile(cwd, "Dockerfile", "docker-compose.yml", "docker-compose.yaml");
}
function detectCI(cwd) {
  if (fs.existsSync(path.join(cwd, ".github", "workflows")))
    return true;
  if (hasFile(cwd, ".gitlab-ci.yml", "Jenkinsfile"))
    return true;
  return false;
}
function detectPackageManager(cwd) {
  const lockfiles = {
    "bun.lock": "bun",
    "bun.lockb": "bun",
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "package-lock.json": "npm"
  };
  for (const [lock, name] of Object.entries(lockfiles)) {
    if (fs.existsSync(path.join(cwd, lock)))
      return name;
  }
  return "npm";
}
function detectFormatter(cwd) {
  if (hasFile(cwd, "biome.json", "biome.jsonc"))
    return "biome";
  if (hasFile(cwd, ".prettierrc", ".prettierrc.json", "prettier.config.js", ".prettierrc.yaml"))
    return "prettier";
  if (fs.existsSync(path.join(cwd, "pyproject.toml")))
    return "black";
  if (fs.existsSync(path.join(cwd, "go.mod")))
    return "gofmt";
  if (fs.existsSync(path.join(cwd, "Cargo.toml")))
    return "rustfmt";
  return null;
}
function detectLinter(cwd) {
  if (hasFile(cwd, "biome.json", "biome.jsonc"))
    return "biome";
  try {
    if (fs.readdirSync(cwd).some((f) => f.startsWith("eslint.config.")))
      return "eslint";
  } catch {}
  if (fs.existsSync(path.join(cwd, "go.mod")))
    return "golangci-lint";
  if (fs.existsSync(path.join(cwd, "Cargo.toml")))
    return "clippy";
  return null;
}
function detectProject(cwd) {
  let projectName = path.basename(cwd);
  try {
    const pkgRaw = fs.readFileSync(path.join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);
    if (pkg.name)
      projectName = pkg.name;
  } catch {}
  return {
    languages: detectLanguages(cwd),
    frameworks: detectFrameworks(cwd),
    testFrameworks: detectTestFrameworks(cwd),
    packageManager: detectPackageManager(cwd),
    formatter: detectFormatter(cwd),
    linter: detectLinter(cwd),
    hasDocker: detectDocker(cwd),
    hasCI: detectCI(cwd),
    projectName
  };
}

// src/routing/registry.ts
import * as fs2 from "fs";
import * as path2 from "path";
var AGENT_TRIGGERS = {
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
  "goal-evaluator": { domain: "evaluation", keywords: ["goal", "evaluate", "completion", "done check", "condition met", "acceptance criteria"], permissions: { edit: "deny", write: "deny", task: "deny", bash: "deny", glob: "deny", grep: "deny" } }
};
function buildAgentRegistry() {
  return { ...AGENT_TRIGGERS };
}
function parseYamlDescription(content) {
  const match = content.match(/^---\n(?:.*\n)*?description:\s*(.*?)\n(?:.*\n)*?---/);
  if (match)
    return match[1].trim();
  return "";
}
function buildSkillRegistry(skillsDir) {
  const registry = {};
  try {
    const entries = fs2.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue;
      const skillPath = path2.join(skillsDir, entry.name, "SKILL.md");
      if (!fs2.existsSync(skillPath))
        continue;
      const content = fs2.readFileSync(skillPath, "utf8");
      const description = parseYamlDescription(content);
      const body = content.replace(/^---[\s\S]*?---\n/, "");
      const bodyPreview = body.slice(0, 500).toLowerCase();
      const words = new Set;
      for (const word of description.toLowerCase().split(/[\s,]+/)) {
        if (word.length > 2)
          words.add(word);
      }
      for (const word of bodyPreview.split(/[\s,;:.!?()]+/)) {
        if (word.length > 3)
          words.add(word);
      }
      const domainKeywords = ["api", "backend", "frontend", "test", "security", "e2e", "coding", "refactor", "design", "docs"];
      let domain = "general";
      for (const dk of domainKeywords) {
        if (description.toLowerCase().includes(dk) || bodyPreview.includes(dk)) {
          domain = dk;
          break;
        }
      }
      registry[entry.name] = {
        domain,
        keywords: Array.from(words).slice(0, 30),
        description
      };
    }
  } catch {}
  return registry;
}
function tokenize(input) {
  return input.toLowerCase().split(/[\s,;:.!?()\[\]{}\\'"|/]+/).filter((w) => w.length > 1);
}
function scoreMatch(inputTokens, keywords) {
  if (keywords.length === 0)
    return 0;
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  const inputJoined = inputTokens.join(" ");
  const exactMatches = inputTokens.filter((t) => lowerKeywords.includes(t)).length;
  const phraseMatches = lowerKeywords.filter((k) => k.includes(" ") && inputJoined.includes(k)).length;
  const totalKeywords = keywords.length;
  return (exactMatches + phraseMatches) / Math.max(totalKeywords, 1);
}
function matchTriggers(input, projectProfile, agentRegistry, skillRegistry) {
  const tokens = tokenize(input);
  const inputLower = input.toLowerCase();
  const results = [];
  const langAgentMap = {
    go: ["go-reviewer", "go-build-resolver"],
    rust: ["rust-reviewer", "rust-build-resolver"],
    python: ["python-reviewer"],
    java: ["java-reviewer", "java-build-resolver"],
    kotlin: ["kotlin-reviewer", "kotlin-build-resolver"],
    cpp: ["cpp-reviewer", "cpp-build-resolver"]
  };
  const frameworkAgentMap = {
    nextjs: ["code-reviewer"],
    angular: ["code-reviewer"]
  };
  const testAgentMap = {
    jest: ["tdd-guide"],
    vitest: ["tdd-guide"],
    playwright: ["e2e-runner"]
  };
  for (const [name, trigger] of Object.entries(agentRegistry)) {
    let confidence = scoreMatch(tokens, trigger.keywords);
    if (trigger.keywords.some((k) => k.includes(" ") && inputLower.includes(k))) {
      confidence = Math.min(1, confidence + 0.2);
    }
    if (projectProfile) {
      for (const lang of projectProfile.languages) {
        if (langAgentMap[lang]?.includes(name)) {
          confidence = Math.min(1, confidence + 0.15);
        }
      }
      for (const fw of projectProfile.frameworks) {
        if (frameworkAgentMap[fw]?.includes(name)) {
          confidence = Math.min(1, confidence + 0.1);
        }
      }
      for (const tf of projectProfile.testFrameworks) {
        if (testAgentMap[tf]?.includes(name)) {
          confidence = Math.min(1, confidence + 0.15);
        }
      }
    }
    if (confidence > 0) {
      results.push({ name, type: "agent", confidence, domain: trigger.domain });
    }
  }
  for (const [name, trigger] of Object.entries(skillRegistry)) {
    let confidence = scoreMatch(tokens, trigger.keywords);
    if (confidence > 0) {
      results.push({ name, type: "skill", confidence, domain: trigger.domain });
    }
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return results.slice(0, 5);
}

// src/routing/classifier.ts
var PATTERNS = {
  planning: [/^(plan|design|architecture|how should|what's the best|think about|strategy)/i, /\/swarm/i, /\/make/i, /full pipeline/i, /end to end/i, /build and ship/i, /pipeline/i],
  review: [/(review|check|audit|look over|inspect)/i],
  "build-fix": [/(build error|compilation error|type error|doesn't compile|fails to build|build fail)/i],
  test: [/(test|spec|coverage|tdd|unit test|integration test)/i],
  docs: [/(document|readme|docs|api docs|explain how)/i],
  security: [/(security|vulnerability|owasp|injection|xss|csrf|auth|authentication)/i],
  debug: [/(debug|bug|not working|unexpected|broken|error|exception|doesn't work)/i],
  refactor: [/(refactor|clean up|restructure|technical debt|simplify|consolidate)/i],
  general: []
};
var SUB_CATEGORY_PATTERNS = {
  api: [/(api|endpoint|route|rest|graphql)/i],
  frontend: [/(ui|component|react|vue|angular|frontend|css|html)/i],
  backend: [/(backend|server|middleware|express|database|sql)/i],
  performance: [/(performance|slow|optimize|bottleneck|latency)/i],
  testing: [/(unit test|integration test|e2e|playwright|jest|vitest)/i],
  database: [/(database|sql|query|schema|migration|orm)/i],
  config: [/(config|configuration|setup|install|deploy)/i],
  dependency: [/(dependency|package|module|library|version)/i]
};
function analyzeTask(input) {
  let primary = "general";
  let highestScore = 0;
  for (const [cat, regexps] of Object.entries(PATTERNS)) {
    if (cat === "general")
      continue;
    let score = 0;
    for (const re of regexps) {
      const matches = input.match(re);
      if (matches)
        score += matches.length;
    }
    if (score > highestScore) {
      highestScore = score;
      primary = cat;
    }
  }
  const subCategories = [];
  for (const [sub, regexps] of Object.entries(SUB_CATEGORY_PATTERNS)) {
    for (const re of regexps) {
      if (re.test(input)) {
        subCategories.push(sub);
        break;
      }
    }
  }
  const keywords = input.toLowerCase().split(/[\s,;:.!?()]+/).filter((w) => w.length > 2);
  return { category: primary, subCategories, keywords };
}
function autoDelegate(input, projectProfile, agentRegistry, skillRegistry) {
  const analysis = analyzeTask(input);
  const matches = matchTriggers(input, projectProfile, agentRegistry, skillRegistry);
  const recommendedAgents = matches.filter((m) => m.type === "agent" && m.confidence > 0).map((m) => ({
    name: m.name,
    confidence: Math.round(m.confidence * 100) / 100,
    reason: domainReason(m.domain)
  }));
  const recommendedSkills = matches.filter((m) => m.type === "skill" && m.confidence > 0).map((m) => ({
    name: m.name,
    confidence: Math.round(m.confidence * 100) / 100,
    reason: `Matched task keywords: ${m.domain}`
  }));
  const SWARM_TRIGGERS = ["/swarm", "/make", "full pipeline", "pipeline", "end to end", "build and ship", "build & ship"];
  const isSwarm = SWARM_TRIGGERS.some((k) => input.toLowerCase().includes(k));
  if (isSwarm) {
    recommendedAgents.unshift({
      name: "swarm-coordinator",
      confidence: 0.9,
      reason: "Swarm/multi-step pipeline coordination"
    });
    if (analysis.category === "general") {
      analysis.category = "planning";
    }
  }
  let confidence = 0.5;
  if (analysis.category !== "general")
    confidence = 0.7;
  if (recommendedAgents.length > 0)
    confidence = Math.min(1, confidence + 0.15);
  let reasoning = `Classified as "${analysis.category}"`;
  if (analysis.subCategories.length > 0) {
    reasoning += ` (sub: ${analysis.subCategories.join(", ")})`;
  }
  reasoning += `. Found ${recommendedAgents.length} agent(s) and ${recommendedSkills.length} skill(s).`;
  if (isSwarm) {
    reasoning += ` Swarm pipeline detected \u2014 routed to swarm-coordinator.`;
  }
  if (projectProfile) {
    reasoning += ` Project: ${projectProfile.projectName} (${projectProfile.languages.join(", ") || "unknown"})`;
  }
  return {
    task: analysis.category,
    confidence: Math.round(confidence * 100) / 100,
    recommendedAgents,
    recommendedSkills,
    reasoning
  };
}
function domainReason(domain) {
  const reasons = {
    planning: "Planning and architecture task",
    review: "Code review or quality check",
    "build-fix": "Build or compilation error resolution",
    test: "Testing or TDD workflow",
    docs: "Documentation task",
    security: "Security review needed",
    refactor: "Refactoring or cleanup task",
    general: "General task"
  };
  return reasons[domain] || `Task domain: ${domain}`;
}

// src/constants.ts
var DELEGATION_ENFORCEMENT = `## OpenECC Delegation Enforcement (HARD RULES)

These are structural constraints, NOT suggestions. Violations are bugs.

### Tool Access Control \u2014 Main Context (TALK + DELEGATE only)
NEVER call these tools in main context. They must go through subagents:

| Tool | Correct Usage | Delegate To |
|------|--------------|-------------|
| \`edit\` | Changes source files | @builder or language-specific subagent |
| \`write\` | Creates/modifies files | @builder or language-specific subagent |
| \`bash\` | Runs commands | @executor or language-specific subagent |
| \`glob\` | Searches codebase | @explorer or task-specific subagent |
| \`grep\` | Searches file contents | @explorer or task-specific subagent |

### Self-Audit Before Every Tool Call
Before calling ANY tool, ask:
1. "Does this tool edit, write, or run commands?" \u2192 DELEGATE via \`task\` tool.
2. "Does this tool search source code?" \u2192 DELEGATE via \`task\` tool.
3. "Could a subagent do this in parallel while I handle something else?" \u2192 DELEGATE via \`task\` tool.
4. "Am I about to do work directly instead of delegating?" \u2192 STOP. Spawn a subagent.

If any answer is YES, use the \`task\` tool to spawn a subagent. No exceptions.`;
var TOOL_ACCESS_BLOCK = `<structured type="tool_access">
type: tool_access
rule: Main context is TALK + DELEGATE only. Tools are partitioned by context.
main_context_only:
  allowed: [task, skill, todowrite, question, read, webfetch]
  description: "Spawn subagents, load skills, track todos, gather context. NO source mutations."
subagent_only:
  allowed: [edit, write, bash, glob, grep]
  description: "All source code work. NEVER called in main context."
</structured>`;
var DELEGATOR_ROLE = `## Your Role (OpenECC Delegator)

Your primary job is to delegate, synthesize, and verify \u2014 not to do work directly.

### When to delegate to a subagent (@mention):
- Planning / architecture \u2192 @planner
- Code review / quality \u2192 @code-reviewer
- Security review \u2192 @security-reviewer
- Build/type errors \u2192 @build-error-resolver
- Test-first development \u2192 @tdd-guide
- E2E tests \u2192 @e2e-runner
- Documentation \u2192 @doc-updater / @docs-lookup
- Dead code cleanup \u2192 @refactor-cleaner
- Language-specific (Go/Rust/C++/Java/Kotlin/Python) \u2192 respective reviewer
- Complex multi-step tasks \u2192 @planner (orchestrate mode)

### When to load a skill:
- API design \u2192 skill tool \u2192 api-design
- Backend patterns \u2192 skill tool \u2192 backend-patterns
- Frontend patterns \u2192 skill tool \u2192 frontend-patterns
- Testing patterns \u2192 skill tool \u2192 tdd-workflow / e2e-testing
- Security review \u2192 skill tool \u2192 security-review

### When to answer directly:
- Simple factual questions
- Quick clarifications ("what is X?")
- Status checks
- Anything that requires zero tools

### Completion protocol:
1. **Verify before claiming** \u2014 run the command, read the output, then speak
2. **Synthesize** \u2014 distill subagent results into 3-5 sentences max
3. **Signature** \u2014 end with \`---\` and a brief status summary`;
var QUICK_ROUTING = `### Quick Routing
Task \u2192 Subagent:
  plan/architect   \u2192 @planner
  code review      \u2192 @code-reviewer
  security         \u2192 @security-reviewer
  build/type error \u2192 @build-error-resolver
  test-first/TDD   \u2192 @tdd-guide
  docs             \u2192 @doc-updater / @docs-lookup
  cleanup/refactor \u2192 @refactor-cleaner
  debug            \u2192 @build-error-resolver
  e2e              \u2192 @e2e-runner
  language-specific \u2192 <lang>-reviewer / <lang>-build-resolver
  complex multi    \u2192 @planner (orchestrate)

Skill \u2192 Task:
  api-design          \u2192 API routes, resources, pagination
  backend-patterns    \u2192 Node.js, Express, Next.js API
  frontend-patterns   \u2192 React, Next.js, state, UI
  tdd-workflow        \u2192 red-green-refactor, 80% coverage
  e2e-testing         \u2192 Playwright, Page Object Model
  security-review     \u2192 auth, input validation, secrets
  coding-standards    \u2192 naming, immutability, quality
  verification-loop   \u2192 build, types, lint, test, security
  strategic-compact   \u2192 context compaction strategy
  api-security        \u2192 authZ, rate limiting, OWASP`;
var COMPLETION_CONTRACT = `### Before responding
1. Did you delegate analysis/planning work to a subagent when appropriate?
2. Did you verify results (not assume)?
3. Is the response concise and synthesized?

When done: place \`---\` followed by \`**Status:** \u2705 Done | \u1F6A7 Blocked | \uD83D\uDD04 In Progress\``;

// src/utils.ts
import * as fs3 from "fs";
import * as path3 from "path";
function buildProjectProfileSection(p) {
  const lines = [];
  lines.push("### Project Profile (auto-detected)");
  if (p.languages.length > 0)
    lines.push(`- Languages: ${p.languages.join(", ")}`);
  if (p.frameworks.length > 0)
    lines.push(`- Frameworks: ${p.frameworks.join(", ")}`);
  if (p.testFrameworks.length > 0)
    lines.push(`- Test tools: ${p.testFrameworks.join(", ")}`);
  lines.push(`- Package manager: ${p.packageManager}`);
  lines.push("");
  const subagentLines = [];
  const langAgentMap = {
    go: ["go-reviewer", "go-build-resolver"],
    rust: ["rust-reviewer", "rust-build-resolver"],
    python: ["python-reviewer"],
    typescript: []
  };
  for (const lang of p.languages) {
    const agents = langAgentMap[lang] || [];
    for (const agent of agents) {
      subagentLines.push(`- @${agent} \u2014 ${lang} code detected`);
    }
  }
  for (const tf of p.testFrameworks) {
    if (tf === "jest" || tf === "vitest")
      subagentLines.push("- @tdd-guide \u2014 tests detected");
    if (tf === "playwright")
      subagentLines.push("- @e2e-runner \u2014 Playwright detected");
  }
  if (subagentLines.length > 0) {
    lines.push("### Priority Subagents");
    lines.push(...subagentLines);
    lines.push("");
  }
  const skillLines = [];
  for (const fw of p.frameworks) {
    if (fw === "nextjs")
      skillLines.push("- frontend-patterns \u2014 Next.js framework");
    if (fw === "angular")
      skillLines.push("- angular-best-practices \u2014 Angular framework");
  }
  if (p.testFrameworks.includes("playwright"))
    skillLines.push("- e2e-testing \u2014 Playwright detected");
  if (p.testFrameworks.some((t) => t === "jest" || t === "vitest"))
    skillLines.push("- tdd-workflow \u2014 tests detected");
  if (p.languages.some((l) => l === "javascript" || l === "typescript")) {
    skillLines.push("- backend-patterns \u2014 JS/TS backend support");
  }
  if (skillLines.length > 0) {
    lines.push("### Recommended Skills");
    lines.push(...skillLines);
    lines.push("");
  }
  lines.push("At the start of each significant task, use `auto-delegate` to get routing recommendations.");
  return lines.join(`
`);
}
function readFileSafe(filePath) {
  try {
    return fs3.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
function resolveProjectFile(worktreePath, relativePath) {
  try {
    return fs3.statSync(path3.join(worktreePath, relativePath)).isFile();
  } catch {
    return false;
  }
}
function stripYamlFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n/, "");
}
function detectPackageManager2(cwd) {
  const lockfiles = {
    "bun.lockb": "bun",
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "package-lock.json": "npm"
  };
  for (const [lock, name] of Object.entries(lockfiles)) {
    if (fs3.existsSync(path3.join(cwd, lock)))
      return name;
  }
  return "npm";
}
function detectFormatter2(cwd) {
  if (fs3.existsSync(path3.join(cwd, "biome.json")) || fs3.existsSync(path3.join(cwd, "biome.jsonc")))
    return "biome";
  if (fs3.existsSync(path3.join(cwd, ".prettierrc")) || fs3.existsSync(path3.join(cwd, ".prettierrc.json")) || fs3.existsSync(path3.join(cwd, "prettier.config.js")) || fs3.existsSync(path3.join(cwd, ".prettierrc.yaml")))
    return "prettier";
  if (fs3.existsSync(path3.join(cwd, "pyproject.toml")))
    return "black";
  if (fs3.existsSync(path3.join(cwd, "go.mod")))
    return "gofmt";
  if (fs3.existsSync(path3.join(cwd, "Cargo.toml")))
    return "rustfmt";
  return null;
}
function detectLinter2(cwd) {
  if (fs3.existsSync(path3.join(cwd, "biome.json")) || fs3.existsSync(path3.join(cwd, "biome.jsonc")))
    return "biome";
  try {
    if (fs3.readdirSync(cwd).some((f) => f.startsWith("eslint.config.")))
      return "eslint";
  } catch {}
  if (fs3.existsSync(path3.join(cwd, "go.mod")))
    return "golangci-lint";
  if (fs3.existsSync(path3.join(cwd, "Cargo.toml")))
    return "clippy";
  return null;
}

// src/plugin.ts
var __dirname2 = path4.dirname(fileURLToPath(import.meta.url));
var skillsDir = path4.resolve(__dirname2, "..", "skills");
var agentsDir = path4.resolve(__dirname2, "..", "prompts", "agents");
var commandsDir = path4.resolve(__dirname2, "..", "commands");
var agentsMDPath = path4.resolve(__dirname2, "..", "..", "AGENTS.md");
var _projectProfile = null;
var _skillRegistryCache = null;
var _delegationDepth = 0;
var _capturedResults = new Map;
var editedFiles = new Set;
var runTestsTool = tool({
  description: "Run the test suite with optional coverage, watch mode, or specific test patterns. Automatically detects package manager (npm, pnpm, yarn, bun) and test framework.",
  args: {
    pattern: tool.schema.string().optional().describe("Test file pattern or specific test name to run"),
    coverage: tool.schema.boolean().optional().describe("Run with coverage reporting"),
    watch: tool.schema.boolean().optional().describe("Run in watch mode")
  },
  async execute(args, context) {
    const cwd = context.worktree || context.directory;
    const pm = detectPackageManager2(cwd);
    const cmd = pm === "npm" ? `${pm} run test` : `${pm} test`;
    const flags = [];
    if (args.coverage)
      flags.push("--coverage");
    if (args.watch)
      flags.push("--watch");
    if (args.pattern)
      flags.push("--", ...args.pattern.split(/\s+/));
    return JSON.stringify({
      command: flags.length ? `${cmd} ${flags.join(" ")}` : cmd,
      packageManager: pm,
      instructions: `Run this command to execute tests:

${flags.length ? `${cmd} ${flags.join(" ")}` : cmd}`
    });
  }
});
var changedFilesTool = tool({
  description: "List files that have been created or modified during this session.",
  args: {},
  async execute(_args, _context) {
    return JSON.stringify({
      files: Array.from(editedFiles),
      count: editedFiles.size
    });
  }
});
var gitSummaryTool = tool({
  description: "Show git branch, status, recent commits, and staged/unstaged diffs for the current repository.",
  args: {},
  async execute(_args, context) {
    const cwd = context.worktree || context.directory;
    const result = {};
    try {
      result.branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf8", timeout: 3000 }).trim();
    } catch {
      result.branch = "(not a git repo)";
    }
    try {
      result.status = execSync("git status --short", { cwd, encoding: "utf8", timeout: 3000 }).trim();
    } catch {
      result.status = "";
    }
    try {
      const log = execSync("git log --oneline -5", { cwd, encoding: "utf8", timeout: 3000 }).trim();
      result.recentCommits = log;
    } catch {
      result.recentCommits = "";
    }
    try {
      const staged = execSync("git diff --cached --name-only", { cwd, encoding: "utf8", timeout: 3000 }).trim();
      result.stagedFiles = staged;
    } catch {
      result.stagedFiles = "";
    }
    try {
      const unstaged = execSync("git diff --name-only", { cwd, encoding: "utf8", timeout: 3000 }).trim();
      result.unstagedFiles = unstaged;
    } catch {
      result.unstagedFiles = "";
    }
    return JSON.stringify(result, null, 2);
  }
});
var formatCodeTool = tool({
  description: "Detect the code formatter (Biome, Prettier, Black, gofmt, rustfmt) and return the exact command to format the project.",
  args: {
    path: tool.schema.string().optional().describe("Specific file or directory to format"),
    check: tool.schema.boolean().optional().describe("Check mode (don't write, just report issues)")
  },
  async execute(args, context) {
    const cwd = context.worktree || context.directory;
    const formatter = detectFormatter2(cwd);
    const target = args.path || ".";
    const formatterCommands = {
      biome: { command: `npx biome format --write ${target}`, checkFlag: `npx biome format ${target}` },
      prettier: { command: `npx prettier --write ${target}`, checkFlag: `npx prettier --check ${target}` },
      black: { command: `black ${target}`, checkFlag: `black --check ${target}` },
      gofmt: { command: `gofmt -w ${target}`, checkFlag: `gofmt -d ${target}` },
      rustfmt: { command: `rustfmt ${target}`, checkFlag: `rustfmt --check ${target}` }
    };
    if (!formatter) {
      return JSON.stringify({
        detected: false,
        formatter: null,
        command: null,
        instructions: "No formatter config detected. Options: create biome.json, .prettierrc, or configure Black, gofmt, rustfmt."
      });
    }
    const entry = formatterCommands[formatter];
    return JSON.stringify({
      detected: true,
      formatter,
      command: args.check ? entry.checkFlag : entry.command,
      instructions: `Detected formatter: ${formatter}. Run: ${args.check ? entry.checkFlag : entry.command}`
    });
  }
});
var lintCheckTool = tool({
  description: "Detect the linter (ESLint, Biome, Ruff, Pylint, golangci-lint, Clippy) and build the run command.",
  args: {
    path: tool.schema.string().optional().describe("Specific file or directory to lint"),
    fix: tool.schema.boolean().optional().describe("Auto-fix issues when supported")
  },
  async execute(args, context) {
    const cwd = context.worktree || context.directory;
    const linter = detectLinter2(cwd);
    const target = args.path || ".";
    const linterCommands = {
      biome: { command: `npx biome lint ${target}`, fixFlag: `npx biome lint --fix ${target}` },
      eslint: { command: `npx eslint ${target}`, fixFlag: `npx eslint --fix ${target}` },
      golangci_lint: { command: `golangci-lint run ${target}`, fixFlag: `golangci-lint run --fix ${target}` },
      clippy: { command: `cargo clippy -- ${target}`, fixFlag: `cargo clippy --fix -- ${target}` }
    };
    if (!linter) {
      return JSON.stringify({
        detected: false,
        linter: null,
        command: null,
        instructions: "No linter config detected. Options: create biome.json, eslint.config.*, or configure golangci-lint, Clippy."
      });
    }
    const entry = linterCommands[linter];
    return JSON.stringify({
      detected: true,
      linter,
      command: args.fix ? entry.fixFlag : entry.command,
      instructions: `Detected linter: ${linter}. Run: ${args.fix ? entry.fixFlag : entry.command}`
    });
  }
});
var securityAuditTool = tool({
  description: "Run a three-phase security audit: dependency audit (npm audit), secret scanning (regex for API keys/tokens), and code anti-pattern detection (eval, innerHTML, SQL injection).",
  args: {},
  async execute(_args, context) {
    const cwd = context.worktree || context.directory;
    const report = [];
    const commands = [];
    report.push("# Security Audit Report");
    report.push("");
    const hasPackageJson = fs4.existsSync(path4.join(cwd, "package.json"));
    if (hasPackageJson) {
      report.push("## Phase 1: Dependency Audit");
      report.push("Run: `npm audit` to check for vulnerable dependencies");
      commands.push("npm audit --audit-level=high");
      report.push("");
    }
    report.push("## Phase 2: Secret Scanning");
    report.push("Run the following to scan for hardcoded secrets:");
    commands.push('Select-String -Pattern "api[_-]?key|sk-[A-Za-z0-9]|ghp_|gho_|ghu_|xox[abp]|AKIA[0-9A-Z]|-----BEGIN RSA PRIVATE KEY-----" -Path @(Get-ChildItem -Recurse -Include "*.ts","*.js","*.py","*.rs","*.go","*.java" -Exclude "*node_modules*") | Select-Object -First 30');
    report.push("");
    report.push("## Phase 3: Anti-Pattern Detection");
    report.push("Run the following to detect dangerous patterns:");
    commands.push('Select-String -Pattern "eval(|innerHTML|dangerouslySetInnerHTML|execSync|child_process|fromCharCode|document.write|new Function(" -Path @(Get-ChildItem -Recurse -Include "*.ts","*.tsx","*.js","*.jsx" -Exclude "*node_modules*") | Select-Object -First 20');
    commands.push("Get-ChildItem -Recurse -Include '*.ts','*.js' -Exclude '*node_modules*' | Select-String -Pattern 'req\\.(query|body|params)' | Select-Object -First 10");
    report.push("");
    report.push("## Commands to Run");
    commands.forEach((c) => report.push(`- \`${c}\``));
    report.push("");
    report.push("**IMPORTANT**: Review the output of each command. Fix CRITICAL issues before committing.");
    return JSON.stringify({
      commands,
      instructions: report.join(`
`)
    });
  }
});
var autoDelegateTool = tool({
  description: "Analyze a user message and recommend which subagent(s) and skill(s) to use. Calls the classification engine with project context for relevance scoring.",
  args: {
    message: tool.schema.string().describe("The user's task description or question"),
    as: tool.schema.string().optional().describe("Optional name to store this result under for later reference")
  },
  async execute(args, context) {
    _delegationDepth++;
    if (_delegationDepth >= 2) {
      return JSON.stringify({
        task: "general",
        confidence: 0,
        recommendedAgents: [],
        recommendedSkills: [],
        reasoning: "Loop guard active: delegation depth limit reached. Subagents cannot delegate further."
      }, null, 2);
    }
    const cwd = context.worktree || context.directory;
    const profile = detectProject(cwd);
    const agentRegistry = buildAgentRegistry();
    const skillRegistry = buildSkillRegistry(skillsDir);
    const result = autoDelegate(args.message, profile, agentRegistry, skillRegistry);
    if (args.as) {
      _capturedResults.set(args.as, result);
    }
    return JSON.stringify(result, null, 2);
  }
});
var analyzeTaskTool = tool({
  description: "Classify a user message into a task category and extract keywords. Does not use project context.",
  args: {
    message: tool.schema.string().describe("The user's task description or question")
  },
  async execute(args, _context) {
    const result = analyzeTask(args.message);
    return JSON.stringify(result, null, 2);
  }
});
var OpenECCPlugin = async ({ client, directory, $, worktree }) => {
  const worktreePath = worktree || directory;
  const agents = [
    { name: "planner", desc: "Expert planning specialist for complex features and refactoring. Use for implementation planning, architectural changes, or complex refactoring. Trigger: when a task needs structured planning before coding.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "architect", desc: "Software architecture specialist for system design, scalability, and technical decision-making. Use when evaluating architecture, designing systems, or making technical decisions. Trigger: when architecture review or design decisions are needed.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "code-reviewer", desc: "Expert code review specialist. Reviews code for quality, security, and maintainability. Use immediately after writing or modifying code. Trigger: when a file has been edited or written.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "security-reviewer", desc: "Security vulnerability detection and remediation specialist. Use after writing code that handles user input, authentication, API endpoints, or sensitive data. Trigger: when auth, input validation, secrets, or API security is involved.", permission: { task: "deny" } },
    { name: "tdd-guide", desc: "Test-Driven Development specialist enforcing write-tests-first methodology. Use when writing new features, fixing bugs, or refactoring code. Ensures 80%+ test coverage. Trigger: when a feature or bug fix needs tests.", permission: { task: "deny" } },
    { name: "build-error-resolver", desc: "Build and TypeScript error resolution specialist. Use when build fails or type errors occur. Fixes build/type errors only with minimal diffs. Trigger: when tsc, bundler, or runtime errors are present.", permission: { task: "deny" } },
    { name: "e2e-runner", desc: "End-to-end testing specialist using Playwright. Generates, maintains, and runs E2E tests for critical user flows. Use when E2E test coverage is needed. Trigger: when Playwright tests need creation, fixing, or maintenance.", permission: { task: "deny" } },
    { name: "doc-updater", desc: "Documentation and codemap specialist. Keeps docs in sync with code. Use after code changes to update README, API docs, and architecture docs. Trigger: when code changes affect public APIs, README, or architecture docs.", permission: { task: "deny" } },
    { name: "refactor-cleaner", desc: "Dead code cleanup and consolidation specialist. Removes unused code and consolidates duplicates without changing behavior. Use when the codebase has dead code or duplication. Trigger: when unused exports, dead parameters, or duplicates are found.", permission: { task: "deny" } },
    { name: "docs-lookup", desc: "Documentation specialist using web fetch and MCP to research current library/API documentation. Use when you need up-to-date docs for a library, API, or framework. Trigger: when library documentation or API reference lookups are needed.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "harness-optimizer", desc: "Analyzes and improves agent harness configuration for reliability, cost, and throughput. Use to audit and optimize harness setups. Trigger: when harness configuration needs review or optimization.", permission: { task: "deny" } },
    { name: "loop-operator", desc: "Operates autonomous agent loops, monitors progress, and intervenes safely when stuck. Use for long-running multi-iteration tasks. Trigger: when an autonomous multi-step loop needs operation and monitoring.", permission: { task: "deny" } },
    { name: "go-reviewer", desc: "Go code reviewer specializing in idiomatic Go, concurrency patterns, and error handling. Use after writing Go code. Trigger: when Go code has been written or modified.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "go-build-resolver", desc: "Go build and vet error resolution specialist. Use when `go build` or `go vet` fails. Fixes with minimal changes. Trigger: when Go compilation or vet errors occur.", permission: { task: "deny" } },
    { name: "python-reviewer", desc: "Python code reviewer specializing in PEP 8, type hints, security, and performance. Use after writing Python code. Trigger: when Python code has been written or modified.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "rust-reviewer", desc: "Rust code reviewer specializing in ownership, lifetimes, concurrency, and safety. Use after writing Rust code. Trigger: when Rust code has been written or modified.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "rust-build-resolver", desc: "Rust build and Cargo error resolution specialist. Use when `cargo check`, `build`, or `test` fails. Fixes with minimal changes. Trigger: when Rust compilation or test errors occur.", permission: { task: "deny" } },
    { name: "cpp-reviewer", desc: "C++ code reviewer specializing in memory safety, modern C++, and performance. Use after writing C++ code. Trigger: when C++ code has been written or modified.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "cpp-build-resolver", desc: "C++ build and CMake error resolution specialist. Use when C++ or CMake builds fail. Fixes linker, template, and configuration errors with minimal changes. Trigger: when C++ compilation, linking, or CMake errors occur.", permission: { task: "deny" } },
    { name: "java-reviewer", desc: "Java and Spring Boot reviewer specializing in layered architecture, JPA, and security. Use after writing Java/Spring code. Trigger: when Java or Spring Boot code has been written or modified.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "java-build-resolver", desc: "Java/Maven/Gradle build error resolution specialist. Use when Java build or tests fail. Fixes with minimal changes. Trigger: when Java compilation, Maven, or Gradle errors occur.", permission: { task: "deny" } },
    { name: "kotlin-reviewer", desc: "Kotlin and Android reviewer specializing in coroutines, Jetpack Compose, and idiomatic patterns. Use after writing Kotlin/Android code. Trigger: when Kotlin or Android code has been written or modified.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "kotlin-build-resolver", desc: "Kotlin/Gradle build error resolution specialist. Use when Kotlin or Gradle builds fail. Fixes with minimal changes. Trigger: when Kotlin compilation or Gradle configuration errors occur.", permission: { task: "deny" } },
    { name: "database-reviewer", desc: "PostgreSQL and Supabase database specialist for query optimization, schema design, and security. Use after writing database queries, migrations, or RLS policies. Trigger: when SQL queries, schema changes, or RLS policies need review.", permission: { task: "deny" } },
    { name: "swarm-coordinator", desc: "Orchestrates full engineering pipeline: think \u2192 plan \u2192 review \u2192 build \u2192 test \u2192 ship \u2192 reflect. Spawns and coordinates multiple subagents in parallel. Hard max 5 live subagents. Use for end-to-end feature delivery. Trigger: when a complete engineering pipeline is needed from ideation to ship.", permission: { edit: "deny", write: "deny" } },
    { name: "plan-ceo-reviewer", desc: "Reviews implementation plans from business/product perspective. Returns structured feedback: Block (critical issue), Warn (risky), Suggest (improvement), Questions (clarifications needed). Use when a plan needs business viability or product alignment review. Trigger: when a plan has been created and needs business/product review.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "plan-design-reviewer", desc: "Reviews implementation plans from UX/design perspective. Returns structured feedback: Block (critical issue), Warn (risky), Suggest (improvement), Questions (clarifications needed). Use when a plan needs UX or design review. Trigger: when a plan has been created and needs design review.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "plan-devex-reviewer", desc: "Reviews implementation plans from developer experience perspective. Returns structured feedback: Block (critical issue), Warn (risky), Suggest (improvement), Questions (clarifications needed). Use when a plan needs DX/API ergonomics review. Trigger: when a plan has been created and needs developer experience review.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "plan-eng-reviewer", desc: "Reviews implementation plans from engineering/architecture perspective. Returns structured feedback: Block (critical issue), Warn (risky), Suggest (improvement), Questions (clarifications needed). Use when a plan needs technical architecture or engineering review. Trigger: when a plan has been created and needs engineering review.", permission: { edit: "deny", write: "deny", task: "deny" } },
    { name: "goal-evaluator", desc: "Evaluates whether a swarm session goal has been met based on conversation context. Read-only: does not run commands or read files. Returns Met | Not Met | Partial with evidence and recommendations. Use as the completion gate in the /swarm pipeline. Trigger: after build and review phases to determine if the goal condition is satisfied.", permission: { edit: "deny", write: "deny", bash: "deny", glob: "deny", grep: "deny", task: "deny" } }
  ];
  const commands = [
    { name: "plan", desc: "Create a detailed implementation plan for complex features or refactoring", agent: "planner", subtask: true },
    { name: "code-review", desc: "Review code for quality, security, and maintainability", agent: "code-reviewer", subtask: true },
    { name: "security", desc: "Run comprehensive security review using OWASP guidelines", agent: "security-reviewer", subtask: true },
    { name: "tdd", desc: "Enforce TDD workflow with 80%+ test coverage", agent: "tdd-guide", subtask: true },
    { name: "quality-gate", desc: "Run quality pipeline: format, lint, type-check, test, security scan", subtask: false },
    { name: "build-fix", desc: "Fix build and TypeScript errors with minimal changes", agent: "build-error-resolver", subtask: true },
    { name: "e2e", desc: "Generate and run E2E tests with Playwright", agent: "e2e-runner", subtask: true },
    { name: "refactor-clean", desc: "Remove dead code and consolidate duplicates", agent: "refactor-cleaner", subtask: true },
    { name: "orchestrate", desc: "Orchestrate multiple agents for complex tasks", agent: "planner", subtask: true },
    { name: "update-docs", desc: "Update documentation to reflect current codebase", agent: "doc-updater", subtask: true },
    { name: "update-codemaps", desc: "Update codemaps to reflect current architecture", agent: "doc-updater", subtask: true },
    { name: "test-coverage", desc: "Analyze and improve test coverage", agent: "tdd-guide", subtask: true },
    { name: "learn", desc: "Extract patterns and learnings from current session" },
    { name: "checkpoint", desc: "Save verification state and progress checkpoint" },
    { name: "verify", desc: "Run verification loop: build, lint, test, security" },
    { name: "eval", desc: "Run evaluation against acceptance criteria" },
    { name: "setup-pm", desc: "Configure package manager for the project" },
    { name: "go-review", desc: "Review Go code for idiomatic patterns and correctness", agent: "go-reviewer", subtask: true },
    { name: "go-test", desc: "Run Go TDD workflow", agent: "tdd-guide", subtask: true },
    { name: "go-build", desc: "Fix Go build and vet errors", agent: "go-build-resolver", subtask: true },
    { name: "rust-review", desc: "Review Rust code for safety and correctness", agent: "rust-reviewer", subtask: true },
    { name: "rust-test", desc: "Run Rust TDD workflow", agent: "tdd-guide", subtask: true },
    { name: "rust-build", desc: "Fix Rust build and Cargo errors", agent: "rust-build-resolver", subtask: true },
    { name: "security-scan", desc: "Run dependency, secret, and anti-pattern scan" },
    { name: "harness-audit", desc: "Audit harness configuration quality and coverage" },
    { name: "loop-start", desc: "Start autonomous agent loop with safety defaults" },
    { name: "loop-status", desc: "Check autonomous loop status and progress" },
    { name: "skill-create", desc: "Generate skill files from git history patterns" },
    { name: "instinct-status", desc: "View learned instinct patterns" },
    { name: "instinct-import", desc: "Import instincts from a file" },
    { name: "instinct-export", desc: "Export instincts to a file" },
    { name: "evolve", desc: "Cluster instincts into reusable skills" },
    { name: "promote", desc: "Promote project instincts to global scope" },
    { name: "projects", desc: "List known projects and instinct statistics" },
    { name: "swarm", desc: "Execute full engineering pipeline: think \u2192 plan \u2192 review \u2192 build \u2192 test \u2192 evaluate \u2192 ship \u2192 reflect. Coordinates multiple subagents via the swarm-coordinator. The /swarm argument IS the goal condition, evaluated by goal-evaluator before shipping.", agent: "swarm-coordinator", subtask: true },
    { name: "make", desc: "Alias for /swarm. Execute full engineering pipeline end-to-end.", agent: "swarm-coordinator", subtask: true }
  ];
  return {
    "tool.definition": async (input, output) => {
      if (input.toolID === "edit" || input.toolID === "write") {
        output.description = `[OPENECC ENFORCEMENT] This tool MUST be called inside a subagent, not in main context. Delegate via \`task\` tool to @builder or language-specific subagent. Rule: no direct work in main context. | ${output.description}`;
      }
      if (input.toolID === "glob" || input.toolID === "grep") {
        output.description = `[OPENECC ENFORCEMENT] Source code search must be delegated to a subagent. In main context, delegate via \`task\` tool. Rule: main context is TALK + DELEGATE only. | ${output.description}`;
      }
      if (input.toolID === "bash") {
        output.description = `[OPENECC ENFORCEMENT] All commands must run inside a subagent. In main context, delegate via \`task\` tool to @executor or language-specific subagent. Rule: no commands in main context. | ${output.description}`;
      }
    },
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
      config.instructions = config.instructions || [];
      const agentsMDAbs = agentsMDPath;
      if (!config.instructions.some((i) => i === agentsMDAbs)) {
        config.instructions.push(agentsMDAbs);
      }
      config.agent = config.agent || {};
      for (const agent of agents) {
        if (!config.agent[agent.name]) {
          const prompt = readFileSafe(path4.join(agentsDir, `${agent.name}.txt`));
          if (prompt) {
            const agentConfig = {
              description: agent.desc,
              mode: "subagent",
              prompt
            };
            if (agent.permission) {
              agentConfig.permission = agent.permission;
            }
            config.agent[agent.name] = agentConfig;
          }
        }
      }
      config.command = config.command || {};
      for (const cmd of commands) {
        if (!config.command[cmd.name]) {
          const templateContent = readFileSafe(path4.join(commandsDir, `${cmd.name}.md`));
          const cleanTemplate = stripYamlFrontmatter(templateContent);
          if (cleanTemplate) {
            config.command[cmd.name] = {
              description: cmd.desc,
              template: `${cleanTemplate}

$ARGUMENTS`,
              ...cmd.agent ? { agent: cmd.agent } : {},
              ...cmd.subtask ? { subtask: true } : {}
            };
          }
        }
      }
    },
    "experimental.chat.system.transform": async (_input, output) => {
      if (!_projectProfile) {
        _projectProfile = detectProject(worktreePath);
      }
      const soulPath = path4.join(skillsDir, "soul", "SKILL.md");
      const soulContent = readFileSafe(soulPath);
      const cleanSoul = soulContent.replace(/^---[\s\S]*?---\n/, "");
      const systemBootstrap = `<EXTREMELY_IMPORTANT>
You have a soul \u2014 the principles below are always active. They are ALREADY LOADED.

${cleanSoul}
</EXTREMELY_IMPORTANT>

${DELEGATOR_ROLE}

${DELEGATION_ENFORCEMENT}

${TOOL_ACCESS_BLOCK}

${QUICK_ROUTING}

${COMPLETION_CONTRACT}

${buildProjectProfileSection(_projectProfile)}`;
      const systemMessages = output.systemMessages || [];
      if (!systemMessages.some((p) => p.text?.includes("EXTREMELY_IMPORTANT"))) {
        systemMessages.unshift({ type: "text", text: systemBootstrap });
        output.systemMessages = systemMessages;
      }
      try {
        const openeccDir = path4.join(worktreePath, ".openecc");
        const indexJsonPath = path4.join(openeccDir, "index.json");
        if (!fs4.existsSync(openeccDir))
          fs4.mkdirSync(openeccDir, { recursive: true });
        if (!fs4.existsSync(indexJsonPath)) {
          fs4.writeFileSync(indexJsonPath, JSON.stringify({ nextId: 1, activePlanId: null, plans: [] }, null, 2));
        }
        const indexData = JSON.parse(fs4.readFileSync(indexJsonPath, "utf8"));
        const activeId = indexData.activePlanId;
        const activePlan = indexData.plans?.find((p) => p.id === activeId);
        if (activePlan) {
          const planBlock = `<structured type="plan_state">
active_plan: ${activePlan.id}
status: ${activePlan.status || "unknown"}
done: ${activePlan.done ?? 0}
total: ${activePlan.total ?? 0}
goal: ${activePlan.summary || ""}
</structured>`;
          if (!systemMessages.some((p) => p.text?.includes("plan_state"))) {
            systemMessages.push({ type: "text", text: planBlock });
            output.systemMessages = systemMessages;
          }
        }
      } catch {}
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages?.length)
        return;
      const firstUser = output.messages.find((m) => m.info?.role === "user");
      if (!firstUser || !firstUser.parts?.length)
        return;
      if (firstUser.parts.some((p) => p.type === "text" && p.text?.includes("EXTREMELY_IMPORTANT")))
        return;
      if (!_skillRegistryCache) {
        _skillRegistryCache = buildSkillRegistry(skillsDir);
      }
      const firstTextPart = firstUser.parts.find((p) => p.type === "text");
      const firstUserText = firstTextPart?.text || "";
      if (firstUserText.length >= 2000)
        return;
      const taskAnalysis = analyzeTask(firstUserText.slice(0, 500));
      if (taskAnalysis.category === "general")
        return;
      const skillEntries = Object.entries(_skillRegistryCache);
      const matchResults = skillEntries.map(([name, trigger]) => {
        const tokens = firstUserText.toLowerCase().split(/[\s,;:.!?()]+/).filter((w) => w.length > 1);
        const lowerKeywords = trigger.keywords.map((k) => k.toLowerCase());
        const matches = tokens.filter((t) => lowerKeywords.includes(t)).length;
        const confidence = trigger.keywords.length > 0 ? matches / Math.max(trigger.keywords.length, 1) : 0;
        return { name, confidence, trigger };
      });
      matchResults.sort((a, b) => b.confidence - a.confidence);
      const topSkill = matchResults[0];
      if (!topSkill || topSkill.confidence < 0.7)
        return;
      const skillPath = path4.join(skillsDir, topSkill.name, "SKILL.md");
      const skillContent = readFileSafe(skillPath);
      const cleanContent = stripYamlFrontmatter(skillContent);
      if (!cleanContent)
        return;
      const autoLoadedSkill = `
### Auto-Loaded Skill: ${topSkill.name}
(injected based on task analysis)
${cleanContent.slice(0, 3000)}
`;
      firstUser.parts.unshift({
        type: "text",
        text: autoLoadedSkill,
        id: firstUser.parts[0].id,
        sessionID: firstUser.parts[0].sessionID,
        messageID: firstUser.parts[0].messageID
      });
    },
    "experimental.session.compacting": async (_input, output) => {
      output.context.push("# OpenECC Context (preserve across compaction)");
      output.context.push("");
      output.context.push("## OpenECC Delegator");
      output.context.push("- Primary role: delegate to subagents, synthesize results, verify before claiming");
      output.context.push("- Soul: Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution");
      output.context.push("- Route by task type: planning, review, build-fix, TDD, docs, language-specific");
      output.context.push("- Answer directly when no tools are needed");
      output.context.push("");
      if (_projectProfile) {
        output.context.push("## Project Profile");
        output.context.push(`- Languages: ${_projectProfile.languages.join(", ") || "none detected"}`);
        if (_projectProfile.frameworks.length > 0) {
          output.context.push(`- Frameworks: ${_projectProfile.frameworks.join(", ")}`);
        }
        if (_projectProfile.testFrameworks.length > 0) {
          output.context.push(`- Test tools: ${_projectProfile.testFrameworks.join(", ")}`);
        }
        output.context.push(`- Package manager: ${_projectProfile.packageManager}`);
        output.context.push("");
      }
      if (_capturedResults.size > 0) {
        output.context.push("## Captured Delegation Results");
        for (const [name] of _capturedResults) {
          output.context.push(`- ${name}: available`);
        }
        output.context.push("");
      }
      if (editedFiles.size > 0) {
        output.context.push("## Recently Edited Files");
        for (const f of editedFiles)
          output.context.push(`- ${f}`);
        output.context.push("");
      }
    },
    "file.edited": async (event) => {
      editedFiles.add(event.path);
      if (event.path.match(/\.(ts|tsx|js|jsx)$/)) {
        try {
          const content = fs4.readFileSync(event.path, "utf-8");
          const matches = content.match(/console\.log/g);
          if (matches) {
            await client.app.log({
              body: {
                service: "openecc",
                level: "warn",
                message: `console.log found in ${event.path} (${matches.length} occurrence${matches.length > 1 ? "s" : ""})`
              }
            });
          }
        } catch {}
      }
    },
    "tool.execute.after": async (input, _output) => {
      const filePath = input.args?.filePath;
      if ((input.tool === "edit" || input.tool === "write") && filePath) {
        editedFiles.add(filePath);
      }
    },
    "session.idle": async () => {
      _delegationDepth = 0;
      if (editedFiles.size === 0)
        return;
      let count = 0;
      const files = [];
      for (const file of editedFiles) {
        if (!file.match(/\.(ts|tsx|js|jsx)$/))
          continue;
        try {
          const content = fs4.readFileSync(file, "utf-8");
          const matches = content.match(/console\.log/g);
          const n = matches ? matches.length : 0;
          if (n > 0) {
            count += n;
            files.push(file);
          }
        } catch {}
      }
      if (count > 0) {
        await client.app.log({
          body: {
            service: "openecc",
            level: "warn",
            message: `Session idle audit: ${count} console.log(s) in ${files.length} file(s). Remove before committing.`
          }
        });
      }
      editedFiles.clear();
    },
    "session.deleted": async () => {
      editedFiles.clear();
    },
    "shell.env": async (_input, output) => {
      output.env.ECC_VERSION = "1.0.0";
      output.env.ECC_PLUGIN = "true";
      output.env.PROJECT_ROOT = worktreePath;
      const pm = detectPackageManager2(worktreePath);
      if (pm)
        output.env.PACKAGE_MANAGER = pm;
      const langDetectors = {
        "tsconfig.json": "typescript",
        "go.mod": "go",
        "pyproject.toml": "python",
        "Cargo.toml": "rust"
      };
      const detected = [];
      for (const [file, lang] of Object.entries(langDetectors)) {
        if (resolveProjectFile(worktreePath, file))
          detected.push(lang);
      }
      if (detected.length > 0) {
        output.env.DETECTED_LANGUAGES = detected.join(",");
        output.env.PRIMARY_LANGUAGE = detected[0];
      }
    },
    tool: {
      "run-tests": runTestsTool,
      "changed-files": changedFilesTool,
      "git-summary": gitSummaryTool,
      "format-code": formatCodeTool,
      "lint-check": lintCheckTool,
      "security-audit": securityAuditTool,
      "auto-delegate": autoDelegateTool,
      "analyze-task": analyzeTaskTool
    }
  };
};
var plugin_default = OpenECCPlugin;
export {
  plugin_default as default,
  OpenECCPlugin
};
