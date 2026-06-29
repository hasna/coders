/**
 * PostgreSQL migrations for coders-owned remote storage.
 *
 * Equivalent of the SQLite schema in index.ts, translated for PostgreSQL.
 * Each element is a standalone SQL string that must be executed in order.
 */
export const PG_MIGRATIONS: string[] = [
  // Migration 1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    project_dir TEXT,
    original_cwd TEXT,
    model TEXT,
    app_version TEXT,
    build_time TEXT,
    fingerprint TEXT,
    metadata TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    tool_uses TEXT,
    thinking TEXT,
    duration_ms DOUBLE PRECISION,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    cost_usd DOUBLE PRECISION DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

  CREATE TABLE IF NOT EXISTS file_history (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content_hash TEXT,
    byte_size INTEGER,
    line_count INTEGER,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(session_id, file_path)
  );

  CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    original_content TEXT NOT NULL,
    edit_operation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_checkpoints_session_file ON checkpoints(session_id, file_path);

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','failed','cancelled')),
    active_form TEXT,
    owner TEXT,
    blocks TEXT DEFAULT '[]',
    blocked_by TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT,
    scope TEXT DEFAULT 'user' CHECK(scope IN ('user','project','local','global')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    scope TEXT DEFAULT 'shared' CHECK(scope IN ('global','shared','private')),
    category TEXT DEFAULT 'knowledge',
    importance INTEGER DEFAULT 5 CHECK(importance BETWEEN 1 AND 10),
    tags TEXT DEFAULT '[]',
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS teams (
    name TEXT PRIMARY KEY,
    description TEXT,
    task_list_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    team_name TEXT NOT NULL REFERENCES teams(name),
    agent_name TEXT NOT NULL,
    role TEXT,
    status TEXT DEFAULT 'idle',
    current_task TEXT,
    UNIQUE(team_name, agent_name)
  );

  CREATE TABLE IF NOT EXISTS team_messages (
    id SERIAL PRIMARY KEY,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    team_name TEXT,
    content TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    is_blocking INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_team_msgs_to ON team_messages(to_agent, is_read);

  CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    tool_name TEXT,
    command_pattern TEXT,
    path_pattern TEXT,
    behavior TEXT NOT NULL CHECK(behavior IN ('allow','deny')),
    scope TEXT DEFAULT 'session',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS mcp_servers (
    name TEXT PRIMARY KEY,
    command TEXT,
    args TEXT,
    env TEXT,
    url TEXT,
    transport TEXT DEFAULT 'stdio',
    scope TEXT DEFAULT 'user',
    enabled INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS metrics (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_index INTEGER,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    cost_usd DOUBLE PRECISION DEFAULT 0,
    api_duration_ms DOUBLE PRECISION DEFAULT 0,
    tool_duration_ms DOUBLE PRECISION DEFAULT 0,
    hook_duration_ms DOUBLE PRECISION DEFAULT 0,
    tool_count INTEGER DEFAULT 0,
    model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS conversation_checkpoints (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    label TEXT DEFAULT '',
    messages TEXT NOT NULL,
    message_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_conv_checkpoints_session ON conversation_checkpoints(session_id);

  CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    session_id TEXT,
    tool_name TEXT NOT NULL,
    input_summary TEXT,
    result_summary TEXT,
    exit_code INTEGER,
    duration_ms DOUBLE PRECISION,
    was_allowed INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO _migrations (id) VALUES (1) ON CONFLICT DO NOTHING;
  `,
];
