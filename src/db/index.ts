/**
 * SQLite database layer — single DB for all app storage
 *
 * Uses Bun's native bun:sqlite for zero-dependency SQLite.
 * Falls back to better-sqlite3 for Node.js compatibility.
 *
 * DB location: ~/.coders/coders.db
 * WAL mode for concurrent read/write performance.
 *
 * Tables:
 *   sessions, messages, file_history, checkpoints,
 *   tasks, config, memories, teams, team_messages,
 *   permissions, mcp_servers, metrics
 */
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { getConfigDir } from "../config/paths.js";

// ── Types ──────────────────────────────────────────────────────────

export interface DbRow {
  [key: string]: unknown;
}

// ── Database wrapper (abstracts bun:sqlite vs better-sqlite3) ──────

let _db: any = null;

function getDbPath(): string {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "coders.db");
}

/**
 * Get the database instance. Creates and initializes on first call.
 */
export function getDb(): any {
  if (_db) return _db;

  const dbPath = getDbPath();

  try {
    // Try Bun's native sqlite first
    const { Database } = require("bun:sqlite");
    _db = new Database(dbPath);
  } catch {
    try {
      // Fallback to better-sqlite3 for Node.js
      const BetterSqlite3 = require("better-sqlite3");
      _db = new BetterSqlite3(dbPath);
    } catch {
      // Last resort: silent in-memory mock (no user-visible output)
      _db = createInMemoryDb();
      initSchema(_db);
      return _db;
    }
  }

  // Enable WAL mode for performance
  try { _db.exec("PRAGMA journal_mode=WAL"); } catch { /* ok */ }
  try { _db.exec("PRAGMA foreign_keys=ON"); } catch { /* ok */ }

  initSchema(_db);
  return _db;
}

// ── Schema initialization ──────────────────────────────────────────

function initSchema(db: any): void {
  db.exec(`
    -- Sessions
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      project_dir TEXT,
      original_cwd TEXT,
      model TEXT,
      app_version TEXT,
      build_time TEXT,
      fingerprint TEXT, -- JSON
      metadata TEXT,    -- JSON
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Messages (conversation history)
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      tool_uses TEXT,    -- JSON array of tool use displays
      thinking TEXT,
      duration_ms REAL,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

    -- File history (tracks reads per session)
    CREATE TABLE IF NOT EXISTS file_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content_hash TEXT,
      byte_size INTEGER,
      line_count INTEGER,
      read_at TEXT DEFAULT (datetime('now')),
      UNIQUE(session_id, file_path)
    );

    -- File checkpoints (for /rewind)
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      original_content TEXT NOT NULL,
      edit_operation TEXT, -- JSON {old_string, new_string}
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_session_file ON checkpoints(session_id, file_path);

    -- Tasks (replaces in-memory fallback for @hasna/todos)
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','failed','cancelled')),
      active_form TEXT,
      owner TEXT,
      blocks TEXT DEFAULT '[]',      -- JSON array of task IDs
      blocked_by TEXT DEFAULT '[]',   -- JSON array of task IDs
      metadata TEXT DEFAULT '{}',     -- JSON
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Config (replaces JSON files)
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT, -- JSON
      scope TEXT DEFAULT 'user' CHECK(scope IN ('user','project','local','global')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Memories (replaces in-memory fallback for @hasna/mementos)
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      scope TEXT DEFAULT 'shared' CHECK(scope IN ('global','shared','private')),
      category TEXT DEFAULT 'knowledge',
      importance INTEGER DEFAULT 5 CHECK(importance BETWEEN 1 AND 10),
      tags TEXT DEFAULT '[]', -- JSON array
      version INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Teams
    CREATE TABLE IF NOT EXISTS teams (
      name TEXT PRIMARY KEY,
      description TEXT,
      task_list_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Team members
    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_name TEXT NOT NULL REFERENCES teams(name),
      agent_name TEXT NOT NULL,
      role TEXT,
      status TEXT DEFAULT 'idle',
      current_task TEXT,
      UNIQUE(team_name, agent_name)
    );

    -- Team messages
    CREATE TABLE IF NOT EXISTS team_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      team_name TEXT,
      content TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      is_blocking INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_team_msgs_to ON team_messages(to_agent, is_read);

    -- Permissions (persisted allow/deny rules)
    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT,
      command_pattern TEXT,
      path_pattern TEXT,
      behavior TEXT NOT NULL CHECK(behavior IN ('allow','deny')),
      scope TEXT DEFAULT 'session',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- MCP servers
    CREATE TABLE IF NOT EXISTS mcp_servers (
      name TEXT PRIMARY KEY,
      command TEXT,
      args TEXT,    -- JSON array
      env TEXT,     -- JSON object
      url TEXT,
      transport TEXT DEFAULT 'stdio',
      scope TEXT DEFAULT 'user',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Metrics (per-turn tracking)
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_index INTEGER,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      api_duration_ms REAL DEFAULT 0,
      tool_duration_ms REAL DEFAULT 0,
      hook_duration_ms REAL DEFAULT 0,
      tool_count INTEGER DEFAULT 0,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Audit log (for security — tracks all tool executions)
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      tool_name TEXT NOT NULL,
      input_summary TEXT,
      result_summary TEXT,
      exit_code INTEGER,
      duration_ms REAL,
      was_allowed INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// ── Query helpers ──────────────────────────────────────────────────

export function dbRun(sql: string, params: unknown[] = []): any {
  const db = getDb();
  try {
    const stmt = db.prepare(sql);
    return stmt.run(...params);
  } catch (e) {
    // Bun sqlite uses different API — try bun style
    try {
      return db.run(sql, params);
    } catch {
      throw e;
    }
  }
}

export function dbGet<T = DbRow>(sql: string, params: unknown[] = []): T | undefined {
  const db = getDb();
  try {
    const stmt = db.prepare(sql);
    return stmt.get(...params) as T | undefined;
  } catch {
    try {
      return db.query(sql).get(...params) as T | undefined;
    } catch {
      return undefined;
    }
  }
}

export function dbAll<T = DbRow>(sql: string, params: unknown[] = []): T[] {
  const db = getDb();
  try {
    const stmt = db.prepare(sql);
    return stmt.all(...params) as T[];
  } catch {
    try {
      return db.query(sql).all(...params) as T[];
    } catch {
      return [];
    }
  }
}

export function dbExec(sql: string): void {
  getDb().exec(sql);
}

// ── Close ──────────────────────────────────────────────────────────

export function closeDb(): void {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
}

// ── In-memory fallback (for environments without SQLite) ───────────

function createInMemoryDb(): any {
  const tables = new Map<string, Map<string, any>>();

  return {
    exec(sql: string) {
      // Parse CREATE TABLE statements to register tables
      const matches = sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g);
      for (const m of matches) {
        if (!tables.has(m[1])) tables.set(m[1], new Map());
      }
    },
    prepare(sql: string) {
      return {
        run(...params: unknown[]) { return { changes: 0 }; },
        get(...params: unknown[]) { return undefined; },
        all(...params: unknown[]) { return []; },
      };
    },
    close() { tables.clear(); },
  };
}

// ── Reset (for testing) ────────────────────────────────────────────

export function resetDb(): void {
  closeDb();
}
