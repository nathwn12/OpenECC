import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let _version: string | null = null
let _pkgInfo: PackageInfo | null = null

export interface PackageInfo {
  version: string
  root: string
  skillsDir: string
  cacheRoot: string
}

function findPackageRoot(fromDir: string): string | null {
  let current = fromDir
  for (let i = 0; i < 5; i++) {
    const pj = path.join(current, "package.json")
    if (fs.existsSync(pj)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pj, "utf8"))
        if (pkg.name === "openecc") return current
      } catch {}
    }
    const parent = path.resolve(current, "..")
    if (parent === current) break
    current = parent
  }
  return null
}

export function getOpenEccVersion(): string {
  if (_version) return _version
  try {
    const pkgRoot = findPackageRoot(__dirname) ?? findPackageRoot(path.resolve(__dirname, "..")) ?? path.resolve(__dirname, "..")
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"))
    _version = pkg.version ?? null
  } catch {}
  return _version ?? "0.0.0"
}

export function getPackageInfo(): PackageInfo {
  if (_pkgInfo) return _pkgInfo
  const root = findPackageRoot(__dirname) ?? findPackageRoot(path.resolve(__dirname, "..")) ?? path.resolve(__dirname, "..")
  const version = getOpenEccVersion()
  const skillsDir = path.join(root, ".opencode", "skills")
  const cacheRoot = path.join(os.homedir(), ".cache", "opencode", "packages")
  _pkgInfo = { version, root, skillsDir, cacheRoot }
  return _pkgInfo
}
