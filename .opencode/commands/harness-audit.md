---
description: "Audit harness configuration quality and consistency"
---

# Harness Audit Command

Audit harness configuration: $ARGUMENTS

## Your Task
1. **Validate structure** — Check `.opencode/` directory layout completeness
2. **Check command files** — Verify frontmatter, valid YAML, required sections
3. **Verify skill references** — Commands reference existing agents/skills
4. **Check consistency** — Uniform style across all command files
5. **Report findings** — Missing, broken, or inconsistent configurations

## Criteria
- ⚠️ Critical: Missing required directory/file
- ⚠️ High: Invalid frontmatter or broken reference
- ⚠️ Medium: Inconsistent formatting
- ℹ️ Low: Style suggestions

---

**TIP**: Run `/harness-audit` after creating or modifying commands to catch issues early.
