/**
 * Config directory and file path resolution
 *
 * Structure mirrors Claude Code's config layout:
 *   ~/.coders/              (user config dir)
 *   ~/.coders/settings.json (user settings)
 *   ~/.coders/sessions/     (session data)
 *   ~/.coders/teams/        (team configs)
 *   ~/.coders/tasks/        (task lists)
 *   ~/.coders/plugins/      (installed plugins)
 *   ~/.coders/worktrees/    (worktree tracking)
 *   .coders/settings.json   (project settings, in project root)
 *   .coders/agents/         (project agent definitions)
 *   .coders/skills/         (project skills)
 *   .mcp.json               (project MCP config)
 *   CODERS.md               (project instructions)
 */

import { homedir } from "os";
import { join, resolve } from "path";
import { existsSync, mkdirSync } from "fs";

const CONFIG_DIR_ENV = "CODERS_CONFIG_DIR";
const DEFAULT_CONFIG_DIR_NAME = ".coders";

// ── User config directory ──────────────────────────────────────────

let _configDir: string | null = null;

export function getConfigDir(): string {
  if (_configDir) return _configDir;

  // 1. Environment variable override
  const envDir = process.env[CONFIG_DIR_ENV];
  if (envDir) {
    _configDir = resolve(envDir);
    ensureDir(_configDir);
    return _configDir;
  }

  // 2. Default ~/.coders
  const home = homedir();
  const primary = join(home, DEFAULT_CONFIG_DIR_NAME);

  if (existsSync(primary)) {
    _configDir = primary;
    return _configDir;
  }

  // Create ~/.coders
  ensureDir(primary);
  _configDir = primary;
  return _configDir;
}

export function resetConfigDir(): void {
  _configDir = null;
}

// ── Specific paths ─────────────────────────────────────────────────

export function getUserSettingsPath(): string {
  return join(getConfigDir(), "settings.json");
}

export function getUserConfigPath(): string {
  return join(getConfigDir(), ".config.json");
}

export function getSessionsDir(): string {
  const dir = join(getConfigDir(), "sessions");
  ensureDir(dir);
  return dir;
}

export function getTeamsDir(): string {
  const dir = join(getConfigDir(), "teams");
  ensureDir(dir);
  return dir;
}

export function getTasksDir(): string {
  const dir = join(getConfigDir(), "tasks");
  ensureDir(dir);
  return dir;
}

export function getPluginsDir(): string {
  const dir = join(getConfigDir(), "plugins");
  ensureDir(dir);
  return dir;
}

export function getPluginDataDir(): string {
  const dir = join(getPluginsDir(), "data");
  ensureDir(dir);
  return dir;
}

export function getMarketplacesConfigPath(): string {
  return join(getConfigDir(), "known_marketplaces.json");
}

export function getMcpLogsDir(): string {
  const dir = join(getConfigDir(), "mcp-logs");
  ensureDir(dir);
  return dir;
}

export function getPlansDir(): string {
  const dir = join(getConfigDir(), "plans");
  ensureDir(dir);
  return dir;
}

export function getScheduledTasksPath(): string {
  return join(getConfigDir(), "scheduled_tasks.json");
}

// ── Project config paths (relative to project root) ────────────────

export function getProjectConfigDir(projectRoot: string): string {
  return join(projectRoot, ".coders");
}

export function getProjectSettingsPath(projectRoot: string): string {
  return join(projectRoot, ".coders", "settings.json");
}

export function getProjectMcpConfigPath(projectRoot: string): string {
  return join(projectRoot, ".mcp.json");
}

export function getProjectAgentsDir(projectRoot: string): string {
  return join(projectRoot, ".coders", "agents");
}

export function getProjectSkillsDir(projectRoot: string): string {
  return join(projectRoot, ".coders", "skills");
}

export function getInstructionsFilePath(projectRoot: string): string | null {
  const path = join(projectRoot, "CODERS.md");
  return existsSync(path) ? path : null;
}

// ── Helpers ────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
