import { Database } from "bun:sqlite"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { tool } from "@opencode-ai/plugin"

const SCHEMA_VERSION = 3
const USAGE_RATIO_LOW = 0.15
const USAGE_RATIO_HIGH = 0.3
const USAGE_MIN_INJECTIONS = 5
const INJECTION_EXPIRY_MS = 15000
const MEMORY_DIR = path.join(os.homedir(), ".local", "share", "opencode", "memory")
const MEMORY_DB = "memory.db"
const PROFILE_USER = "memory-profile.wy"
const PROFILE_PROJECT = "memory-project.wy"
const MAX_RECALL = 10
const MAX_PROFILE_ENTRIES = 20
const MAX_PROJECT_ENTRIES = 30
const MAX_ENTRIES_RETURNED = 6
const MAX_FACTS_RETURNED = 8
const MAX_SUMMARIES_RETURNED = 3
const WYL_HEADER = "WYL|v1"

interface WyEntry {
  type: "F" | "E" | "D" | "S"
  fields: string[]
}

interface EntryRow {
  id: number
  session_id: string
  kind: string
  content: string
  source: string
  created_at: number
}

interface FactRow {
  id: number
  tier: string
  scope: string
  key: string
  value: string
  content_wy: string
  source_ref: string
  importance: number
  confidence: number
  supersedes_id: number | null
  created_at: number
  updated_at: number
  active: boolean
}

interface SummaryRow {
  id: number
  session_id: string
  kind: string
  content_wy: string
  source_range_start: string | null
  source_range_end: string | null
  created_at: number
}

interface RecallResult {
  entries: EntryRow[]
  facts: FactRow[]
  summaries: SummaryRow[]
}

interface MemoryStats {
  entries: number
  facts: number
  summaries: number
  db_size: number
  profile_entries: number
  project_entries: number
  total_injections: number
  total_uses: number
  avg_usage_ratio: number
  archived_low_utility: number
}

interface MaintenanceResult {
  consolidated: number
  decayed: number
  archived: number
}

function ts(): string {
  return Date.now().toString(36)
}

function wylEncode(entries: WyEntry[]): string {
  const lines: string[] = [WYL_HEADER]
  for (const e of entries) lines.push([e.type, ...e.fields].join("|"))
  return lines.join("\n") + "\n"
}

function wylDecode(wy: string): WyEntry[] {
  const entries: WyEntry[] = []
  for (const line of wy.split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#") || t.startsWith(WYL_HEADER)) continue
    const parts = t.split("|")
    if (parts.length < 2) continue
    const type = parts[0] as WyEntry["type"]
    if (!["F", "E", "D", "S"].includes(type)) continue
    entries.push({ type, fields: parts.slice(1) })
  }
  return entries
}

function wylFact(scope: string, key: string, value: string, time?: string): WyEntry {
  return { type: "F", fields: [scope, key, value, time ?? ts()] }
}

function wylDir(worktree: string, summary: string, time?: string): WyEntry {
  return { type: "D", fields: [worktree, summary, time ?? ts()] }
}

function wylSummary(sessionId: string, content: string, time?: string): WyEntry {
  return { type: "S", fields: [sessionId, content, time ?? ts()] }
}

export class MemoryStore {
  private db: Database | null = null
  private memoryDir: string
  private opened = false
  private lastInjectedFactIds: number[] = []
  private lastInjectedTime = 0
  private usageCheckedCount = 0

  constructor(baseDir?: string) {
    this.memoryDir = baseDir ?? MEMORY_DIR
  }

  open(): void {
    if (this.opened) return
    fs.mkdirSync(this.memoryDir, { recursive: true })
    const dbPath = path.join(this.memoryDir, MEMORY_DB)
    this.db = new Database(dbPath)
    this.db.exec("PRAGMA journal_mode=WAL")
    this.db.exec("PRAGMA synchronous=NORMAL")
    this.opened = true
    this.applySchema()
  }

  close(): void {
    if (!this.opened || !this.db) return
    try { this.db.exec("INSERT INTO openecc_entries_fts(openecc_entries_fts) VALUES ('optimize')") } catch {}
    try { this.db.exec("INSERT INTO openecc_facts_fts(openecc_facts_fts) VALUES ('optimize')") } catch {}
    try { this.db.exec("INSERT INTO openecc_summaries_fts(openecc_summaries_fts) VALUES ('optimize')") } catch {}
    this.db.close()
    this.db = null
    this.opened = false
  }

  isOpen(): boolean { return this.opened }

  private ensure(): Database {
    if (!this.opened || !this.db) this.open()
    return this.db!
  }

  private applySchema(): void {
    const db = this.db!
    if (!db) return

    db.exec(`
      CREATE TABLE IF NOT EXISTS openecc_schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `)

    const row = db.query(
      "SELECT version FROM openecc_schema_version ORDER BY version DESC LIMIT 1"
    ).get() as { version: number } | null
    const current = row?.version ?? 0

    if (current >= SCHEMA_VERSION) return

    db.exec(`
      CREATE TABLE IF NOT EXISTS openecc_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'event',
        content TEXT NOT NULL,
        content_wy TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        source_ref TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )
    `)

    try { db.exec("ALTER TABLE openecc_entries ADD COLUMN content_wy TEXT NOT NULL DEFAULT ''") } catch {}
    try { db.exec("ALTER TABLE openecc_entries ADD COLUMN source_ref TEXT NOT NULL DEFAULT ''") } catch {}
    try { db.exec("ALTER TABLE openecc_facts ADD COLUMN times_injected INTEGER NOT NULL DEFAULT 0") } catch {}
    try { db.exec("ALTER TABLE openecc_facts ADD COLUMN times_used INTEGER NOT NULL DEFAULT 0") } catch {}

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS openecc_entries_fts USING fts5(
        content,
        content=openecc_entries,
        content_rowid=id,
        tokenize='unicode61'
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS openecc_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tier TEXT NOT NULL DEFAULT 'learned',
        scope TEXT NOT NULL DEFAULT '',
        key TEXT NOT NULL DEFAULT '',
        value TEXT NOT NULL DEFAULT '',
        content_wy TEXT NOT NULL DEFAULT '',
        source_ref TEXT NOT NULL DEFAULT '',
        importance REAL NOT NULL DEFAULT 1.0,
        confidence REAL NOT NULL DEFAULT 0.5,
        supersedes_id INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        times_injected INTEGER NOT NULL DEFAULT 0,
        times_used INTEGER NOT NULL DEFAULT 0
      )
    `)

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS openecc_facts_fts USING fts5(
        content_wy,
        content=openecc_facts,
        content_rowid=id,
        tokenize='unicode61'
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS openecc_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'compaction',
        content_wy TEXT NOT NULL,
        source_range_start TEXT,
        source_range_end TEXT,
        created_at INTEGER NOT NULL
      )
    `)

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS openecc_summaries_fts USING fts5(
        content_wy,
        content=openecc_summaries,
        content_rowid=id,
        tokenize='unicode61'
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS openecc_maintenance (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS openecc_entries_ai
      AFTER INSERT ON openecc_entries BEGIN
        INSERT INTO openecc_entries_fts(rowid, content) VALUES (new.id, new.content);
      END
    `)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS openecc_entries_ad
      AFTER DELETE ON openecc_entries BEGIN
        INSERT INTO openecc_entries_fts(openecc_entries_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
      END
    `)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS openecc_entries_au
      AFTER UPDATE ON openecc_entries BEGIN
        INSERT INTO openecc_entries_fts(openecc_entries_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
        INSERT INTO openecc_entries_fts(rowid, content) VALUES (new.id, new.content);
      END
    `)

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS openecc_facts_ai
      AFTER INSERT ON openecc_facts BEGIN
        INSERT INTO openecc_facts_fts(rowid, content_wy) VALUES (new.id, new.content_wy);
      END
    `)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS openecc_facts_ad
      AFTER DELETE ON openecc_facts BEGIN
        INSERT INTO openecc_facts_fts(openecc_facts_fts, rowid, content_wy)
        VALUES ('delete', old.id, old.content_wy);
      END
    `)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS openecc_facts_au
      AFTER UPDATE ON openecc_facts BEGIN
        INSERT INTO openecc_facts_fts(openecc_facts_fts, rowid, content_wy)
        VALUES ('delete', old.id, old.content_wy);
        INSERT INTO openecc_facts_fts(rowid, content_wy) VALUES (new.id, new.content_wy);
      END
    `)

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS openecc_summaries_ai
      AFTER INSERT ON openecc_summaries BEGIN
        INSERT INTO openecc_summaries_fts(rowid, content_wy) VALUES (new.id, new.content_wy);
      END
    `)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS openecc_summaries_ad
      AFTER DELETE ON openecc_summaries BEGIN
        INSERT INTO openecc_summaries_fts(openecc_summaries_fts, rowid, content_wy)
        VALUES ('delete', old.id, old.content_wy);
      END
    `)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS openecc_summaries_au
      AFTER UPDATE ON openecc_summaries BEGIN
        INSERT INTO openecc_summaries_fts(openecc_summaries_fts, rowid, content_wy)
        VALUES ('delete', old.id, old.content_wy);
        INSERT INTO openecc_summaries_fts(rowid, content_wy) VALUES (new.id, new.content_wy);
      END
    `)

    db.exec(
      "INSERT OR IGNORE INTO openecc_schema_version (version, applied_at) VALUES (?, ?)",
      [SCHEMA_VERSION, Date.now()]
    )
  }

  captureEntry(session_id: string, kind: string, content: string, source = ""): void {
    const db = this.ensure()
    const wyl = wylEncode([{ type: "E", fields: [kind, content.length > 240 ? content.slice(0, 240) + "…" : content, ts()] }])
    db.run(
      "INSERT INTO openecc_entries (session_id, kind, content, content_wy, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [session_id, kind, wyl, wyl, source, Date.now()]
    )
  }

  captureDirVisit(worktree: string, summary: string): void {
    const db = this.ensure()
    const wyl = wylEncode([wylDir(worktree, summary)])
    db.run(
      "INSERT INTO openecc_entries (session_id, kind, content, content_wy, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["", "dir", wyl, wyl, worktree, Date.now()]
    )
  }

  captureFact(
    tier: string, scope: string, key: string, value: string,
    source_ref = ""
  ): void {
    const db = this.ensure()
    const wy = wylEncode([wylFact(scope, key, value)])

    const existing = db.query(
      "SELECT id, value FROM openecc_facts WHERE scope = ? AND key = ? AND active = 1 ORDER BY updated_at DESC LIMIT 1"
    ).get(scope, key) as { id: number; value: string } | null

    if (existing) {
      if (existing.value !== value) {
        db.run("UPDATE openecc_facts SET active = 0, updated_at = ? WHERE id = ?",
          [Date.now(), existing.id])
        db.run(
          `INSERT INTO openecc_facts
           (tier, scope, key, value, content_wy, source_ref, importance, confidence, supersedes_id, created_at, updated_at, active)
           VALUES (?, ?, ?, ?, ?, ?, 1.0, 0.8, ?, ?, ?, 1)`,
          [tier, scope, key, value, wy, source_ref, existing.id, Date.now(), Date.now()]
        )
      } else {
        db.run("UPDATE openecc_facts SET updated_at = ?, source_ref = ? WHERE id = ?",
          [Date.now(), source_ref, existing.id])
      }
    } else {
      db.run(
        `INSERT INTO openecc_facts
         (tier, scope, key, value, content_wy, source_ref, importance, confidence, supersedes_id, created_at, updated_at, active)
         VALUES (?, ?, ?, ?, ?, ?, 1.0, 0.5, NULL, ?, ?, 1)`,
        [tier, scope, key, value, wy, source_ref, Date.now(), Date.now()]
      )
    }
  }

  captureSummary(
    session_id: string, kind: string, content_wy: string,
    range_start?: string, range_end?: string
  ): void {
    const db = this.ensure()
    db.run(
      "INSERT INTO openecc_summaries (session_id, kind, content_wy, source_range_start, source_range_end, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [session_id, kind, content_wy, range_start ?? null, range_end ?? null, Date.now()]
    )
  }

  recall(query: string, limit = MAX_RECALL): RecallResult {
    this.ensure()
    const safe = query.replace(/['"]/g, "").replace(/[*()|&!-]/g, " ").trim()
    if (!safe) return { entries: [], facts: [], summaries: [] }

    const entries: EntryRow[] = []
    const facts: FactRow[] = []
    const summaries: SummaryRow[] = []

    try {
      const rows = this.db!.query(`
        SELECT e.* FROM openecc_entries e
        JOIN openecc_entries_fts fts ON e.id = fts.rowid
        WHERE openecc_entries_fts MATCH ?
        ORDER BY bm25(openecc_entries_fts)
        LIMIT ?
      `).all(safe, limit) as EntryRow[]
      entries.push(...rows)
    } catch {}

    try {
      const rows = this.db!.query(`
        SELECT f.* FROM openecc_facts f
        JOIN openecc_facts_fts fts ON f.id = fts.rowid
        WHERE openecc_facts_fts MATCH ? AND f.active = 1
        ORDER BY bm25(openecc_facts_fts)
        LIMIT ?
      `).all(safe, limit) as FactRow[]
      facts.push(...rows)
    } catch {}

    try {
      const rows = this.db!.query(`
        SELECT s.* FROM openecc_summaries s
        JOIN openecc_summaries_fts fts ON s.id = fts.rowid
        WHERE openecc_summaries_fts MATCH ?
        ORDER BY bm25(openecc_summaries_fts)
        LIMIT ?
      `).all(safe, limit) as SummaryRow[]
      summaries.push(...rows)
    } catch {}

    return { entries, facts, summaries }
  }

  retrieveContext(worktree?: string): string {
    this.ensure()
    const blocks: string[] = []

    const profile = this.readWyFile(PROFILE_USER)
    const project = this.readWyFile(PROFILE_PROJECT)
    if (profile.length || project.length) {
      const lines: string[] = ["<memory type=\"profile\">"]
      if (profile.length) {
        lines.push("P|")
        for (const e of profile) lines.push(e.type + "|" + e.fields.slice(0, -1).join("|"))
      }
      if (project.length) {
        lines.push("D|")
        for (const e of project) lines.push(e.type + "|" + e.fields.slice(0, -1).join("|"))
      }
      lines.push("</memory>")
      blocks.push(lines.join("\n"))
    }

    try {
      let sql = `
        SELECT content, source FROM openecc_entries
        WHERE kind = 'dir' AND created_at > ?
        ORDER BY created_at DESC LIMIT 3
      `
      const weekAgo = Date.now() - 7 * 86400 * 1000
      const recentDirs = this.db!.query(sql).all(weekAgo) as { content: string; source: string }[]
      if (recentDirs.length) {
        const lines: string[] = ["<memory type=\"context\">"]
        for (const d of recentDirs) {
          const entries = wylDecode(d.content)
          for (const e of entries) lines.push("D|" + e.fields.slice(0, -1).join("|"))
        }
        lines.push("</memory>")
        blocks.push(lines.join("\n"))
      }
    } catch {}

    if (worktree) {
      try {
        const matching = this.db!.query(`
          SELECT content FROM openecc_entries
          WHERE source = ? AND kind = 'dir'
          ORDER BY created_at DESC LIMIT 1
        `).all(worktree) as { content: string }[]
        if (matching.length && !blocks.some(b => b.includes("active"))) {
          const lines: string[] = ["<memory type=\"active\">"]
          for (const m of matching) {
            const entries = wylDecode(m.content)
            for (const e of entries) {
              lines.push("D|" + e.fields.slice(0, -1).join("|") + "|active")
            }
          }
          lines.push("</memory>")
          blocks.push(lines.join("\n"))
        }
      } catch {}
    }

    try {
      const topFacts = this.db!.query(`
        SELECT id, content_wy, confidence FROM openecc_facts
        WHERE active = 1 AND tier IN ('profile', 'project', 'learned')
        ORDER BY confidence DESC, updated_at DESC LIMIT ?
      `).all(MAX_FACTS_RETURNED) as { id: number; content_wy: string; confidence: number }[]
      if (topFacts.length) {
        const lines: string[] = ["<memory type=\"facts\">"]
        for (const f of topFacts) {
          const entries = wylDecode(f.content_wy)
          for (const e of entries) {
            lines.push(e.type + "|" + e.fields.slice(0, -1).join("|") + "|c:" + f.confidence.toFixed(1))
          }
        }
        lines.push("</memory>")
        blocks.push(lines.join("\n"))
        this.lastInjectedFactIds = topFacts.map(f => f.id)
        this.lastInjectedTime = Date.now()
        for (const f of topFacts) {
          try { this.db!.run("UPDATE openecc_facts SET times_injected = times_injected + 1, updated_at = ? WHERE id = ?", [Date.now(), f.id]) } catch {}
        }
      }
    } catch {}

    return blocks.join("\n")
  }

  retrieveForMessage(worktree: string, query: string): string {
    this.ensure()
    const blocks: string[] = []

    try {
      const matching = this.db!.query(`
        SELECT id, content, created_at FROM openecc_entries
        WHERE source = ? AND created_at > ?
        ORDER BY created_at DESC LIMIT ?
      `).all(worktree, Date.now() - 30 * 86400 * 1000, MAX_ENTRIES_RETURNED) as { id: number; content: string; created_at: number }[]

      if (matching.length) {
        const lines: string[] = ["<memory type=\"recent\">"]
        for (const m of matching) {
          const entries = wylDecode(m.content)
          for (const e of entries) lines.push(e.type + "|" + e.fields.join("|") + "|wk:" + worktree.replace(/\\/g, "/").split("/").pop())
        }
        lines.push("</memory>")
        blocks.push(lines.join("\n"))
      }
    } catch {}

    if (query) {
      const results = this.recall(query, MAX_RECALL)
      if (results.facts.length || results.entries.length || results.summaries.length) {
        const lines: string[] = ["<memory type=\"retrieved\">"]

        const seenFactIds: number[] = []
        for (const f of results.facts) {
          const entries = wylDecode(f.content_wy)
          for (const e of entries) {
            const match = this.matchWorktree(f.source_ref, worktree)
            lines.push("F|" + e.fields.slice(0, -1).join("|") + "|c:" + f.confidence.toFixed(1) + (match ? "|match" : ""))
          }
          seenFactIds.push(f.id)
        }

        for (const e of results.entries) {
          const entries = wylDecode(e.content)
          for (const entry of entries) {
            lines.push(entry.type + "|" + entry.fields.join("|") + "|src:" + (e.source ? e.source.replace(/\\/g, "/").split("/").pop()! : "global"))
          }
        }

        for (const s of results.summaries) {
          const trimmed = s.content_wy.trim()
          if (trimmed) lines.push("S|" + trimmed.replace(/\n/g, "\\n"))
        }
        lines.push("</memory>")
        blocks.push(lines.join("\n"))

        if (seenFactIds.length) {
          this.lastInjectedFactIds = seenFactIds
          this.lastInjectedTime = Date.now()
          const now = Date.now()
          for (const id of seenFactIds) {
            try { this.db!.run("UPDATE openecc_facts SET times_injected = times_injected + 1, updated_at = ? WHERE id = ?", [now, id]) } catch {}
          }
        }
      }
    }

    return blocks.join("\n")
  }

  private matchWorktree(sourceRef: string, worktree: string): boolean {
    if (!sourceRef || !worktree) return false
    return sourceRef.includes(worktree.replace(/\\/g, "/").split("/").pop()!)
  }

  buildMemoryContext(query?: string): string {
    this.ensure()
    const blocks: string[] = []

    const profile = this.readWyFile(PROFILE_USER)
    const project = this.readWyFile(PROFILE_PROJECT)
    if (profile.length || project.length) {
      const lines: string[] = ["<structured type=\"memory\">"]
      if (profile.length) {
        lines.push("profile:")
        for (const e of profile) lines.push(`  - ${e.type}|${e.fields.join("|")}`)
      }
      if (project.length) {
        lines.push("project:")
        for (const e of project) lines.push(`  - ${e.type}|${e.fields.join("|")}`)
      }
      lines.push("</structured>")
      blocks.push(lines.join("\n"))
    }

    try {
      const recent = this.db!.query(`
        SELECT content_wy FROM openecc_facts
        WHERE active = 1 AND tier IN ('profile', 'project', 'learned')
        ORDER BY confidence DESC, updated_at DESC LIMIT 8
      `).all() as { content_wy: string }[]
      if (recent.length) {
        const lines = ["<structured type=\"memory_facts\">"]
        for (const f of recent) {
          const trimmed = f.content_wy.trim()
          if (trimmed) lines.push(trimmed)
        }
        lines.push("</structured>")
        blocks.push(lines.join("\n"))
      }
    } catch {}

    if (query) {
      const results = this.recall(query, 5)
      if (results.facts.length) {
        const lines = ["<structured type=\"memory_retrieved\">"]
        for (const f of results.facts) {
          const conf = f.confidence.toFixed(1)
          lines.push(`  F|${f.scope}|${f.key}=${f.value}|c:${conf}`)
        }
        lines.push("</structured>")
        blocks.push(lines.join("\n"))
      }
    }

    return blocks.join("\n\n")
  }

  private wyFilePath(name: string): string {
    return path.join(this.memoryDir, name)
  }

  private readWyFile(name: string): WyEntry[] {
    try {
      return wylDecode(fs.readFileSync(this.wyFilePath(name), "utf8"))
    } catch {
      return []
    }
  }

  private writeWyFile(name: string, entries: WyEntry[]): void {
    const fp = this.wyFilePath(name)
    const tmp = fp + ".tmp." + process.pid
    fs.writeFileSync(tmp, wylEncode(entries))
    fs.renameSync(tmp, fp)
  }

  readProfile(): WyEntry[] { return this.readWyFile(PROFILE_USER) }
  readProject(): WyEntry[] { return this.readWyFile(PROFILE_PROJECT) }

  writeProfile(entries: WyEntry[]): void {
    if (entries.length > MAX_PROFILE_ENTRIES) entries = entries.slice(-MAX_PROFILE_ENTRIES)
    this.writeWyFile(PROFILE_USER, entries)
  }

  writeProject(entries: WyEntry[]): void {
    if (entries.length > MAX_PROJECT_ENTRIES) entries = entries.slice(-MAX_PROJECT_ENTRIES)
    this.writeWyFile(PROFILE_PROJECT, entries)
  }

  appendProfileFact(key: string, value: string): void {
    const entries = this.readProfile()
    const filtered = entries.filter(
      e => !(e.type === "F" && e.fields[0] === "usr" && e.fields[1] === key)
    )
    filtered.push(wylFact("usr", key, value))
    this.writeProfile(filtered)
  }

  appendProjectFact(key: string, value: string): void {
    const entries = this.readProject()
    const filtered = entries.filter(
      e => !(e.type === "F" && e.fields[0] === "prj" && e.fields[1] === key)
    )
    filtered.push(wylFact("prj", key, value))
    this.writeProject(filtered)
  }

  markFactUsed(factId: number): void {
    const db = this.ensure()
    try {
      db.run("UPDATE openecc_facts SET times_used = times_used + 1, confidence = MIN(confidence + 0.05, 1.0), updated_at = ? WHERE id = ? AND active = 1",
        [Date.now(), factId])
    } catch {}
  }

  checkFactUsageFromArgs(toolName: string, args?: Record<string, unknown>): void {
    const elapsed = Date.now() - this.lastInjectedTime
    if (elapsed > INJECTION_EXPIRY_MS || !this.lastInjectedFactIds.length) return
    const argText = Object.values(args ?? {}).join(" ").toLowerCase()
    if (!argText || argText.length < 3) return
    try {
      const recentlyInjected = this.db!.query(
        "SELECT id, scope, key, value FROM openecc_facts WHERE id IN (" + this.lastInjectedFactIds.join(",") + ") AND active = 1"
      ).all() as { id: number; scope: string; key: string; value: string }[]
      for (const fact of recentlyInjected) {
        const searchTerms = [fact.scope, fact.key, fact.value].filter(t => t.length > 2).map(t => t.toLowerCase())
        if (searchTerms.length && searchTerms.some(term => argText.includes(term))) {
          this.markFactUsed(fact.id)
          this.usageCheckedCount++
        }
      }
    } catch {}
  }

  consolidate(): number {
    const db = this.ensure()
    let merged = 0
    const dups = db.query(`
      SELECT scope, key, COUNT(*) as cnt FROM openecc_facts
      WHERE active = 1 GROUP BY scope, key HAVING cnt > 1
    `).all() as { scope: string; key: string; cnt: number }[]

    for (const d of dups) {
      const rows = db.query(`
        SELECT id, confidence, updated_at FROM openecc_facts
        WHERE active = 1 AND scope = ? AND key = ?
        ORDER BY updated_at DESC
      `).all(d.scope, d.key) as { id: number; confidence: number; updated_at: number }[]

      if (rows.length <= 1) continue
      const [keep, ...stale] = rows
      for (const s of stale) {
        db.run("UPDATE openecc_facts SET active = 0, supersedes_id = ?, updated_at = ? WHERE id = ?",
          [keep.id, Date.now(), s.id])
        merged++
      }
      const avgConf = rows.reduce((sum, r) => sum + r.confidence, 0) / rows.length
      const boost = Math.min(avgConf + 0.1, 1.0)
      db.run("UPDATE openecc_facts SET confidence = ?, updated_at = ? WHERE id = ?",
        [boost, Date.now(), keep.id])
    }

    // Usage-based adjustment: boost or penalize based on injection-to-usage ratio
    const usageCandidates = db.query(`
      SELECT id, times_injected, times_used, confidence FROM openecc_facts
      WHERE active = 1 AND times_injected >= ?
    `).all(USAGE_MIN_INJECTIONS) as { id: number; times_injected: number; times_used: number; confidence: number }[]

    let archived = 0
    for (const u of usageCandidates) {
      const ratio = u.times_used / u.times_injected
      if (ratio < USAGE_RATIO_LOW) {
        db.run("UPDATE openecc_facts SET confidence = ROUND(confidence * 0.5, 2), updated_at = ? WHERE id = ?",
          [Date.now(), u.id])
      } else if (ratio > USAGE_RATIO_HIGH) {
        db.run("UPDATE openecc_facts SET confidence = MIN(ROUND(confidence + 0.1, 2), 1.0), updated_at = ? WHERE id = ?",
          [Date.now(), u.id])
      }
    }

    return merged
  }

  decay(): number {
    const db = this.ensure()
    const cutoff = Date.now() - 90 * 86400 * 1000
    const result = db.run(
      `UPDATE openecc_facts SET active = 0, updated_at = ?
       WHERE active = 1 AND tier IN ('episodic', 'working') AND updated_at < ? AND confidence < 0.3`,
      [Date.now(), cutoff]
    )

    // Also archive actively unused facts with very low confidence from repeated penalties
    const unusedResult = db.run(
      `UPDATE openecc_facts SET active = 0, updated_at = ?
       WHERE active = 1 AND times_injected >= ? AND times_used = 0 AND confidence < 0.2`,
      [Date.now(), USAGE_MIN_INJECTIONS * 2]
    )

    return result.changes + unusedResult.changes
  }

  compactEntries(maxAgeDays = 90): number {
    const db = this.ensure()
    const cutoff = Date.now() - maxAgeDays * 86400 * 1000
    const result = db.run("DELETE FROM openecc_entries WHERE created_at < ?", [cutoff])
    return result.changes
  }

  optimize(): void {
    const cmds = [
      "openecc_entries_fts",
      "openecc_facts_fts",
      "openecc_summaries_fts",
    ]
    for (const tbl of cmds) {
      try { this.db!.exec(`INSERT INTO ${tbl}(${tbl}) VALUES ('optimize')`) } catch {}
    }
  }

  runMaintenance(): MaintenanceResult {
    const consolidated = this.consolidate()
    const decayed = this.decay()
    const archived = this.compactEntries()
    this.optimize()
    return { consolidated, decayed, archived }
  }

  stats(): MemoryStats {
    this.ensure()
    function count(db: Database, sql: string): number {
      try { return (db.query(sql).get() as { c: number })?.c ?? 0 } catch { return 0 }
    }
    function sum(db: Database, sql: string): number {
      try { return (db.query(sql).get() as { s: number })?.s ?? 0 } catch { return 0 }
    }
    let dbSize = 0
    try { dbSize = fs.statSync(this.wyFilePath(MEMORY_DB)).size } catch {}

    const totalInjections = sum(this.db!, "SELECT COALESCE(SUM(times_injected),0) as s FROM openecc_facts WHERE active = 1")
    const totalUses = sum(this.db!, "SELECT COALESCE(SUM(times_used),0) as s FROM openecc_facts WHERE active = 1")
    const avgRatio = totalInjections > 0 ? parseFloat((totalUses / totalInjections).toFixed(2)) : 0
    const archivedLow = count(this.db!, "SELECT COUNT(*) as c FROM openecc_facts WHERE active = 0 AND times_injected > 0")

    return {
      entries: count(this.db!, "SELECT COUNT(*) as c FROM openecc_entries"),
      facts: count(this.db!, "SELECT COUNT(*) as c FROM openecc_facts WHERE active = 1"),
      summaries: count(this.db!, "SELECT COUNT(*) as c FROM openecc_summaries"),
      db_size: dbSize,
      profile_entries: this.readProfile().length,
      project_entries: this.readProject().length,
      total_injections: totalInjections,
      total_uses: totalUses,
      avg_usage_ratio: avgRatio,
      archived_low_utility: archivedLow,
    }
  }
}

let _store: MemoryStore | null = null

function getStore(): MemoryStore {
  if (!_store) {
    _store = new MemoryStore()
    _store.open()
  }
  return _store
}

function closeStore(): void {
  if (_store) {
    _store.close()
    _store = null
  }
}

export function resetMemoryStore(): void {
  closeStore()
}

export const memory_recall = tool({
  description: "Search persistent local memory for facts, decisions, and context from this or previous sessions. Results include stable profile facts, learned facts, past summaries, and journal entries. Call this when you need to recall user preferences, project conventions, past decisions, or any contextual information the model may not remember.",
  args: {
    query: tool.schema.string().describe("Keywords or phrases to search memory for"),
    limit: tool.schema.number().optional().describe("Max results (default 10)"),
  },
  async execute(args, context) {
    const store = getStore()
    const results = store.recall(args.query as string, (args.limit as number) ?? MAX_RECALL)
    const parts: string[] = []

    if (results.facts.length) {
      parts.push("## Memory Facts")
      for (const f of results.facts) {
        const tier = f.tier
        parts.push(`- [${tier}] ${f.scope}:${f.key}=${f.value}  (confidence: ${f.confidence.toFixed(1)})`)
      }
    }

    if (results.summaries.length) {
      parts.push("## Past Summaries")
      for (const s of results.summaries) {
        const wy = s.content_wy.trim()
        parts.push(`- [${s.kind}] ${wy}`)
      }
    }

    if (results.entries.length) {
      parts.push("## Journal Entries")
      for (const e of results.entries) {
        const entries = wylDecode(e.content)
        const preview = entries.length ? entries[0].fields.join("|") : (e.content.length > 200 ? e.content.slice(0, 200) + "…" : e.content)
        parts.push(`- [${e.kind}] ${preview}`)
      }
    }

    if (!parts.length) return "No matching memory found."
    return parts.join("\n\n")
  },
})

export const memory_status = tool({
  description: "View memory system health: entry count, fact count, database size, and profile size. Run this to check if memory is working or diagnose storage issues.",
  args: {},
  async execute(_args, context) {
    const store = getStore()
    const s = store.stats()
    const usageLine = s.total_injections > 0
      ? `- Usage: ${s.total_uses}/${s.total_injections} (ratio ${s.avg_usage_ratio}) — archived ${s.archived_low_utility} low-utility facts`
      : "- Usage: collecting..."
    return [
      "## Memory Status",
      `- Entries: ${s.entries}  |  Active facts: ${s.facts}  |  Summaries: ${s.summaries}`,
      `- Database: ${formatBytes(s.db_size)}`,
      `- Profile: ${s.profile_entries} entries  |  Project: ${s.project_entries} entries`,
      usageLine,
      "—",
      "Self-improving: facts boost confidence when used, decay when ignored. No manual tuning needed.",
    ].join("\n")
  },
})

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / 1048576).toFixed(1) + " MB"
}

// ── Auto-injection hooks (called from plugin.ts) ──────────────────────────

export function injectSessionMemory(worktree?: string): string {
  const store = getStore()
  return store.retrieveContext(worktree)
}

export function injectMessageMemory(worktree: string, userMessage: string): string {
  const store = getStore()
  return store.retrieveForMessage(worktree, userMessage)
}

// ── Context builder (for compaction hook) ──────────────────────────────────

export function buildMemoryContinuityBlock(worktree?: string): string {
  const store = getStore()
  const ctx = store.buildMemoryContext()
  if (!ctx) return ""
  return [
    "## OpenECC Memory Context (preserve across compaction)",
    "",
    "This block holds persistent memory — facts, profile, and project context.",
    "It survives compaction and grows more useful over time.",
    "",
    ctx,
  ].join("\n")
}

// ── Lifecycle helpers (for plugin hooks) ───────────────────────────────────

export function onSessionCreated(sessionId: string, worktree?: string): void {
  const store = getStore()
  store.captureEntry(sessionId, "session", "session_start")
  if (worktree) {
    const dirName = worktree.replace(/\\/g, "/").split("/").pop() || worktree
    store.captureDirVisit(worktree, dirName)
  }
  store.runMaintenance()
}

export function onSessionDeleted(): void {
  closeStore()
}

export function onFileEdited(filePath: string): void {
  const store = getStore()
  store.captureEntry("", "file", filePath, "file.edited")
}

export function onToolExecuted(
  toolName: string, args?: Record<string, unknown>
): void {
  const entryPoint = (args?.filePath as string) || (args?.command as string) || ""
  if (entryPoint) {
    const store = getStore()
    store.captureEntry("", "tool", `${toolName}: ${entryPoint}`, toolName)
    store.checkFactUsageFromArgs(toolName, args)
  }
}
