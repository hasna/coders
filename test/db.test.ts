import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, dbRun, dbGet, dbAll, closeDb, resetDb } from "../src/db/index.js";

describe("SQLite database layer", () => {
  afterEach(() => {
    resetDb();
  });

  it("initializes database with all tables", () => {
    const db = getDb();
    expect(db).toBeTruthy();

    // Check all tables exist
    const tables = dbAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("messages");
    expect(tableNames).toContain("file_history");
    expect(tableNames).toContain("checkpoints");
    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("config");
    expect(tableNames).toContain("memories");
    expect(tableNames).toContain("teams");
    expect(tableNames).toContain("team_members");
    expect(tableNames).toContain("team_messages");
    expect(tableNames).toContain("permissions");
    expect(tableNames).toContain("mcp_servers");
    expect(tableNames).toContain("metrics");
    expect(tableNames).toContain("audit_log");
  });

  it("inserts and queries config", () => {
    dbRun(
      "INSERT OR REPLACE INTO config (key, value, scope) VALUES (?, ?, ?)",
      ["test_key", JSON.stringify({ hello: "world" }), "user"],
    );
    const row = dbGet<{ key: string; value: string }>(
      "SELECT * FROM config WHERE key = ?",
      ["test_key"],
    );
    expect(row).toBeTruthy();
    expect(row!.key).toBe("test_key");
    expect(JSON.parse(row!.value)).toEqual({ hello: "world" });
  });

  it("inserts and queries tasks", () => {
    dbRun(
      "INSERT INTO tasks (id, subject, description, status) VALUES (?, ?, ?, ?)",
      ["t1", "Fix bug", "Fix the login bug", "pending"],
    );
    dbRun(
      "INSERT INTO tasks (id, subject, description, status) VALUES (?, ?, ?, ?)",
      ["t2", "Add feature", "Add dark mode", "in_progress"],
    );

    const all = dbAll<{ id: string; subject: string; status: string }>(
      "SELECT * FROM tasks ORDER BY id"
    );
    expect(all.length).toBe(2);
    expect(all[0].subject).toBe("Fix bug");
    expect(all[1].status).toBe("in_progress");

    const pending = dbAll("SELECT * FROM tasks WHERE status = ?", ["pending"]);
    expect(pending.length).toBe(1);
  });

  it("inserts and queries memories with importance filter", () => {
    dbRun(
      "INSERT INTO memories (id, key, value, importance, scope) VALUES (?, ?, ?, ?, ?)",
      ["m1", "rule-1", "Always use TypeScript", 9, "shared"],
    );
    dbRun(
      "INSERT INTO memories (id, key, value, importance, scope) VALUES (?, ?, ?, ?, ?)",
      ["m2", "note-1", "Minor observation", 3, "private"],
    );

    const important = dbAll("SELECT * FROM memories WHERE importance >= ?", [5]);
    expect(important.length).toBe(1);

    const all = dbAll("SELECT * FROM memories");
    expect(all.length).toBe(2);
  });

  it("inserts and queries sessions with messages", () => {
    dbRun(
      "INSERT INTO sessions (id, device_id, project_dir) VALUES (?, ?, ?)",
      ["s1", "dev1", "/tmp/project"],
    );
    dbRun(
      "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
      ["s1", "user", "Hello"],
    );
    dbRun(
      "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
      ["s1", "assistant", "Hi there!"],
    );

    const msgs = dbAll("SELECT * FROM messages WHERE session_id = ? ORDER BY id", ["s1"]);
    expect(msgs.length).toBe(2);
  });

  it("inserts checkpoints for rewind", () => {
    dbRun(
      "INSERT INTO checkpoints (id, session_id, file_path, original_content, edit_operation) VALUES (?, ?, ?, ?, ?)",
      ["cp1", "s1", "/tmp/file.ts", "original content here", JSON.stringify({ old_string: "old", new_string: "new" })],
    );
    const cp = dbGet<{ id: string; original_content: string }>(
      "SELECT * FROM checkpoints WHERE id = ?",
      ["cp1"],
    );
    expect(cp!.original_content).toBe("original content here");
  });

  it("inserts permissions for always-allow", () => {
    dbRun(
      "INSERT INTO permissions (tool_name, command_pattern, behavior) VALUES (?, ?, ?)",
      ["Bash", "npm test", "allow"],
    );
    const perms = dbAll("SELECT * FROM permissions WHERE tool_name = ?", ["Bash"]);
    expect(perms.length).toBe(1);
  });

  it("inserts audit log entries", () => {
    dbRun(
      "INSERT INTO audit_log (session_id, tool_name, input_summary, result_summary, duration_ms) VALUES (?, ?, ?, ?, ?)",
      ["s1", "Bash", "echo hello", "hello", 50.5],
    );
    const logs = dbAll("SELECT * FROM audit_log");
    expect(logs.length).toBe(1);
  });

  it("inserts and queries team messages", () => {
    dbRun("INSERT INTO teams (name, description) VALUES (?, ?)", ["test-team", "Test"]);
    dbRun(
      "INSERT INTO team_messages (from_agent, to_agent, team_name, content) VALUES (?, ?, ?, ?)",
      ["maximus", "cassius", "test-team", "Start working on the API"],
    );
    const msgs = dbAll("SELECT * FROM team_messages WHERE to_agent = ?", ["cassius"]);
    expect(msgs.length).toBe(1);
  });

  it("handles metrics tracking", () => {
    dbRun(
      "INSERT INTO metrics (session_id, turn_index, tokens_in, tokens_out, cost_usd, model) VALUES (?, ?, ?, ?, ?, ?)",
      ["s1", 0, 1000, 500, 0.0045, "sonnet"],
    );
    const metrics = dbAll("SELECT * FROM metrics WHERE session_id = ?", ["s1"]);
    expect(metrics.length).toBe(1);
  });
});
