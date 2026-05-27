# OpenECC

A **soul and skills plugin** for [OpenCode](https://opencode.ai).

OpenECC gives every OpenCode session two things:

1. **A soul** — the Karpathy behavioral guidelines, injected as persistent context. Every agent always remembers to think before coding, keep it simple, make surgical changes, and define success criteria.

2. **Skills awareness** — 9 curated engineering skills (TDD, security review, coding standards, backend/frontend patterns, API design, E2E testing, verification loops, strategic compaction) registered and discoverable via OpenCode's native `skill` tool.

No orchestration. No multi-agent swarms. Just constant awareness of good practices.

## Installation

Add OpenECC to the `plugin` array in your `opencode.json` (global or project-level):

```json
{
  "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git"]
}
```

Restart OpenCode. The plugin installs through OpenCode's plugin manager and registers everything automatically.

Verify by asking: "What skills do you have?"

## Skills

| Skill | Description |
|-------|-------------|
| soul | Behavioral guidelines (always loaded) |
| coding-standards | Code quality and style |
| security-review | Vulnerability detection |
| tdd-workflow | Test-driven development |
| backend-patterns | Server-side architecture |
| frontend-patterns | UI/component patterns |
| api-design | REST/API design patterns |
| e2e-testing | Playwright E2E testing |
| verification-loop | Quality gates |
| strategic-compact | Context-preserving compaction |

## Updating

Clear OpenCode's package cache for OpenECC:

**PowerShell:**
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\packages\openecc@git+https_*"
```

**To pin a version:**
```json
{
  "plugin": ["openecc@git+https://github.com/nathwn12/OpenECC.git#v1.0.0"]
}
```

## Development

```bash
bun install       # Install dev dependencies
bun run bundle    # Build plugin bundle
```

## License

MIT
