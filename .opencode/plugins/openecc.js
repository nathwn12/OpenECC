// @bun
// src/plugin.ts
import * as path3 from "path";
import * as fs3 from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/plan-gate.ts
import * as fs2 from "fs";
import * as os from "os";
import * as path2 from "path";

// src/identity.ts
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
var __dirname2 = path.dirname(fileURLToPath(import.meta.url));
var _version = null;
var _pkgInfo = null;
function findPackageRoot(fromDir) {
  let current = fromDir;
  for (let i = 0;i < 5; i++) {
    const pj = path.join(current, "package.json");
    if (fs.existsSync(pj)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pj, "utf8"));
        if (pkg.name === "openecc")
          return current;
      } catch {}
    }
    const parent = path.resolve(current, "..");
    if (parent === current)
      break;
    current = parent;
  }
  return null;
}
function getOpenEccVersion() {
  if (_version)
    return _version;
  try {
    const pkgRoot = findPackageRoot(__dirname2) ?? findPackageRoot(path.resolve(__dirname2, "..")) ?? path.resolve(__dirname2, "..");
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
    _version = pkg.version ?? null;
  } catch {}
  return _version ?? "0.0.0";
}
function getPackageInfo() {
  if (_pkgInfo)
    return _pkgInfo;
  const root = findPackageRoot(__dirname2) ?? findPackageRoot(path.resolve(__dirname2, "..")) ?? path.resolve(__dirname2, "..");
  const version = getOpenEccVersion();
  const skillsDir = path.join(root, ".opencode", "skills");
  _pkgInfo = { version, root, skillsDir };
  return _pkgInfo;
}

// src/plan-gate.ts
var VALID_TRANSITIONS = {
  draft: ["reviewed", "abandoned"],
  reviewed: ["ready", "approved", "draft", "abandoned"],
  ready: ["in_progress", "abandoned"],
  approved: ["in_progress", "abandoned"],
  in_progress: ["done", "blocked", "abandoned"],
  blocked: ["draft", "abandoned"],
  done: [],
  abandoned: []
};
function validatePlanTransition(current, next) {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed)
    return false;
  return allowed.includes(next);
}
function openeccDir(worktreePath) {
  return path2.join(worktreePath, ".openecc");
}
function indexJsonPath(worktreePath) {
  return path2.join(openeccDir(worktreePath), "index.json");
}
function planYamlPath(worktreePath, planId) {
  return path2.join(openeccDir(worktreePath), `${planId}.yaml`);
}
function readPlanFile(worktreePath, planId) {
  try {
    const f = planYamlPath(worktreePath, planId);
    if (!fs2.existsSync(f))
      return null;
    const raw = fs2.readFileSync(f, "utf8");
    return parsePlanYaml(raw);
  } catch {
    return null;
  }
}
function writePlanFile(worktreePath, plan) {
  const yaml = serializePlanYaml(plan);
  const f = planYamlPath(worktreePath, plan.id);
  const dir = path2.dirname(f);
  if (!fs2.existsSync(dir))
    fs2.mkdirSync(dir, { recursive: true });
  const tmp = f + ".tmp";
  fs2.writeFileSync(tmp, yaml, "utf8");
  fs2.renameSync(tmp, f);
}
function readPlanIndex(worktreePath) {
  try {
    const f = indexJsonPath(worktreePath);
    if (!fs2.existsSync(f))
      return null;
    const raw = JSON.parse(fs2.readFileSync(f, "utf8"));
    if (raw.schemaVersion === 3)
      return raw;
    return migrateOpeneccState(worktreePath);
  } catch {
    return null;
  }
}
function writePlanIndex(worktreePath, index) {
  const f = indexJsonPath(worktreePath);
  const dir = path2.dirname(f);
  if (!fs2.existsSync(dir))
    fs2.mkdirSync(dir, { recursive: true });
  const tmp = f + ".tmp";
  fs2.writeFileSync(tmp, JSON.stringify(index, null, 2), "utf8");
  fs2.renameSync(tmp, f);
}
function migrateOpeneccState(worktreePath) {
  try {
    const d = openeccDir(worktreePath);
    if (!fs2.existsSync(d))
      return null;
    const old = fs2.readdirSync(d).filter((f) => /^plan-\d+\.yaml$/.test(f));
    for (const f of old)
      fs2.unlinkSync(path2.join(d, f));
    const fresh = {
      openeccVersion: getOpenEccVersion(),
      schemaVersion: 3,
      projectDir: worktreePath,
      projectName: path2.basename(worktreePath),
      updatedAt: new Date().toISOString(),
      activePlanId: null,
      plans: []
    };
    writePlanIndex(worktreePath, fresh);
    return fresh;
  } catch {
    return null;
  }
}
function getActivePlan(worktreePath) {
  const idx = readPlanIndex(worktreePath);
  if (!idx || idx.activePlanId === null)
    return null;
  return idx.plans.find((p) => p.id === idx.activePlanId) ?? null;
}
function now() {
  return new Date().toISOString();
}
function nextPlanId(idx) {
  const maxN = idx.plans.reduce((m, p) => {
    const n = parseInt(p.id.replace("plan-", ""), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return `plan-${String(maxN + 1).padStart(3, "0")}`;
}
function assessPlanQuality(plan) {
  const report = [];
  let score = 0;
  if (plan.goal && plan.goal.length >= 10) {
    score += 10;
  } else {
    report.push("Goal is too short or missing (max -10)");
  }
  if (plan.check && plan.check.length >= 5) {
    score += 15;
  } else {
    report.push("Check/completion criteria is missing or too short (max -15)");
  }
  if (plan.tasks.length > 0)
    score += 10;
  if (plan.tasks.length >= 2)
    score += 8;
  if (plan.tasks.length >= 3)
    score += 7;
  const tasksWithVer = plan.tasks.filter((t) => t.verification?.trim());
  score += Math.round(tasksWithVer.length / Math.max(plan.tasks.length, 1) * 20);
  if (!detectCycle(plan.tasks)) {
    score += 10;
  } else {
    report.push("Task dependencies contain a cycle (max -10)");
  }
  const tasksWithFiles = plan.tasks.filter((t) => t.files.length > 0);
  score += Math.min(tasksWithFiles.length * 3, 10);
  if (plan.tasks.length <= 12) {
    score += 10;
  } else {
    report.push(`Too many tasks: ${plan.tasks.length} (max 12) (max -10)`);
  }
  return { score, report };
}
function detectCycle(tasks) {
  const adj = new Map;
  for (const t of tasks)
    adj.set(t.id, t.depends_on);
  const visited = new Set;
  const inStack = new Set;
  function dfs(id) {
    if (inStack.has(id))
      return true;
    if (visited.has(id))
      return false;
    visited.add(id);
    inStack.add(id);
    for (const dep of adj.get(id) || []) {
      if (dfs(dep))
        return true;
    }
    inStack.delete(id);
    return false;
  }
  for (const t of tasks) {
    if (dfs(t.id))
      return true;
  }
  return false;
}
var COMPLEX_PATTERNS = [
  "refactor",
  "migrate",
  "rewrite",
  "architecture",
  "restructure",
  "redesign",
  "overhaul",
  "reorganize",
  "rearchitect"
];
var TRIVIAL_PATTERNS = [
  "typo",
  "semicolon",
  "rename",
  "format",
  "comment",
  "spelling"
];
function isComplexTask(text) {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((t) => COMPLEX_PATTERNS.includes(t));
}
function isTrivialTask(text) {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (text.length < 20)
    return true;
  return tokens.some((t) => TRIVIAL_PATTERNS.includes(t));
}
function classifyTaskScope(text) {
  if (isComplexTask(text))
    return "complex";
  if (isTrivialTask(text))
    return "trivial";
  return "lightweight";
}
function buildPlanStub(worktreePath) {
  const idx = readPlanIndex(worktreePath) || {
    openeccVersion: getOpenEccVersion(),
    schemaVersion: 3,
    projectDir: worktreePath,
    projectName: path2.basename(worktreePath),
    updatedAt: now(),
    activePlanId: null,
    plans: []
  };
  return { idx };
}
function createPlan(worktreePath, input) {
  try {
    const { idx } = buildPlanStub(worktreePath);
    const pid = nextPlanId(idx);
    const ts = now();
    const status = input.status || "approved";
    const tasks = (input.tasks || []).map((t, i) => ({
      id: `task-${String(i + 1).padStart(3, "0")}`,
      summary: t.summary,
      status: t.status || "pending",
      files: t.files || [],
      depends_on: t.depends_on || [],
      effort: t.effort,
      verification: t.verification
    }));
    const summary = input.summary.length > 80 ? input.summary.slice(0, 77) + "..." : input.summary;
    const planData = {
      schema: "openecc/plan-v1",
      id: pid,
      version: 1,
      createdAt: ts,
      updatedAt: ts,
      status,
      parent: input.parent || null,
      goal: input.goal || summary,
      check: input.check || "TBD",
      summary,
      tasks,
      plan_notes: input.plan_notes || [],
      plannerMode: input.plannerMode,
      plannerSource: input.plannerSource
    };
    writePlanFile(worktreePath, planData);
    const total = tasks.length;
    const entry = {
      id: pid,
      status,
      createdAt: ts,
      updatedAt: ts,
      parent: input.parent,
      summary,
      total,
      completed: 0,
      blocked: 0,
      file: `${pid}.yaml`,
      plannerMode: input.plannerMode,
      plannerSource: input.plannerSource
    };
    idx.plans.push(entry);
    idx.activePlanId = pid;
    idx.updatedAt = ts;
    writePlanIndex(worktreePath, idx);
    return { id: pid, summary, plan: planData };
  } catch {
    return null;
  }
}
function createBuiltinPlan(worktreePath, goal, source = "auto") {
  const summary = goal.length > 80 ? goal.slice(0, 77) + "..." : goal;
  const truncatedGoal = goal.length > 200 ? goal.slice(0, 197) + "..." : goal;
  return createPlan(worktreePath, {
    summary,
    goal: truncatedGoal,
    status: "approved",
    tasks: [
      {
        summary: `Confirm the smallest scope for: ${goal.length > 60 ? goal.slice(0, 57) + "..." : goal}`,
        status: "pending",
        depends_on: [],
        effort: "2min"
      },
      {
        summary: "Implement the change in the primary file or module",
        status: "pending",
        depends_on: ["task-001"],
        effort: "5min"
      },
      {
        summary: "Verify the result with a focused test or manual check",
        status: "pending",
        depends_on: ["task-002"],
        effort: "3min",
        verification: "bun test or relevant verification"
      }
    ],
    plannerMode: "builtin",
    plannerSource: source
  });
}
function updatePlanStatus(worktreePath, id, newStatus, updates) {
  const idx = readPlanIndex(worktreePath);
  if (!idx)
    return "No plan index found";
  const entry = idx.plans.find((p) => p.id === id);
  if (!entry)
    return `Plan ${id} not found`;
  if (!validatePlanTransition(entry.status, newStatus)) {
    return `Invalid transition: ${entry.status} \u2192 ${newStatus}. Valid: ${(VALID_TRANSITIONS[entry.status] || []).join(", ") || "none (terminal state)"}`;
  }
  if (newStatus === "reviewed" || newStatus === "ready") {
    const plan2 = readPlanFile(worktreePath, id);
    if (plan2) {
      const q = assessPlanQuality(plan2);
      if (q.score < 60) {
        return `Plan quality score ${q.score}/100 is below minimum 60. Issues: ${q.report.join("; ") || "none"}`;
      }
    }
  }
  entry.status = newStatus;
  entry.updatedAt = now();
  if (updates?.done !== undefined)
    entry.completed = updates.done;
  if (updates?.total !== undefined)
    entry.total = updates.total;
  if (newStatus === "done" || newStatus === "abandoned") {
    if (idx.activePlanId === id)
      idx.activePlanId = null;
  }
  if (newStatus === "approved" || newStatus === "in_progress") {
    idx.activePlanId = id;
  }
  idx.updatedAt = now();
  writePlanIndex(worktreePath, idx);
  const plan = readPlanFile(worktreePath, id);
  if (plan) {
    plan.status = newStatus;
    plan.updatedAt = now();
    writePlanFile(worktreePath, plan);
  }
  return null;
}
var PROJECT_MARKERS = [".git", "package.json", "go.mod", "Cargo.toml", "pyproject.toml", "composer.json", "Gemfile", "project.json", "pubspec.yaml", "mix.exs"];
var INIT_MARKERS = [".opencode", ".openecc"];
function isValidProjectDir(dir) {
  try {
    const stat = fs2.statSync(dir);
    if (!stat.isDirectory())
      return false;
    const resolved = path2.resolve(dir);
    if (PROJECT_MARKERS.some((m) => fs2.existsSync(path2.join(resolved, m))))
      return true;
    if (INIT_MARKERS.some((m) => fs2.existsSync(path2.join(resolved, m))))
      return true;
    const home = os.homedir();
    if (path2.parse(resolved).root !== path2.parse(home).root)
      return true;
    const relative2 = path2.relative(home, resolved);
    if (relative2 && !relative2.startsWith("..") && !path2.isAbsolute(relative2)) {
      const segments = relative2.split(path2.sep).filter(Boolean);
      if (segments.length >= 2)
        return true;
    }
    return false;
  } catch {
    return false;
  }
}
var IMPLEMENT_WORDS = new Set([
  "implement",
  "build",
  "add",
  "fix",
  "change",
  "create",
  "refactor",
  "write",
  "edit",
  "update",
  "remove",
  "delete",
  "broken",
  "fails",
  "error",
  "feature",
  "support",
  "need",
  "want",
  "should"
]);
var CLARIFY_PATTERNS = ["what is", "how does", "explain", "why", "describe", "tell me", "show me"];
function classifyIntent(message) {
  const lower = message.toLowerCase().trim();
  if (!lower)
    return { category: "unknown", isWork: false };
  const QUESTION_PREFIXES = ["is ", "are ", "can ", "could ", "would ", "should ", "does ", "do ", "has ", "have "];
  const isLikelyQuestion = lower.includes("?") || CLARIFY_PATTERNS.some((p) => lower.includes(p)) || QUESTION_PREFIXES.some((p) => lower.startsWith(p));
  if (isLikelyQuestion)
    return { category: "clarify", isWork: false };
  const tokens = lower.split(/[^a-z0-9]+/).filter((t) => t.length > 0);
  const hasImplToken = tokens.some((t) => IMPLEMENT_WORDS.has(t));
  const hasPlanToken = tokens.some((t) => t === "plan");
  const hasReviewPhrase = lower.includes("review") || lower.includes("check") || lower.includes("verify");
  const hasTestPhrase = lower.includes("test");
  const hasDebugPhrase = lower.includes("debug") || lower.includes("bug");
  if (hasPlanToken && hasImplToken)
    return { category: "plan", isWork: true };
  if (hasPlanToken)
    return { category: "plan", isWork: false };
  if (hasReviewPhrase && !hasImplToken)
    return { category: "review", isWork: false };
  if (hasTestPhrase && !hasImplToken)
    return { category: "test", isWork: true };
  if (hasDebugPhrase)
    return { category: "debug", isWork: true };
  if (hasImplToken)
    return { category: "implement", isWork: true };
  return { category: "unknown", isWork: false };
}
function buildToolAccessBlock() {
  const yaml = `type: tool_access
main_context_only:
  allowed:
    - task
    - skill
    - read
    - question
  description: "Spawn subagents, load skills, read state files, ask user. NO source mutations."
subagent_only:
  allowed:
    - edit
    - write
    - glob
    - grep
    - bash
  description: "All source work \u2014 editing, searching, building, testing. NEVER in main context."
shared:
  allowed:
    - webfetch
  description: "Read-only external fetch. OK in main context sparingly."`;
  return `<structured type="tool_access">
${yaml}
</structured>`;
}
function yamlStr(s) {
  if (/[:{}[\]&*!|>'"%@`]/.test(s) || s.includes(`
`) || s.includes("#")) {
    const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    return `"${escaped}"`;
  }
  return s;
}
function serializePlanYaml(plan) {
  const lines = [];
  lines.push(`schema: ${plan.schema}`);
  lines.push(`id: ${plan.id}`);
  lines.push(`version: ${plan.version}`);
  lines.push(`createdAt: "${plan.createdAt}"`);
  lines.push(`updatedAt: "${plan.updatedAt}"`);
  lines.push(`status: ${plan.status}`);
  lines.push(`parent: ${plan.parent || "null"}`);
  lines.push(`goal: ${yamlStr(plan.goal)}`);
  lines.push(`check: ${yamlStr(plan.check)}`);
  lines.push(`summary: ${yamlStr(plan.summary)}`);
  lines.push("tasks:");
  for (const t of plan.tasks) {
    lines.push(`  - id: ${t.id}`);
    lines.push(`    summary: ${yamlStr(t.summary)}`);
    lines.push(`    status: ${t.status}`);
    lines.push("    files:");
    for (const f of t.files)
      lines.push(`      - ${yamlStr(f)}`);
    lines.push("    depends_on:");
    for (const d of t.depends_on)
      lines.push(`      - ${d}`);
    if (t.effort)
      lines.push(`    effort: ${t.effort}`);
    if (t.verification)
      lines.push(`    verification: ${yamlStr(t.verification)}`);
  }
  lines.push("plan_notes:");
  for (const n of plan.plan_notes)
    lines.push(`  - ${yamlStr(n)}`);
  if (plan.plannerMode)
    lines.push(`plannerMode: ${plan.plannerMode}`);
  if (plan.plannerSource)
    lines.push(`plannerSource: ${plan.plannerSource}`);
  return lines.join(`
`) + `
`;
}
function parsePlanYaml(raw) {
  try {
    let peek = function() {
      return lines[i] || "";
    }, consume = function() {
      return lines[i++] || "";
    }, unquote = function(s) {
      s = s.trim();
      if (s.startsWith('"') && s.endsWith('"') || s.startsWith("'") && s.endsWith("'")) {
        s = s.slice(1, -1);
      }
      return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    };
    const plan = {
      schema: "",
      id: "",
      version: 1,
      createdAt: "",
      updatedAt: "",
      status: "draft",
      parent: null,
      goal: "",
      check: "",
      summary: "",
      tasks: [],
      plan_notes: []
    };
    const lines = raw.split(`
`);
    let i = 0;
    while (i < lines.length) {
      const line = peek();
      if (!line.trim() || line.trim().startsWith("#")) {
        consume();
        continue;
      }
      if (line.trim() === "tasks:") {
        consume();
        break;
      }
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) {
        const [, key, val] = m;
        if (key === "parent") {
          plan.parent = val.trim() === "null" ? null : val.trim();
        } else if (key === "version") {
          plan.version = parseInt(val.trim(), 10) || 1;
        } else if (key === "tasks") {
          break;
        } else {
          plan[key] = unquote(val);
        }
      }
      consume();
    }
    const tasks = [];
    let currentTask = null;
    let inFiles = false;
    let inDepends = false;
    while (i < lines.length) {
      const line = consume();
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#"))
        continue;
      if (trimmed.startsWith("- id:")) {
        if (currentTask && currentTask.id)
          tasks.push(currentTask);
        currentTask = { id: "", summary: "", status: "pending", files: [], depends_on: [] };
        currentTask.id = trimmed.replace("- id:", "").trim();
        inFiles = false;
        inDepends = false;
        continue;
      }
      if (!currentTask)
        continue;
      if (trimmed.startsWith("summary:")) {
        currentTask.summary = unquote(trimmed.slice("summary:".length));
        inFiles = false;
        inDepends = false;
        continue;
      }
      if (trimmed.startsWith("status:")) {
        currentTask.status = trimmed.slice("status:".length).trim();
        inFiles = false;
        inDepends = false;
        continue;
      }
      if (trimmed === "files:") {
        inFiles = true;
        inDepends = false;
        continue;
      }
      if (trimmed === "depends_on:") {
        inDepends = true;
        inFiles = false;
        continue;
      }
      if (trimmed.startsWith("effort:")) {
        currentTask.effort = trimmed.slice("effort:".length).trim();
        inFiles = false;
        inDepends = false;
        continue;
      }
      if (trimmed.startsWith("verification:")) {
        currentTask.verification = unquote(trimmed.slice("verification:".length));
        inFiles = false;
        inDepends = false;
        continue;
      }
      if (inFiles && trimmed.startsWith("- ")) {
        currentTask.files = currentTask.files || [];
        currentTask.files.push(unquote(trimmed.slice(2)));
      }
      if (inDepends && trimmed.startsWith("- ")) {
        currentTask.depends_on = currentTask.depends_on || [];
        currentTask.depends_on.push(trimmed.slice(2).trim());
      }
      const tm = trimmed.match(/^(\w+):/);
      if (tm && !["summary", "status", "files", "depends_on", "effort", "verification", "id"].includes(tm[1])) {
        plan[tm[1]] = unquote(trimmed.slice(tm[1].length + 1));
      }
    }
    if (currentTask && currentTask.id)
      tasks.push(currentTask);
    plan.tasks = tasks;
    const notes = [];
    for (const line of lines) {
      const m = line.match(/^\s*-\s+(.*)$/);
      if (m && line.trim() !== "- id:" && !line.trim().startsWith("- ") && !line.trim().startsWith("- id:")) {
        const prevLine = lines[Math.max(0, lines.indexOf(line) - 1)];
        if (prevLine.trim() === "plan_notes:" || lines.indexOf(line) > 0 && lines.filter((l, idx) => idx < lines.indexOf(line) && l.trim() === "plan_notes:").length > 0) {
          notes.push(unquote(m[1]));
        }
      }
    }
    const notesSection = raw.split(`
plan_notes:
`)[1];
    if (notesSection) {
      for (const nl of notesSection.split(`
`)) {
        const nm = nl.match(/^\s*-\s+(.*)$/);
        if (nm)
          notes.push(unquote(nm[1]));
      }
    }
    plan.plan_notes = notes;
    return plan;
  } catch {
    return null;
  }
}

// src/execution.ts
var _ctx = {
  attempt: 0,
  struggleDetected: false,
  lastErrorPattern: null,
  compactionCount: 0
};
function getExecutionContext() {
  return { ..._ctx };
}
function incrementAttempt() {
  _ctx.attempt++;
}
function buildExecutionContextBlock() {
  const ctx = getExecutionContext();
  const yaml = [
    "type: execution",
    `attempt: ${ctx.attempt}`,
    `struggle_detected: ${ctx.struggleDetected}`,
    `compaction_count: ${ctx.compactionCount}`
  ].join(`
`);
  return `<structured type="execution">
${yaml}
</structured>`;
}

// src/plugin.ts
var __dirname3 = path3.dirname(fileURLToPath2(import.meta.url));
var skillsDir = path3.resolve(__dirname3, "..", "skills");
var agentsDir = path3.resolve(__dirname3, "..", "prompts", "agents");
var commandsDir = path3.resolve(__dirname3, "..", "commands");
var agentsMDPath = path3.resolve(__dirname3, "..", "..", "AGENTS.md");
function readFileSafe(filePath) {
  try {
    return fs3.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
function stripYamlFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n/, "");
}
function detectProject(cwd) {
  let projectName = path3.basename(cwd);
  try {
    const pkg = JSON.parse(fs3.readFileSync(path3.join(cwd, "package.json"), "utf8"));
    if (pkg.name)
      projectName = pkg.name;
  } catch {}
  const languages = [];
  if (fs3.existsSync(path3.join(cwd, "tsconfig.json")))
    languages.push("typescript");
  if (fs3.existsSync(path3.join(cwd, "go.mod")))
    languages.push("go");
  if (fs3.existsSync(path3.join(cwd, "Cargo.toml")))
    languages.push("rust");
  if (fs3.existsSync(path3.join(cwd, "pyproject.toml")))
    languages.push("python");
  if (fs3.existsSync(path3.join(cwd, "package.json")))
    languages.push("javascript");
  const lockfiles = { "bun.lock": "bun", "bun.lockb": "bun", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "package-lock.json": "npm" };
  let packageManager = "npm";
  for (const [lock, name] of Object.entries(lockfiles)) {
    if (fs3.existsSync(path3.join(cwd, lock))) {
      packageManager = name;
      break;
    }
  }
  return { projectName, languages, packageManager };
}
function buildProjectProfileSection(p) {
  const lines = ["### Project Profile (auto-detected)"];
  if (p.languages.length > 0)
    lines.push(`- Languages: ${p.languages.join(", ")}`);
  lines.push(`- Package manager: ${p.packageManager}`, "");
  return lines.join(`
`);
}

class GoalTracker {
  condition = null;
  turnCount = 0;
  start(condition) {
    this.condition = condition;
    this.turnCount = 0;
  }
  clear() {
    this.condition = null;
    this.turnCount = 0;
  }
  isActive() {
    return this.condition !== null;
  }
  getState() {
    return this.condition ? { condition: this.condition, turnCount: this.turnCount } : null;
  }
  status() {
    if (!this.condition)
      return "No active goal.";
    return `## Goal Status

Condition: ${this.condition}
Turns: ${this.turnCount}`;
  }
}
var DELEGATOR_ROLE = `## Your Role (OpenECC Delegator)
Your primary job is to delegate, synthesize, and verify \u2014 not to do work directly.

### When to delegate to a subagent (@mention):
- Planning / architecture \u2192 @planner
- Code review / quality \u2192 @code-reviewer
- Security review \u2192 @security-reviewer
- Build/type errors \u2192 @build-error-resolver
- Test-first development \u2192 @tdd-guide
- Codebase/web search \u2192 @search-agent
- Plan reviews \u2192 @plan-ceo-reviewer, @plan-eng-reviewer, @plan-design-reviewer, @plan-devex-reviewer

### When to answer directly:
- Simple factual questions, quick clarifications, status checks
- Anything that requires zero tools

### Completion protocol:
1. **Verify before claiming** \u2014 run the command, read the output, then speak
2. **Synthesize** \u2014 distill subagent results into 3-5 sentences max
3. Place \`---\` followed by **Status:** \u2705 Done | \uD83D\uDEA7 Blocked | \uD83D\uDD04 In Progress`;
var DELEGATION_ENFORCEMENT = `## OpenECC Delegation Enforcement (HARD RULES)
These are structural constraints, NOT suggestions. Violations are bugs.

### Tool Access Control \u2014 Main Context (TALK + DELEGATE only)
NEVER call these tools in main context:

| Tool | Correct Usage | Delegate To |
|------|--------------|-------------|
| \`edit\` | Changes source files | Language-specific subagent |
| \`write\` | Creates/modifies files | Language-specific subagent |
| \`bash\` | Runs commands | @executor or language-specific subagent |
| \`glob\` | Searches codebase | @search-agent |
| \`grep\` | Searches file contents | @search-agent |

### Self-Audit Before Every Tool Call
Before calling ANY tool, ask:
1. "Does this tool edit, write, or run commands?" \u2192 DELEGATE via \`task\` tool.
2. "Does this tool search source code?" \u2192 DELEGATE via \`task\` tool.
3. "Could a subagent do this in parallel while I handle something else?" \u2192 DELEGATE via \`task\` tool.
4. "Am I about to do work directly instead of delegating?" \u2192 STOP. Spawn a subagent.
If any answer is YES, use the \`task\` tool to spawn a subagent. No exceptions.`;
var COMPLETION_CONTRACT = `### Before responding
1. Did you delegate analysis/planning work to a subagent when appropriate?
2. Did you verify results (not assume)?
3. Is the response concise and synthesized?
When done: place \`---\` followed by **Status:** \u2705 Done | \uD83D\uDEA7 Blocked | \uD83D\uDD04 In Progress`;
var AGENTS = [
  { name: "planner", desc: "Expert planning specialist for complex features and refactoring.", permission: { edit: "deny", write: "deny", task: "deny" } },
  { name: "architect", desc: "Software architecture specialist for system design and technical decisions.", permission: { edit: "deny", write: "deny", task: "deny" } },
  { name: "code-reviewer", desc: "Expert code review specialist. Reviews code for quality, security, maintainability.", permission: { edit: "deny", write: "deny", task: "deny" } },
  { name: "security-reviewer", desc: "Security vulnerability detection and remediation.", permission: { task: "deny" } },
  { name: "tdd-guide", desc: "Test-Driven Development specialist. 80%+ test coverage.", permission: { task: "deny" } },
  { name: "build-error-resolver", desc: "Build and TypeScript error resolution. Minimal diffs.", permission: { task: "deny" } },
  { name: "search-agent", desc: "Low-cost search specialist. grep/glob/webfetch/websearch.", permission: { edit: "deny", write: "deny", bash: "deny", task: "deny" } },
  { name: "plan-ceo-reviewer", desc: "Business/product perspective plan review.", permission: { edit: "deny", write: "deny", task: "deny" } },
  { name: "plan-eng-reviewer", desc: "Engineering/architecture plan review.", permission: { edit: "deny", write: "deny", task: "deny" } },
  { name: "plan-design-reviewer", desc: "UX/design perspective plan review.", permission: { edit: "deny", write: "deny", task: "deny" } },
  { name: "plan-devex-reviewer", desc: "Developer experience plan review.", permission: { edit: "deny", write: "deny", task: "deny" } }
];
var COMMANDS = [
  { name: "plan", desc: "Create a detailed implementation plan", agent: "planner", subtask: true },
  { name: "code-review", desc: "Review code for quality, security, maintainability", agent: "code-reviewer", subtask: true },
  { name: "security", desc: "Run comprehensive security review", agent: "security-reviewer", subtask: true },
  { name: "tdd", desc: "Enforce TDD with 80%+ coverage", agent: "tdd-guide", subtask: true },
  { name: "build-fix", desc: "Fix build/type errors", agent: "build-error-resolver", subtask: true },
  { name: "swarm", desc: "Full pipeline: think \u2192 plan \u2192 review \u2192 build \u2192 test \u2192 ship", agent: "planner", subtask: true }
];
var OpenECCPlugin = async ({ client, directory, worktree }) => {
  const worktreePath = worktree || directory;
  let projectProfile = null;
  const goalTracker = new GoalTracker;
  const editedFiles = new Set;
  return {
    "tool.definition": async (input, output) => {
      if (input.toolID === "edit" || input.toolID === "write") {
        output.description = `[OPENECC ENFORCEMENT] This tool MUST be called inside a subagent, not in main context. Delegate via \`task\` tool. Rule: no direct work in main context. | ${output.description}`;
      }
      if (input.toolID === "glob" || input.toolID === "grep") {
        output.description = `[OPENECC ENFORCEMENT] Source code search must be delegated to a subagent. | ${output.description}`;
      }
      if (input.toolID === "bash") {
        output.description = `[OPENECC ENFORCEMENT] All commands must run inside a subagent. | ${output.description}`;
      }
    },
    "command.execute.before": async (input, output) => {
      if (input.command === "goal") {
        const args = input.arguments;
        if (!args || args.trim() === "") {
          output.parts = [{ type: "text", text: "Usage: /goal <condition> | /goal status | /goal clear", id: "", sessionID: "", messageID: "" }];
          return;
        }
        const parts = args.trim().split(/\s+/);
        const sub = parts[0]?.toLowerCase();
        if (sub === "status") {
          output.parts = [{ type: "text", text: goalTracker.status(), id: "", sessionID: "", messageID: "" }];
        } else if (sub === "clear") {
          goalTracker.clear();
          output.parts = [{ type: "text", text: "Goal cleared.", id: "", sessionID: "", messageID: "" }];
        } else {
          goalTracker.start(args.trim());
          output.parts = [{ type: "text", text: `Goal started: "${args.trim()}".`, id: "", sessionID: "", messageID: "" }];
        }
        return;
      }
      if (input.command === "plan") {
        const planArgs = input.arguments?.trim() || "";
        const planParts = planArgs.split(/\s+/);
        const sub = planParts[0]?.toLowerCase();
        if (!sub) {
          output.parts = [{ type: "text", text: "Usage: /plan list | /plan status | /plan create <summary> | /plan transition <id> <status>", id: "", sessionID: "", messageID: "" }];
          return;
        }
        if (sub === "list") {
          const idx = readPlanIndex(worktreePath);
          if (!idx || idx.plans.length === 0) {
            output.parts = [{ type: "text", text: "No plans found.", id: "", sessionID: "", messageID: "" }];
            return;
          }
          const lines = ["## Plans"];
          for (const p of idx.plans)
            lines.push(`- ${p.id}: ${p.summary} (${p.status}, ${p.completed}/${p.total})`);
          output.parts = [{ type: "text", text: lines.join(`
`), id: "", sessionID: "", messageID: "" }];
          return;
        }
        if (sub === "status") {
          const active = getActivePlan(worktreePath);
          output.parts = [{ type: "text", text: active ? `Active plan ${active.id}: ${active.summary} (${active.status}, ${active.completed}/${active.total})` : "No active plan.", id: "", sessionID: "", messageID: "" }];
          return;
        }
        if (sub === "create") {
          const summary = planParts.slice(1).join(" ");
          if (!summary) {
            output.parts = [{ type: "text", text: "Usage: /plan create <summary>", id: "", sessionID: "", messageID: "" }];
            return;
          }
          const result = createPlan(worktreePath, { summary, status: "approved" });
          if (result) {
            output.parts = [{ type: "text", text: `Plan ${result.id} created and activated: "${summary}"`, id: "", sessionID: "", messageID: "" }];
          } else {
            output.parts = [{ type: "text", text: "Failed to create plan.", id: "", sessionID: "", messageID: "" }];
          }
          return;
        }
        if (sub === "transition") {
          const pid = planParts[1] || "";
          const newStatus = planParts[2];
          if (!pid || !newStatus) {
            output.parts = [{ type: "text", text: "Usage: /plan transition <id> <status>", id: "", sessionID: "", messageID: "" }];
            return;
          }
          const VALID_STATUSES = ["draft", "reviewed", "ready", "approved", "in_progress", "done", "blocked", "abandoned"];
          if (!VALID_STATUSES.includes(newStatus)) {
            output.parts = [{ type: "text", text: `Invalid status: "${newStatus}". Valid: ${VALID_STATUSES.join(", ")}`, id: "", sessionID: "", messageID: "" }];
            return;
          }
          const err = updatePlanStatus(worktreePath, pid, newStatus);
          output.parts = [{ type: "text", text: err ? `Error: ${err}` : `Plan ${pid} transitioned to ${newStatus}.`, id: "", sessionID: "", messageID: "" }];
          return;
        }
        output.parts = [{ type: "text", text: `Unknown: ${sub}. Try: list, status, create, transition`, id: "", sessionID: "", messageID: "" }];
      }
    },
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir))
        config.skills.paths.push(skillsDir);
      config.instructions = config.instructions || [];
      if (!config.instructions.some((i) => i === agentsMDPath))
        config.instructions.push(agentsMDPath);
      config.agent = config.agent || {};
      for (const agent of AGENTS) {
        if (!config.agent[agent.name]) {
          const prompt = readFileSafe(path3.join(agentsDir, `${agent.name}.txt`));
          if (prompt) {
            const agentConfig = { description: agent.desc, mode: "subagent", prompt };
            if (agent.permission)
              agentConfig.permission = agent.permission;
            config.agent[agent.name] = agentConfig;
          }
        }
      }
      config.command = config.command || {};
      for (const cmd of COMMANDS) {
        if (!config.command[cmd.name]) {
          const templateContent = readFileSafe(path3.join(commandsDir, `${cmd.name}.md`));
          const cleanTemplate = stripYamlFrontmatter(templateContent);
          if (cleanTemplate) {
            config.command[cmd.name] = { description: cmd.desc, template: `${cleanTemplate}

$ARGUMENTS`, ...cmd.agent ? { agent: cmd.agent } : {}, ...cmd.subtask ? { subtask: true } : {} };
          }
        }
      }
    },
    "experimental.chat.system.transform": async (_input, output) => {
      if (!projectProfile)
        projectProfile = detectProject(worktreePath);
      const pkg = getPackageInfo();
      const soulPath = path3.join(skillsDir, "soul", "SKILL.md");
      const soulContent = readFileSafe(soulPath);
      const cleanSoul = stripYamlFrontmatter(soulContent);
      const identityBlock = `<EXTREMELY_IMPORTANT>
I am OpenECC, your engineering workflow layer.

I know my version (\`${pkg.version}\`), my install path (\`${pkg.root}\`), and my job: route work to specialists, gate plans until approved, track goals, and never claim done without verification. I report to you directly with synthesized results. Everything else is delegated.

You have a soul \u2014 the principles below are always active. They are ALREADY LOADED.

${cleanSoul}
</EXTREMELY_IMPORTANT>`;
      const runtimeBlock = `<structured type="runtime">
type: runtime
openecc_version: ${pkg.version}
package_root: ${pkg.root}
skills_directory: ${pkg.skillsDir}
</structured>`;
      const systemMessages = output.systemMessages || [];
      if (!systemMessages.some((p) => p.text?.includes("EXTREMELY_IMPORTANT"))) {
        const fullBootstrap = [
          identityBlock,
          runtimeBlock,
          buildExecutionContextBlock(),
          DELEGATOR_ROLE,
          DELEGATION_ENFORCEMENT,
          buildToolAccessBlock(),
          COMPLETION_CONTRACT,
          buildProjectProfileSection(projectProfile)
        ].join(`

`);
        systemMessages.unshift({ type: "text", text: fullBootstrap });
        output.systemMessages = systemMessages;
      }
      try {
        const activeEntry = getActivePlan(worktreePath);
        if (activeEntry) {
          const planBlock = `<structured type="plan_state">
active_plan: ${activeEntry.id}
status: ${activeEntry.status}
completed: ${activeEntry.completed}
total: ${activeEntry.total}
goal: ${activeEntry.summary}
</structured>`;
          if (!systemMessages.some((p) => p.text?.includes("plan_state"))) {
            systemMessages.push({ type: "text", text: planBlock });
          }
        }
      } catch {}
      if (goalTracker.isActive()) {
        const gs = goalTracker.getState();
        const goalBlock = `<goal_objective>
condition: ${gs.condition}
turns: ${gs.turnCount}
</goal_objective>`;
        if (!systemMessages.some((p) => p.text?.includes("goal_objective"))) {
          systemMessages.push({ type: "text", text: goalBlock });
        }
      }
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages?.length)
        return;
      const firstUser = output.messages.find((m) => m.info?.role === "user");
      if (!firstUser || !firstUser.parts?.length)
        return;
      if (firstUser.parts.some((p) => p.type === "text" && typeof p.text === "string" && p.text.includes("EXTREMELY_IMPORTANT")))
        return;
      const parts = firstUser.parts;
      const userText = parts.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text).join(" ");
      if (!userText || userText.length >= 2000)
        return;
      incrementAttempt();
      try {
        const intent = classifyIntent(userText);
        if (intent.isWork && isValidProjectDir(worktreePath)) {
          const scope = classifyTaskScope(userText);
          if (scope !== "trivial") {
            const existingPlan = getActivePlan(worktreePath);
            if (!existingPlan || existingPlan.status === "done" || existingPlan.status === "abandoned" || existingPlan.status === "blocked") {
              const result = scope === "complex" ? createPlan(worktreePath, { summary: userText, status: "draft" }) : createBuiltinPlan(worktreePath, userText, "auto");
              if (result) {
                const firstText = parts.find((p) => p.type === "text");
                if (firstText && typeof firstText.text === "string") {
                  const planStatus = result.plan.status;
                  firstText.text = planStatus === "draft" ? `[plan:${result.id}] Auto-created DRAFT plan for: "${result.summary}". Tasks: ${result.plan.tasks.length}. Approve via /plan transition ${result.id} approved.

${firstText.text}` : `[plan:${result.id}] Auto-created plan for: "${result.summary}". Tasks: ${result.plan.tasks.length}. Proceeding.

${firstText.text}`;
                }
              }
            }
          }
        }
      } catch {}
      if (goalTracker.isActive()) {
        for (const msg of output.messages ?? []) {
          if (msg.info?.role === "assistant") {
            const text = (msg.parts || []).map((p) => p.text || "").join(" ");
            if (text.includes("[goal:complete]")) {
              goalTracker.clear();
              continue;
            }
            if (text.includes("[goal:blocked]")) {
              goalTracker.clear();
              continue;
            }
          }
        }
        goalTracker.turnCount++;
      }
    },
    "experimental.session.compacting": async (_input, output) => {
      const pkg = getPackageInfo();
      output.context.push("# OpenECC Context (preserve across compaction)");
      output.context.push("", `## OpenECC v${pkg.version}`);
      output.context.push(`- Package root: ${pkg.root}`);
      output.context.push("- Primary role: delegate to subagents, synthesize results, verify before claiming");
      output.context.push("- Soul: Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution");
      output.context.push("- Route by task type: planning, review, build-fix, TDD, docs, language-specific");
      output.context.push("- Answer directly when no tools are needed", "");
      if (projectProfile) {
        output.context.push("## Project Profile");
        output.context.push(`- Languages: ${projectProfile.languages.join(", ") || "none detected"}`);
        output.context.push(`- Package manager: ${projectProfile.packageManager}`, "");
      }
      if (goalTracker.isActive()) {
        const s = goalTracker.getState();
        output.context.push("## Active Goal");
        output.context.push(`- Condition: ${s.condition}`, `- Turns: ${s.turnCount}`, "");
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
    },
    "tool.execute.after": async (input, _output) => {
      const filePath = input.args?.filePath;
      if ((input.tool === "edit" || input.tool === "write") && filePath)
        editedFiles.add(filePath);
    },
    "session.created": async () => {
      const pkg = getPackageInfo();
      await client.app.log({ body: { service: "openecc", level: "info", message: `Session started \u2014 OpenECC v${pkg.version} active` } });
    },
    "session.deleted": async () => {
      editedFiles.clear();
    }
  };
};
var plugin_default = OpenECCPlugin;
export {
  plugin_default as default,
  OpenECCPlugin
};
