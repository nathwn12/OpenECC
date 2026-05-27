# Installing OpenECC for OpenCode

## Prerequisites

- [OpenCode.ai](https://opencode.ai) installed

## Installation

Add OpenECC to the `plugin` array in your `opencode.json` (global or project-level):

```json
{
  "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git"]
}
```

Restart OpenCode. The plugin installs through OpenCode's plugin manager and registers its bundled skills automatically.

Verify by asking: "What skills do you have?"

## Updating

OpenCode installs OpenECC through a git-backed package spec. Some OpenCode and Bun versions pin the resolved git dependency in a lockfile, so a restart may not pick up the newest commit. If updates do not appear, clear OpenCode's package cache:

**PowerShell:**
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\packages\openecc@git+https_*"
```

To pin a specific version:

```json
{
  "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git#v1.0.0"]
}
```

## Troubleshooting

### Plugin not loading

1. Check logs: `opencode run --print-logs "hello" 2>&1 | findstr openecc`
2. Verify the plugin line in your `opencode.json`
3. Make sure you're running a recent version of OpenCode

### Skills not found

1. Use the `skill` tool to list what's discovered
2. Check that the plugin is loading (see above)

## Getting Help

- Report issues: https://github.com/nathwn12/OpenECC/issues
