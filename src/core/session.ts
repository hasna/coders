/**
 * Session management — lifecycle, persistence, resume
 *
 * NOW USES SQLite instead of JSON files.
 * DB tables: sessions, messages
 */
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir, hostname, platform, arch, release } from "os";
import { getConfigDir } from "../config/paths.js";
import { VERSION, BUILD_TIME } from "../cli/index.js";
import { dbRun, dbGet, dbAll } from "../db/index.js";
import type { Message } from "../api/client.js";

// ── Session Types ──────────────────────────────────────────────────

export interface Session {
  id: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
  buildTime: string;
  projectDir: string;
  originalCwd: string;
  metadata: SessionMetadata;
  messages: Message[];
  fingerprint: EnvironmentFingerprint;
}

export interface SessionMetadata {
  email?: string;
  orgId?: string;
  accountId?: string;
  subscriptionType?: string;
  rateLimitTier?: string;
  model?: string;
  parentSessionId?: string;
  agentId?: string;
  agentType?: string;
  teamName?: string;
  completedTurns: number;
  lastInteractionTime: string;
}

export interface EnvironmentFingerprint {
  platform: string;
  arch: string;
  nodeVersion: string;
  terminal: string;
  shell: string;
  hostname: string;
  osRelease: string;
  isCi: boolean;
  isRemote: boolean;
  isWsl: boolean;
  packageManagers: string[];
  runtimes: string[];
  vcs: string;
  editor?: string;
}

// ── Device ID ──────────────────────────────────────────────────────

let _deviceId: string | null = null;

function getOrCreateDeviceId(): string {
  if (_deviceId) return _deviceId;

  const configDir = getConfigDir();
  const deviceIdPath = join(configDir, "device_id");

  if (existsSync(deviceIdPath)) {
    _deviceId = readFileSync(deviceIdPath, "utf-8").trim();
    return _deviceId;
  }

  _deviceId = randomUUID();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(deviceIdPath, _deviceId, "utf-8");
  return _deviceId;
}

// ── Environment Fingerprint ────────────────────────────────────────

export function createFingerprint(): EnvironmentFingerprint {
  return {
    platform: platform(),
    arch: arch(),
    nodeVersion: process.version,
    terminal: process.env.TERM_PROGRAM ?? process.env.TERM ?? "unknown",
    shell: process.env.SHELL ?? process.env.COMSPEC ?? "unknown",
    hostname: hostname(),
    osRelease: release(),
    isCi: detectCi(),
    isRemote: !!process.env.CODERS_REMOTE,
    isWsl: detectWsl(),
    packageManagers: detectPackageManagers(),
    runtimes: detectRuntimes(),
    vcs: detectVcs(),
    editor: process.env.VISUAL ?? process.env.EDITOR,
  };
}

function detectCi(): boolean {
  return !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI || process.env.CIRCLECI || process.env.BUILDKITE || process.env.JENKINS_URL);
}

function detectWsl(): boolean {
  if (platform() !== "linux") return false;
  try { return existsSync("/proc/sys/fs/binfmt_misc/WSLInterop"); } catch { return false; }
}

function detectPackageManagers(): string[] {
  const m: string[] = [];
  const check = (cmd: string) => { try { require("child_process").execFileSync("which", [cmd], { stdio: "pipe" }); return true; } catch { return false; } };
  if (check("npm")) m.push("npm");
  if (check("yarn")) m.push("yarn");
  if (check("pnpm")) m.push("pnpm");
  if (check("bun")) m.push("bun");
  return m;
}

function detectRuntimes(): string[] {
  const r: string[] = ["node"];
  const check = (cmd: string) => { try { require("child_process").execFileSync("which", [cmd], { stdio: "pipe" }); return true; } catch { return false; } };
  if (check("bun")) r.push("bun");
  if (check("deno")) r.push("deno");
  return r;
}

function detectVcs(): string {
  if (existsSync(join(process.cwd(), ".git"))) return "git";
  if (existsSync(join(process.cwd(), ".hg"))) return "mercurial";
  return "none";
}

// ── Session Lifecycle (SQLite-backed) ──────────────────────────────

export function createSession(projectDir: string, options?: Partial<SessionMetadata>): Session {
  const id = randomUUID();
  const now = new Date().toISOString();
  const deviceId = getOrCreateDeviceId();
  const fingerprint = createFingerprint();
  const metadata: SessionMetadata = {
    completedTurns: 0,
    lastInteractionTime: now,
    ...options,
  };

  // Insert into SQLite
  dbRun(
    `INSERT INTO sessions (id, device_id, project_dir, original_cwd, model, app_version, build_time, fingerprint, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, deviceId, projectDir, process.cwd(), metadata.model ?? null, VERSION, BUILD_TIME,
     JSON.stringify(fingerprint), JSON.stringify(metadata)],
  );

  return {
    id, deviceId, createdAt: now, updatedAt: now, appVersion: VERSION, buildTime: BUILD_TIME,
    projectDir, originalCwd: process.cwd(), metadata, messages: [], fingerprint,
  };
}

export function saveSession(session: Session): void {
  session.updatedAt = new Date().toISOString();
  dbRun(
    `UPDATE sessions SET metadata = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(session.metadata), session.updatedAt, session.id],
  );
}

export function loadSession(sessionId: string): Session | null {
  const row = dbGet<any>(`SELECT * FROM sessions WHERE id = ?`, [sessionId]);
  if (!row) return null;

  const msgs = dbAll<any>(`SELECT * FROM messages WHERE session_id = ? ORDER BY id`, [sessionId]);

  return {
    id: row.id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appVersion: row.app_version ?? VERSION,
    buildTime: row.build_time ?? BUILD_TIME,
    projectDir: row.project_dir ?? "",
    originalCwd: row.original_cwd ?? "",
    metadata: safeParse(row.metadata, { completedTurns: 0, lastInteractionTime: row.updated_at }),
    messages: msgs.map((m: any) => ({ role: m.role, content: m.content })),
    fingerprint: safeParse(row.fingerprint, createFingerprint()),
  };
}

export function listRecentSessions(limit = 20): Array<{
  id: string; projectDir: string; updatedAt: string; completedTurns: number; model?: string;
}> {
  const rows = dbAll<any>(
    `SELECT id, project_dir, updated_at, metadata FROM sessions ORDER BY updated_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r: any) => {
    const meta = safeParse(r.metadata, {});
    return {
      id: r.id,
      projectDir: r.project_dir ?? "",
      updatedAt: r.updated_at ?? "",
      completedTurns: meta.completedTurns ?? 0,
      model: meta.model,
    };
  });
}

export function addMessage(sessionId: string, role: string, content: string, extras?: {
  toolUses?: string; thinking?: string; durationMs?: number; tokensIn?: number; tokensOut?: number; costUsd?: number;
}): void {
  dbRun(
    `INSERT INTO messages (session_id, role, content, tool_uses, thinking, duration_ms, tokens_in, tokens_out, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, role, content, extras?.toolUses ?? null, extras?.thinking ?? null,
     extras?.durationMs ?? null, extras?.tokensIn ?? 0, extras?.tokensOut ?? 0, extras?.costUsd ?? 0],
  );
}

export function updateSession(session: Session, messages: Message[], metadata?: Partial<SessionMetadata>): void {
  session.metadata.completedTurns++;
  session.metadata.lastInteractionTime = new Date().toISOString();
  if (metadata) Object.assign(session.metadata, metadata);
  saveSession(session);
}

// ── Current session tracking ───────────────────────────────────────

let _currentSessionId: string | null = null;
export function getCurrentSessionId(): string | null { return _currentSessionId; }
export function setCurrentSessionId(id: string): void { _currentSessionId = id; }

// ── Helpers ────────────────────────────────────────────────────────

function safeParse(json: string | null | undefined, fallback: any): any {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}
