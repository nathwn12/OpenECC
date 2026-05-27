---
description: "Start autonomous agent loop for continuous improvement"
---

# Loop Start Command

Start autonomous loop for: $ARGUMENTS

## Loop Phases
1. **Plan** — TODO → evaluate priority, create plan
2. **Do** — Execute plan step
3. **Verify** — Run verification pipeline
4. **Learn** — Extract patterns, save instincts
5. **Repeat** — Continue until completion or explicit stop

## Configuration
- `--interval <seconds>` — Wait between loop iterations
- `--max-iterations <n>` — Maximum loop count
- `--focus <domain>` — Constrain to specific area
- `--stop-on-failure` — Halt loop on verification failure

---

**IMPORTANT**: The loop creates commits and instincts automatically. Use `--max-iterations` to bound execution.
