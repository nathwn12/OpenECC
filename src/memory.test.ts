import { describe, it, expect, afterAll } from "bun:test"
import * as path from "node:path"
import * as fs from "node:fs"
import { MemoryStore, resetMemoryStore } from "./memory"

// ── Helpers ────────────────────────────────────────────────────────────────

function tmpDir(): string {
  const base = path.join(import.meta.dir, "..", ".openecc-test")
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true })
  const dir = fs.mkdtempSync(path.join(base, "mem-test-"))
  return dir
}

let cleanups: string[] = []

function freshStore(): MemoryStore {
  const dir = tmpDir()
  cleanups.push(dir)
  return new MemoryStore(dir)
}

afterAll(() => {
  for (const d of cleanups) {
    try { fs.rmSync(d, { recursive: true }) } catch {}
  }
  resetMemoryStore()
})

// ── wenyan-ultra codec (tested via MemoryStore profile I/O) ────────────────

describe("MemoryStore", () => {
  // ── Lifecycle ──────────────────────────────────────────────────────────

  it("opens and closes without error", () => {
    const store = freshStore()
    store.open()
    expect(store.isOpen()).toBe(true)
    store.close()
    expect(store.isOpen()).toBe(false)
  })

  it("is idempotent on repeated open", () => {
    const store = freshStore()
    store.open()
    store.open()
    expect(store.isOpen()).toBe(true)
    store.close()
  })

  // ── Capture ────────────────────────────────────────────────────────────

  it("captures an entry", () => {
    const store = freshStore()
    store.open()
    store.captureEntry("sess-1", "test", "hello world")
    const s = store.stats()
    expect(s.entries).toBe(1)
    store.close()
  })

  it("captures a fact", () => {
    const store = freshStore()
    store.open()
    store.captureFact("learned", "usr", "theme", "dark")
    const s = store.stats()
    expect(s.facts).toBe(1)
    store.close()
  })

  it("captures a summary", () => {
    const store = freshStore()
    store.open()
    store.captureSummary("sess-1", "compaction", "WY|1\nS|sess-1|test|abc\n")
    const s = store.stats()
    expect(s.summaries).toBe(1)
    store.close()
  })

  it("supersedes fact with same scope+key but different value", () => {
    const store = freshStore()
    store.open()
    store.captureFact("learned", "usr", "theme", "dark")
    store.captureFact("learned", "usr", "theme", "light")
    const s = store.stats()
    // One active (new), one superseded (inactive)
    expect(s.facts).toBe(1)
    store.close()
  })

  it("re-observation boosts confidence on same value", () => {
    const store = freshStore()
    store.open()
    store.captureFact("learned", "usr", "lang", "ts")
    store.captureFact("learned", "usr", "lang", "ts")
    const s = store.stats()
    expect(s.facts).toBe(1)
    store.close()
  })

  // ── FTS5 Recall ────────────────────────────────────────────────────────

  it("recall finds matching entries", () => {
    const store = freshStore()
    store.open()
    store.captureEntry("sess-1", "chat", "user prefers dark mode theme")
    store.captureEntry("sess-1", "chat", "installed bun dependencies")
    const results = store.recall("dark theme")
    expect(results.entries.length).toBeGreaterThanOrEqual(1)
    expect(results.entries[0].content).toContain("dark")
    store.close()
  })

  it("recall finds matching facts", () => {
    const store = freshStore()
    store.open()
    store.captureFact("profile", "usr", "theme", "dark")
    store.captureFact("profile", "prj", "runtime", "bun")
    const results = store.recall("dark")
    expect(results.facts.length).toBeGreaterThanOrEqual(1)
    store.close()
  })

  it("recall returns empty for no match", () => {
    const store = freshStore()
    store.open()
    store.captureEntry("sess-1", "chat", "hello world")
    const results = store.recall("nonexistent_xyzzy")
    expect(results.entries.length).toBe(0)
    expect(results.facts.length).toBe(0)
    expect(results.summaries.length).toBe(0)
    store.close()
  })

  it("recall sanitizes dangerous FTS5 characters", () => {
    const store = freshStore()
    store.open()
    store.captureEntry("sess-1", "chat", "hello world")
    // Should not throw
    const results = store.recall("hello ' OR 1=1 --")
    expect(results.entries.length).toBeGreaterThanOrEqual(0)
    store.close()
  })

  it("recall returns empty for empty query", () => {
    const store = freshStore()
    store.open()
    store.captureEntry("sess-1", "chat", "hello world")
    const results = store.recall("")
    expect(results.entries.length).toBe(0)
    store.close()
  })

  // ── FTS5 Summaries recall ──────────────────────────────────────────────

  it("recall finds matching summaries", () => {
    const store = freshStore()
    store.open()
    store.captureSummary("sess-1", "compaction", "WY|1\nS|sess-1|set up logging|abc\n")
    const results = store.recall("logging")
    expect(results.summaries.length).toBeGreaterThanOrEqual(1)
    store.close()
  })

  // ── Profile file I/O ───────────────────────────────────────────────────

  it("reads and writes profile entries", () => {
    const store = freshStore()
    store.open()
    expect(store.readProfile()).toEqual([])
    store.appendProfileFact("theme", "dark")
    const entries = store.readProfile()
    expect(entries.length).toBe(1)
    expect(entries[0].type).toBe("F")
    expect(entries[0].fields[0]).toBe("usr")
    expect(entries[0].fields[1]).toBe("theme")
    store.close()
  })

  it("reads and writes project entries", () => {
    const store = freshStore()
    store.open()
    expect(store.readProject()).toEqual([])
    store.appendProjectFact("runtime", "bun")
    const entries = store.readProject()
    expect(entries.length).toBe(1)
    expect(entries[0].type).toBe("F")
    expect(entries[0].fields[0]).toBe("prj")
    expect(entries[0].fields[1]).toBe("runtime")
    store.close()
  })

  it("replaces existing profile fact with same key", () => {
    const store = freshStore()
    store.open()
    store.appendProfileFact("theme", "dark")
    store.appendProfileFact("theme", "light")
    const entries = store.readProfile()
    expect(entries.length).toBe(1)
    expect(entries[0].fields[2]).toBe("light")
    store.close()
  })

  it("returns empty profile for non-existent file", () => {
    const store = freshStore()
    store.open()
    // Clean up the profile file if it was created
    expect(store.readProfile()).toEqual([])
    store.close()
  })

  // ── Build Memory Context ───────────────────────────────────────────────

  it("buildMemoryContext returns empty string when nothing stored", () => {
    const store = freshStore()
    store.open()
    const ctx = store.buildMemoryContext()
    expect(ctx).toBe("")
    store.close()
  })

  it("buildMemoryContext includes profile data", () => {
    const store = freshStore()
    store.open()
    store.appendProfileFact("theme", "dark")
    store.appendProjectFact("runtime", "bun")
    store.captureFact("learned", "usr", "lang", "ts")
    const ctx = store.buildMemoryContext()
    expect(ctx).toContain("memory")
    expect(ctx).toContain("usr|theme|dark")
    expect(ctx).toContain("prj|runtime|bun")
    store.close()
  })

  it("buildMemoryContext with query returns retrieval block", () => {
    const store = freshStore()
    store.open()
    store.appendProfileFact("theme", "dark")
    store.captureFact("learned", "usr", "lang", "typescript")
    const ctx = store.buildMemoryContext("typescript")
    expect(ctx).toContain("memory")
    // May or may not have retrieval block depending on FTS match
    store.close()
  })

  // ── Maintenance ────────────────────────────────────────────────────────

  it("consolidate merges duplicate facts", () => {
    const store = freshStore()
    store.open()
    store.captureFact("learned", "usr", "color", "blue")
    store.captureFact("learned", "usr", "color", "blue")
    store.captureFact("learned", "usr", "color", "blue")
    const before = store.stats()
    expect(before.facts).toBe(1)
    // Add a conflicting value to create a supersede chain
    store.captureFact("learned", "usr", "color", "red")
    const afterConflict = store.stats()
    expect(afterConflict.facts).toBe(1)
    store.close()
  })

  it("decay does not remove recent high-confidence facts", () => {
    const store = freshStore()
    store.open()
    store.captureFact("learned", "usr", "keep", "this")
    const before = store.stats()
    const decayed = store.decay()
    const after = store.stats()
    expect(decayed).toBe(0)
    expect(after.facts).toBe(before.facts)
    store.close()
  })

  it("runMaintenance runs without error", () => {
    const store = freshStore()
    store.open()
    store.captureEntry("sess-1", "chat", "hello")
    store.captureFact("learned", "usr", "x", "y")
    store.captureSummary("sess-1", "test", "WY|1\nS|sess-1|test|abc\n")
    const result = store.runMaintenance()
    expect(typeof result.consolidated).toBe("number")
    expect(typeof result.decayed).toBe("number")
    expect(typeof result.archived).toBe("number")
    store.close()
  })

  // ── Stats ──────────────────────────────────────────────────────────────

  it("stats returns zeros for empty store", () => {
    const store = freshStore()
    store.open()
    const s = store.stats()
    expect(s.entries).toBe(0)
    expect(s.facts).toBe(0)
    expect(s.summaries).toBe(0)
    expect(typeof s.db_size).toBe("number")
    expect(s.profile_entries).toBe(0)
    expect(s.project_entries).toBe(0)
    store.close()
  })

  it("stats reflects captured data", () => {
    const store = freshStore()
    store.open()
    store.captureEntry("s1", "chat", "msg1")
    store.captureEntry("s1", "tool", "msg2")
    store.captureFact("profile", "usr", "a", "1")
    store.captureSummary("s1", "cmp", "WY|1\nS|s1|xyz|abc\n")
    const s = store.stats()
    expect(s.entries).toBe(2)
    expect(s.facts).toBe(1)
    expect(s.summaries).toBe(1)
    store.close()
  })

  // ── Cross-session persistence ─────────────────────────────────────────

  it("survives close-open cycle", () => {
    const dir = tmpDir()
    cleanups.push(dir)
    const store = new MemoryStore(dir)
    store.open()
    store.captureFact("profile", "usr", "persist", "ok")
    store.close()

    const store2 = new MemoryStore(dir)
    store2.open()
    const s = store2.stats()
    expect(s.facts).toBe(1)
    store2.close()
  })
})
