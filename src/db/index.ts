/**
 * SQLite database layer — single DB for all app storage
 *
 * Uses Bun's native bun:sqlite when running under Bun.
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
import { createRequire } from "module";
import { join, resolve } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { getConfigDir } from "../config/paths.js";

const require = createRequire(import.meta.url);

// ── Types ──────────────────────────────────────────────────────────

export interface DbRow {
  [key: string]: unknown;
}

// ── Database wrapper (abstracts bun:sqlite vs better-sqlite3) ──────

let _db: any = null;

function getDbPath(): string {
  const dataDirOverride = process.env.CODERS_DATA_DIR;
  if (dataDirOverride) {
    const dir = resolve(dataDirOverride);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, "coders.db");
  }

  if (process.env.CODERS_CONFIG_DIR) {
    const dir = getConfigDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, "coders.db");
  }

  // New path: ~/.hasna/coders/
  const home = homedir();
  const newDir = join(home, ".hasna", "coders");
  const newPath = join(newDir, "coders.db");

  // Backward compat: check old ~/.coders/ path
  const oldDir = getConfigDir();
  const oldPath = join(oldDir, "coders.db");
  if (existsSync(oldPath) && !existsSync(newPath)) {
    // Use old path if new path doesn't exist yet
    return oldPath;
  }

  // Use new path
  if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true });
  return newPath;
}

export function getDbFallbackPath(): string {
  const dataDirOverride = process.env.CODERS_DATA_DIR;
  if (dataDirOverride) {
    const dir = resolve(dataDirOverride);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, "coders-fallback.json");
  }

  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "coders-fallback.json");
}

/**
 * Get the database instance. Creates and initializes on first call.
 * Keeps runtime-specific SQLite imports lazy so Node can import this module.
 */
export function getDb(): any {
  if (_db) return _db;

  const dbPath = getDbPath();

  try {
    if (process.versions.bun) {
      const { Database } = require("bun:sqlite");
      _db = new Database(dbPath);
    } else {
      const BetterSqlite3 = require("better-sqlite3");
      _db = new BetterSqlite3(dbPath);
    }
  } catch {
    try {
      const BetterSqlite3 = require("better-sqlite3");
      _db = new BetterSqlite3(dbPath);
    } catch {
      // Last resort: silent JSON-file storage (no user-visible output)
      _db = createJsonFileDb();
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

    -- Conversation checkpoints (for /checkpoint and /restore)
    CREATE TABLE IF NOT EXISTS conversation_checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      label TEXT DEFAULT '',
      messages TEXT NOT NULL,  -- JSON array of {role, content} messages
      message_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conv_checkpoints_session ON conversation_checkpoints(session_id);

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

    -- Feedback
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      message TEXT NOT NULL,
      email TEXT,
      category TEXT DEFAULT 'general',
      version TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

// ── JSON-file fallback (for environments without SQLite) ────────────
//
// Persists data to ~/.coders/coders-fallback.json. Implements the subset
// of the better-sqlite3 API that this codebase uses: exec, prepare (with
// run/get/all), and close.  Completely silent — no console output.

interface JsonStore {
  tables: Record<string, Record<string, unknown>[]>;
  autoInc: Record<string, number>;
}

function createJsonFileDb(): any {
  const storePath = getDbFallbackPath();
  let store: JsonStore = { tables: {}, autoInc: {} };

  // Load existing data from disk
  try {
    if (existsSync(storePath)) {
      store = JSON.parse(readFileSync(storePath, "utf-8"));
      if (!store.tables) store.tables = {};
      if (!store.autoInc) store.autoInc = {};
    }
  } catch { /* corrupt file — start fresh */ }

  let _flushTimer: ReturnType<typeof setTimeout> | null = null;
  function writeStore(): void {
    try { writeFileSync(storePath, JSON.stringify(store), "utf-8"); } catch { /* silent */ }
  }

  function flush(): void {
    // Debounce: batch rapid writes into a single disk flush (100ms)
    if (_flushTimer) return;
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      writeStore();
    }, 100);
  }

  function flushNow(): void {
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
    writeStore();
  }

  // Ensure final flush on exit
  process.once("beforeExit", flushNow);

  function ensureTable(name: string): void {
    if (!store.tables[name]) {
      store.tables[name] = [];
      store.autoInc[name] = 0;
    }
  }

  function now(): string {
    return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  }

  // ── SQL parsing helpers ──────────────────────────────────────────

  function parseInsert(sql: string, params: unknown[]): { changes: number; lastInsertRowid: number } {
    const m = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (!m) return { changes: 0, lastInsertRowid: 0 };

    const table = m[1];
    ensureTable(table);

    const cols = m[2].split(",").map(c => c.trim());
    const valuePlaceholders = m[3].split(",").map(v => v.trim());

    const row: Record<string, unknown> = {};
    let paramIdx = 0;
    for (let i = 0; i < cols.length; i++) {
      const ph = valuePlaceholders[i];
      if (ph === "?") {
        row[cols[i]] = params[paramIdx++];
      } else if (/^datetime\(/i.test(ph)) {
        row[cols[i]] = now();
      } else {
        // Literal value — strip quotes
        row[cols[i]] = ph.replace(/^['"]|['"]$/g, "");
      }
    }

    // Auto-increment for INTEGER PRIMARY KEY
    if (!row["id"] && store.autoInc[table] !== undefined) {
      store.autoInc[table]++;
      row["id"] = store.autoInc[table];
    }

    store.tables[table].push(row);
    flush();
    return { changes: 1, lastInsertRowid: typeof row["id"] === "number" ? row["id"] : 0 };
  }

  function parseSelect(sql: string, params: unknown[]): Record<string, unknown>[] {
    const m = sql.match(/SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i);
    if (!m) return [];

    const table = m[2];
    if (!store.tables[table]) return [];

    let rows = [...store.tables[table]];

    // Apply WHERE clause (simple single-condition matching)
    if (m[3]) {
      const whereParts = m[3].trim();
      // Handle "col = ?" pattern
      const wm = whereParts.match(/(\w+)\s*=\s*\?/);
      if (wm && params.length > 0) {
        const col = wm[1];
        const val = params[0];
        rows = rows.filter(r => r[col] === val);
      }
    }

    // Apply LIMIT
    if (m[5]) {
      rows = rows.slice(0, parseInt(m[5], 10));
    }

    return rows;
  }

  function parseUpdate(sql: string, params: unknown[]): { changes: number } {
    const m = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)/i);
    if (!m) return { changes: 0 };

    const table = m[1];
    if (!store.tables[table]) return { changes: 0 };

    const setClauses = m[2].split(",").map(s => s.trim());
    const whereClause = m[3].trim();

    // Figure out param positions: SET params come first, then WHERE params
    const setParamCount = setClauses.filter(c => c.includes("?")).length;

    // Parse WHERE "col = ?"
    const wm = whereClause.match(/(\w+)\s*=\s*\?/);
    const whereCol = wm ? wm[1] : null;
    const whereVal = wm ? params[setParamCount] : null;

    let changes = 0;
    for (const row of store.tables[table]) {
      if (whereCol && row[whereCol] !== whereVal) continue;

      let paramIdx = 0;
      for (const clause of setClauses) {
        const cm = clause.match(/(\w+)\s*=\s*(.+)/);
        if (!cm) continue;
        const col = cm[1];
        const val = cm[2].trim();
        if (val === "?") {
          row[col] = params[paramIdx++];
        } else if (/^datetime\(/i.test(val)) {
          row[col] = now();
        }
      }
      changes++;
    }

    if (changes > 0) flush();
    return { changes };
  }

  function parseDelete(sql: string, params: unknown[]): { changes: number } {
    const m = sql.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/i);
    if (!m) return { changes: 0 };

    const table = m[1];
    if (!store.tables[table]) return { changes: 0 };

    if (!m[2]) {
      const count = store.tables[table].length;
      store.tables[table] = [];
      flush();
      return { changes: count };
    }

    const wm = m[2].match(/(\w+)\s*=\s*\?/);
    if (!wm) return { changes: 0 };

    const col = wm[1];
    const val = params[0];
    const before = store.tables[table].length;
    store.tables[table] = store.tables[table].filter(r => r[col] !== val);
    const changes = before - store.tables[table].length;
    if (changes > 0) flush();
    return { changes };
  }

  function execSql(sql: string, params: unknown[] = []): any {
    const trimmed = sql.trim();
    if (/^INSERT/i.test(trimmed)) return parseInsert(trimmed, params);
    if (/^SELECT/i.test(trimmed)) return parseSelect(trimmed, params);
    if (/^UPDATE/i.test(trimmed)) return parseUpdate(trimmed, params);
    if (/^DELETE/i.test(trimmed)) return parseDelete(trimmed, params);
    return { changes: 0 };
  }

  return {
    exec(sql: string) {
      // Handle CREATE TABLE statements — register table names
      const matches = sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi);
      for (const m of matches) {
        ensureTable(m[1]);
      }
      // Ignore PRAGMAs, CREATE INDEX, etc. silently
    },

    prepare(sql: string) {
      return {
        run(...params: unknown[]) {
          return execSql(sql, params);
        },
        get(...params: unknown[]) {
          const result = execSql(sql, params);
          if (Array.isArray(result)) return result[0];
          return undefined;
        },
        all(...params: unknown[]) {
          const result = execSql(sql, params);
          if (Array.isArray(result)) return result;
          return [];
        },
      };
    },

    // Bun-style API aliases
    run(sql: string, params: unknown[] = []) {
      return execSql(sql, params);
    },
    query(sql: string) {
      return {
        get(...params: unknown[]) {
          const result = execSql(sql, params);
          if (Array.isArray(result)) return result[0];
          return undefined;
        },
        all(...params: unknown[]) {
          const result = execSql(sql, params);
          if (Array.isArray(result)) return result;
          return [];
        },
      };
    },

    close() {
      flushNow();
    },
  };
}

// ── Reset (for testing) ────────────────────────────────────────────

export function resetDb(): void {
  closeDb();
}
