/**
 * Session management — lifecycle, persistence, resume
 *
 * Mirrors Claude Code's session system (36-session-persistence.js):
 *   - Create session with unique ID and device ID
 *   - Persist messages and metadata to disk
 *   - Resume from session directory
 *   - Environment fingerprint
 */
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir, hostname, platform, arch, release } from "os";
import { getSessionsDir } from "../config/paths.js";
import { VERSION, BUILD_TIME } from "../cli/index.js";
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

  const configDir = dirname(getSessionsDir());
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
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.BUILDKITE ||
    process.env.JENKINS_URL ||
    process.env.CODEBUILD_BUILD_ID ||
    process.env.TF_BUILD
  );
}

function detectWsl(): boolean {
  if (platform() !== "linux") return false;
  try {
    return existsSync("/proc/sys/fs/binfmt_misc/WSLInterop");
  } catch {
    return false;
  }
}

function detectPackageManagers(): string[] {
  const managers: string[] = [];
  const check = (cmd: string) => {
    try {
      require("child_process").execFileSync("which", [cmd], { stdio: "pipe" });
      return true;
    } catch { return false; }
  };
  if (check("npm")) managers.push("npm");
  if (check("yarn")) managers.push("yarn");
  if (check("pnpm")) managers.push("pnpm");
  if (check("bun")) managers.push("bun");
  return managers;
}

function detectRuntimes(): string[] {
  const runtimes: string[] = ["node"];
  const check = (cmd: string) => {
    try {
      require("child_process").execFileSync("which", [cmd], { stdio: "pipe" });
      return true;
    } catch { return false; }
  };
  if (check("bun")) runtimes.push("bun");
  if (check("deno")) runtimes.push("deno");
  return runtimes;
}

function detectVcs(): string {
  if (existsSync(join(process.cwd(), ".git"))) return "git";
  if (existsSync(join(process.cwd(), ".hg"))) return "mercurial";
  if (existsSync(join(process.cwd(), ".svn"))) return "svn";
  return "none";
}

// ── Session Lifecycle ──────────────────────────────────────────────

/**
 * Create a new session.
 */
export function createSession(projectDir: string, options?: Partial<SessionMetadata>): Session {
  const id = randomUUID();
  const now = new Date().toISOString();

  return {
    id,
    deviceId: getOrCreateDeviceId(),
    createdAt: now,
    updatedAt: now,
    appVersion: VERSION,
    buildTime: BUILD_TIME,
    projectDir,
    originalCwd: process.cwd(),
    metadata: {
      completedTurns: 0,
      lastInteractionTime: now,
      ...options,
    },
    messages: [],
    fingerprint: createFingerprint(),
  };
}

/**
 * Save session to disk.
 */
export function saveSession(session: Session): void {
  const dir = getSessionDir(session.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  session.updatedAt = new Date().toISOString();

  // Save metadata (without messages — those are large)
  const meta = { ...session, messages: undefined };
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(meta, null, 2), "utf-8");

  // Save messages separately
  writeFileSync(join(dir, "messages.json"), JSON.stringify(session.messages), "utf-8");
}

/**
 * Load a session from disk.
 */
export function loadSession(sessionId: string): Session | null {
  const dir = getSessionDir(sessionId);
  const metaPath = join(dir, "metadata.json");

  if (!existsSync(metaPath)) return null;

  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as Session;
    const messagesPath = join(dir, "messages.json");
    if (existsSync(messagesPath)) {
      meta.messages = JSON.parse(readFileSync(messagesPath, "utf-8"));
    } else {
      meta.messages = [];
    }
    return meta;
  } catch {
    return null;
  }
}

/**
 * List recent sessions (sorted by updatedAt, newest first).
 */
export function listRecentSessions(limit = 20): Array<{
  id: string;
  projectDir: string;
  updatedAt: string;
  completedTurns: number;
  model?: string;
}> {
  const sessionsDir = getSessionsDir();
  if (!existsSync(sessionsDir)) return [];

  const entries: Array<{
    id: string;
    projectDir: string;
    updatedAt: string;
    completedTurns: number;
    model?: string;
    mtime: number;
  }> = [];

  try {
    for (const name of readdirSync(sessionsDir)) {
      const metaPath = join(sessionsDir, name, "metadata.json");
      if (!existsSync(metaPath)) continue;
      try {
        const stat = statSync(metaPath);
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        entries.push({
          id: meta.id ?? name,
          projectDir: meta.projectDir ?? "",
          updatedAt: meta.updatedAt ?? stat.mtime.toISOString(),
          completedTurns: meta.metadata?.completedTurns ?? 0,
          model: meta.metadata?.model,
          mtime: stat.mtimeMs,
        });
      } catch { /* skip corrupt sessions */ }
    }
  } catch { /* sessions dir may not exist */ }

  entries.sort((a, b) => b.mtime - a.mtime);
  return entries.slice(0, limit);
}

/**
 * Update session messages and metadata.
 */
export function updateSession(
  session: Session,
  messages: Message[],
  metadata?: Partial<SessionMetadata>,
): void {
  session.messages = messages;
  session.metadata.completedTurns++;
  session.metadata.lastInteractionTime = new Date().toISOString();
  if (metadata) Object.assign(session.metadata, metadata);
  saveSession(session);
}

/**
 * Get the current session ID (from env or global state).
 */
let _currentSessionId: string | null = null;

export function getCurrentSessionId(): string | null {
  return _currentSessionId;
}

export function setCurrentSessionId(id: string): void {
  _currentSessionId = id;
}

// ── Helpers ────────────────────────────────────────────────────────

function getSessionDir(sessionId: string): string {
  return join(getSessionsDir(), sessionId);
}
