import * as fs from "node:fs"
import * as path from "node:path"

export interface ProjectProfile {
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

function hasFile(dir: string, ...names: string[]): boolean {
  for (const name of names) {
    if (fs.existsSync(path.join(dir, name))) return true
  }
  return false
}

function detectLanguages(cwd: string): string[] {
  const langs: string[] = []
  if (hasFile(cwd, "tsconfig.json")) langs.push("typescript")
  if (fs.existsSync(path.join(cwd, "go.mod"))) langs.push("go")
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) langs.push("rust")
  if (fs.existsSync(path.join(cwd, "pyproject.toml"))) langs.push("python")
  if (hasFile(cwd, "package.json")) langs.push("javascript")
  return langs
}

function detectFrameworks(cwd: string): string[] {
  const frameworks: string[] = []
  if (hasFile(cwd, "next.config.js", "next.config.mjs", "next.config.ts")) frameworks.push("nextjs")
  if (hasFile(cwd, "angular.json")) frameworks.push("angular")
  if (hasFile(cwd, "svelte.config.js", "svelte.config.cjs")) frameworks.push("svelte")
  if (hasFile(cwd, "nuxt.config.js", "nuxt.config.ts")) frameworks.push("nuxt")
  if (hasFile(cwd, "gatsby-config.js", "gatsby-config.ts")) frameworks.push("gatsby")
  if (hasFile(cwd, "astro.config.mjs", "astro.config.ts")) frameworks.push("astro")
  return frameworks
}

function detectTestFrameworks(cwd: string): string[] {
  const frameworks: string[] = []
  if (hasFile(cwd, "jest.config.js", "jest.config.ts", "jest.config.mjs")) frameworks.push("jest")
  if (hasFile(cwd, "vitest.config.js", "vitest.config.ts")) frameworks.push("vitest")
  if (hasFile(cwd, "playwright.config.ts", "playwright.config.js")) frameworks.push("playwright")
  if (hasFile(cwd, ".mocharc.js", ".mocharc.yml", ".mocharc.json")) frameworks.push("mocha")
  if (fs.existsSync(path.join(cwd, "pytest.ini"))) frameworks.push("pytest")
  if (fs.existsSync(path.join(cwd, "go.mod"))) frameworks.push("go test")
  return frameworks
}

function detectCSSFrameworks(cwd: string): string[] {
  const frameworks: string[] = []
  if (hasFile(cwd, "tailwind.config.js", "tailwind.config.ts")) frameworks.push("tailwind")
  if (hasFile(cwd, "postcss.config.js", "postcss.config.mjs")) frameworks.push("postcss")
  return frameworks
}

function detectDocker(cwd: string): boolean {
  return hasFile(cwd, "Dockerfile", "docker-compose.yml", "docker-compose.yaml")
}

function detectCI(cwd: string): boolean {
  if (fs.existsSync(path.join(cwd, ".github", "workflows"))) return true
  if (hasFile(cwd, ".gitlab-ci.yml", "Jenkinsfile")) return true
  return false
}

function detectPackageManager(cwd: string): string {
  const lockfiles: Record<string, string> = {
    "bun.lock": "bun",
    "bun.lockb": "bun",
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "package-lock.json": "npm",
  }
  for (const [lock, name] of Object.entries(lockfiles)) {
    if (fs.existsSync(path.join(cwd, lock))) return name
  }
  return "npm"
}

function detectFormatter(cwd: string): string | null {
  if (hasFile(cwd, "biome.json", "biome.jsonc")) return "biome"
  if (hasFile(cwd, ".prettierrc", ".prettierrc.json", "prettier.config.js", ".prettierrc.yaml")) return "prettier"
  if (fs.existsSync(path.join(cwd, "pyproject.toml"))) return "black"
  if (fs.existsSync(path.join(cwd, "go.mod"))) return "gofmt"
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return "rustfmt"
  return null
}

function detectLinter(cwd: string): string | null {
  if (hasFile(cwd, "biome.json", "biome.jsonc")) return "biome"
  try {
    if (fs.readdirSync(cwd).some((f: string) => f.startsWith("eslint.config."))) return "eslint"
  } catch {}
  if (fs.existsSync(path.join(cwd, "go.mod"))) return "golangci-lint"
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return "clippy"
  return null
}

export function detectProject(cwd: string): ProjectProfile {
  let projectName = path.basename(cwd)
  try {
    const pkgRaw = fs.readFileSync(path.join(cwd, "package.json"), "utf8")
    const pkg = JSON.parse(pkgRaw)
    if (pkg.name) projectName = pkg.name
  } catch {}

  return {
    languages: detectLanguages(cwd),
    frameworks: detectFrameworks(cwd),
    testFrameworks: detectTestFrameworks(cwd),
    cssFrameworks: detectCSSFrameworks(cwd),
    packageManager: detectPackageManager(cwd),
    formatter: detectFormatter(cwd),
    linter: detectLinter(cwd),
    hasDocker: detectDocker(cwd),
    hasCI: detectCI(cwd),
    projectName,
  }
}
