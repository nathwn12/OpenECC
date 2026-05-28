---
description: "Review code for quality, security, and maintainability"
agent: code-reviewer
---

# Code Review Command

Review code changes for quality, security, and maintainability: $ARGUMENTS

## Your Task
1. **Get changed files**: Run `git diff --name-only HEAD`
2. **Analyze each file** for issues
3. **Generate structured report** with severity levels
4. **Provide actionable recommendations** with specific fixes

## Approval Criteria
- **CRITICAL or HIGH issues**: Block, require fixes before commit
- **MEDIUM issues**: Recommend fixes before merge
- **LOW issues**: Optional improvements
