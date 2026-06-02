import { describe, it, expect } from "bun:test"
import { buildExecutionContextBlock, clearStruggle, createExecutionContext, incrementAttempt, incrementCompaction, recordError, resetExecutionContext } from "./execution"

describe("execution", () => {
  it("updates an explicit context object", () => {
    const ctx = createExecutionContext()
    incrementAttempt(ctx)
    incrementCompaction(ctx)
    recordError(ctx, "E1")
    recordError(ctx, "E1")

    expect(ctx.attempt).toBe(1)
    expect(ctx.compactionCount).toBe(1)
    expect(ctx.struggleDetected).toBe(true)
  })

  it("resets and clears struggle on the passed context", () => {
    const ctx = createExecutionContext()
    recordError(ctx, "E1")
    clearStruggle(ctx)
    resetExecutionContext(ctx)

    expect(ctx.attempt).toBe(0)
    expect(ctx.struggleDetected).toBe(false)
    expect(ctx.lastErrorPattern).toBeNull()
    expect(ctx.compactionCount).toBe(0)
  })

  it("builds an execution block from the passed context", () => {
    const ctx = createExecutionContext()
    incrementAttempt(ctx)
    const block = buildExecutionContextBlock(ctx)

    expect(block).toContain("type: execution")
    expect(block).toContain("attempt: 1")
  })
})
