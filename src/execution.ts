interface ExecutionContext {
  attempt: number
  struggleDetected: boolean
  lastErrorPattern: string | null
  compactionCount: number
}

export function createExecutionContext(): ExecutionContext {
  return {
    attempt: 0,
    struggleDetected: false,
    lastErrorPattern: null,
    compactionCount: 0,
  }
}

export function incrementAttempt(ctx: ExecutionContext): void {
  ctx.attempt++
}

export function recordError(ctx: ExecutionContext, pattern: string): void {
  if (ctx.lastErrorPattern === pattern) {
    ctx.struggleDetected = true
  }
  ctx.lastErrorPattern = pattern
}

export function clearStruggle(ctx: ExecutionContext): void {
  ctx.struggleDetected = false
  ctx.lastErrorPattern = null
}

export function resetExecutionContext(ctx: ExecutionContext): void {
  ctx.attempt = 0
  ctx.struggleDetected = false
  ctx.lastErrorPattern = null
  ctx.compactionCount = 0
}

export function incrementCompaction(ctx: ExecutionContext): void {
  ctx.compactionCount++
}

export function buildExecutionContextBlock(ctx: ExecutionContext): string {
  const yaml = [
    "type: execution",
    `attempt: ${ctx.attempt}`,
    `struggle_detected: ${ctx.struggleDetected}`,
    `compaction_count: ${ctx.compactionCount}`,
  ].join("\n")
  return `<structured type="execution">\n${yaml}\n</structured>`
}
