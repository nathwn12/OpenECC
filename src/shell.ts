import * as os from "node:os"

export type ShellType = "git-bash" | "pwsh" | "powershell" | "cmd" | "wsl" | "unix" | "unknown"

export interface ShellEnvironment {
  shellType: ShellType
  preferredSyntax: "bash" | "powershell" | "cmd"
  isWindows: boolean
  isPowerShell: boolean
  antiPatterns: string[]
  guidance: string
}

const ANTI_PATTERNS: Record<ShellType, string[]> = {
  "git-bash": ["Remove-Item", "Get-ChildItem", "New-Item", "Set-Content", "Get-Content", "Out-File", "Move-Item", "Copy-Item"],
  pwsh: ["Get-Content", "Set-Content", "Out-File", "Add-Content", "Get-ChildItem", "Select-String", "Remove-Item"],
  powershell: ["Get-Content", "Set-Content", "Out-File", "Add-Content", "Get-ChildItem", "Select-String", "Remove-Item"],
  cmd: [],
  wsl: ["Remove-Item", "Get-ChildItem"],
  unix: [],
  unknown: [],
}

const GUIDANCE: Record<ShellType, string> = {
  "git-bash": "You are on Git Bash (MSYS2/MinGW). Use POSIX/bash commands (ls, rm, mkdir, cat). NEVER use PowerShell commands like Remove-Item, Get-ChildItem, Set-Content.",
  pwsh: "You are on PowerShell 7+ (pwsh). Use PowerShell cmdlets and syntax.",
  powershell: "You are on Windows PowerShell 5.1 (powershell.exe). Use PowerShell cmdlets and syntax.",
  cmd: "You are on Windows Command Prompt (CMD). Use cmd.exe syntax.",
  wsl: "You are on WSL (Windows Subsystem for Linux). Use bash commands.",
  unix: "You are on a Unix/Linux/macOS shell. Use standard POSIX/bash commands.",
  unknown: "Shell type could not be determined. Use standard POSIX/bash commands.",
}

let _cachedShell: ShellEnvironment | null = null

export function resetShellCache(): void {
  _cachedShell = null
}

export function detectShell(): ShellEnvironment {
  if (_cachedShell) return _cachedShell

  const env = process.env
  const platform = os.platform()
  const isWindows = platform === "win32"

  let shellType: ShellType

  if (env.MSYSTEM) {
    shellType = "git-bash"
  } else if (env.PSModulePath && !env.MSYSTEM) {
    shellType = env.PSEdition === "Core" ? "pwsh" : isWindows ? "powershell" : "unknown"
  } else if (env.ComSpec?.toLowerCase().includes("cmd.exe") && !env.SHELL?.toLowerCase().includes("bash")) {
    shellType = "cmd"
  } else if (env.SHELL) {
    const shellLower = env.SHELL.toLowerCase()
    shellType = shellLower.includes("bash") || shellLower.includes("zsh") || shellLower.includes("sh")
      ? (isWindows ? "wsl" : "unix")
      : "unknown"
  } else if (isWindows) {
    shellType = "powershell"
  } else {
    shellType = "unix"
  }

  const isPowerShell = shellType === "pwsh" || shellType === "powershell"
  const preferredSyntax = shellType === "git-bash" || shellType === "wsl" || shellType === "unix"
    ? "bash"
    : shellType === "pwsh" || shellType === "powershell"
    ? "powershell"
    : "cmd"

  const guidance = GUIDANCE[shellType]
  const antiPatterns = (shellType === "pwsh" || shellType === "powershell") && platform !== "win32"
    ? []
    : ANTI_PATTERNS[shellType]

  _cachedShell = { shellType, preferredSyntax, isWindows, isPowerShell, antiPatterns, guidance }

  return _cachedShell
}
