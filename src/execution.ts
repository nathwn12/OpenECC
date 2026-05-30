export interface ExecutionContext {
  attempt: number
  struggleDetected: boolean
  lastErrorPattern: string | null
  compactionCount: number
}

let _ctx: ExecutionContext = {
  attempt: 0,
  struggleDetected: false,
  lastErrorPattern: null,
  compactionCount: 0,
}

export function getExecutionContext(): ExecutionContext {
  return { ..._ctx }
}

export function incrementAttempt(): void {
  _ctx.attempt++
}

export function recordError(pattern: string): void {
  if (_ctx.lastErrorPattern === pattern) {
    _ctx.struggleDetected = true
  }
  _ctx.lastErrorPattern = pattern
}

export function clearStruggle(): void {
  _ctx.struggleDetected = false
  _ctx.lastErrorPattern = null
}

export function resetExecutionContext(): void {
  _ctx = { attempt: 0, struggleDetected: false, lastErrorPattern: null, compactionCount: 0 }
}

export function incrementCompaction(): void {
  _ctx.compactionCount++
}

export function buildExecutionContextBlock(): string {
  const ctx = getExecutionContext()
  const yaml = [
    "type: execution",
    `attempt: ${ctx.attempt}`,
    `struggle_detected: ${ctx.struggleDetected}`,
    `compaction_count: ${ctx.compactionCount}`,
  ].join("\n")
  return `<structured type="execution">\n${yaml}\n</structured>`
}
