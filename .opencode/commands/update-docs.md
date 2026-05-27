---
description: "Update project documentation to match current codebase state"
agent: openecc:doc-updater
subtask: true
---

# Update Docs Command

Update documentation for: $ARGUMENTS

## Your Task
1. Identify docs that reference the affected code
2. Cross-reference code vs documentation for accuracy
3. Update stale content, examples, API signatures
4. Flag missing documentation for new features

## Approach
### DO:
- Update inline JSDoc/rustdoc comments
- Sync README examples with actual API
- Document breaking changes clearly

### DON'T:
- Don't create new docs files unless requested
- Don't add speculative documentation for unimplemented features
- Don't rewrite docs style — match existing tone

---

**TIP**: Focus on correctness first, completeness second.
