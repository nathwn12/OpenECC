---
description: "Run dependency audit, secret scan, and anti-pattern detection"
---

# Security Scan Command

Run security scan for: $ARGUMENTS

## Three-Phase Scan
### Phase 1: Dependency Audit
- Run `npm audit`, `cargo audit`, `go mod verify`, etc.
- Check for known vulnerabilities

### Phase 2: Secret Scan
- Scan for hardcoded API keys, tokens, passwords
- Check `.env` files and committed secrets

### Phase 3: Anti-Pattern Scan
- `eval()` / `innerHTML` usage
- SQL injection vectors
- Unsafe deserialization
- Hardcoded credentials

## Output
- CRITICAL/HIGH/MEDIUM/LOW severity
- Remediation guidance per finding

---

**TIP**: Run `/security-scan` before every release and after major dependency updates.
