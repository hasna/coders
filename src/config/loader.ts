/**
 * Config loader — cascading configuration from multiple sources
 *
 * Priority (highest to lowest, matching Claude Code's cascade):
 *   1. CLI flags (--model, --permission-mode, --settings, etc.)
 *   2. Enterprise managed settings (MDM/policy)
 *   3. Project .coders/settings.json 
 *   4. User ~/.coders/settings.json 
 *
 * Config file (.config.json) stores auth state, device ID, etc.
 * Settings file (settings.json) stores user preferences, hooks, permissions.
 */
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "fs";
import { dirname } from "path";
import { SettingsSchema, DEFAULT_SETTINGS, type Settings } from "./settings.js";
import {
  getUserSettingsPath,
  getUserConfigPath,
  getProjectSettingsPath,
} from "./paths.js";

// ── LRU-cached config/settings with mtime invalidation ──────────────

let _userSettings: Settings | null = null;
let _projectSettings: Settings | null = null;
let _mergedSettings: Settings | null = null;
let _projectRoot: string | null = null;
let _config: Record<string, unknown> | null = null;
let _userSettingsMtime = 0;
let _projectSettingsMtime = 0;

function getFileMtime(path: string): number {
  try { return existsSync(path) ? statSync(path).mtimeMs : 0; } catch { return 0; }
}

function isUserSettingsStale(): boolean {
  const path = getUserSettingsPath();
  return getFileMtime(path) !== _userSettingsMtime;
}

function isProjectSettingsStale(): boolean {
  if (!_projectRoot) return false;
  const path = getProjectSettingsPath(_projectRoot);
  return getFileMtime(path) !== _projectSettingsMtime;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Get the fully merged settings (user + project + defaults).
 * Call setProjectRoot() before first access to include project settings.
 */
export function getSettings(): Settings {
  // Invalidate cache if files changed on disk
  if (_mergedSettings && (isUserSettingsStale() || isProjectSettingsStale())) {
    _userSettings = null;
    _projectSettings = null;
    _mergedSettings = null;
  }
  if (_mergedSettings) return _mergedSettings;
  _mergedSettings = mergeSettings();
  return _mergedSettings;
}

/**
 * Get just the user-level settings.
 */
export function getUserSettings(): Settings {
  if (_userSettings) return _userSettings;
  const path = getUserSettingsPath();
  _userSettings = loadSettingsFile(path);
  _userSettingsMtime = getFileMtime(path);
  return _userSettings;
}

/**
 * Get just the project-level settings.
 */
export function getProjectSettings(): Settings {
  if (!_projectRoot) return {};
  if (_projectSettings) return _projectSettings;
  const path = getProjectSettingsPath(_projectRoot);
  _projectSettings = loadSettingsFile(path);
  _projectSettingsMtime = getFileMtime(path);
  return _projectSettings;
}

/**
 * Set the project root so project settings can be loaded.
 */
export function setProjectRoot(root: string): void {
  _projectRoot = root;
  _projectSettings = null;
  _mergedSettings = null; // force re-merge
}

export function getProjectRoot(): string | null {
  return _projectRoot;
}

/**
 * Get the config file (auth state, device ID, etc.)
 */
export function getConfig(): Record<string, unknown> {
  if (_config) return _config;
  _config = loadJsonFile(getUserConfigPath()) ?? {};
  return _config;
}

/**
 * Save a value to the user config file.
 */
export function saveConfig(key: string, value: unknown): void {
  const config = getConfig();
  config[key] = value;
  _config = config;
  writeJsonFile(getUserConfigPath(), config);
}

/**
 * Save settings to the user settings file.
 */
export function saveUserSettings(settings: Partial<Settings>): void {
  const current = getUserSettings();
  const updated = { ...current, ...settings };
  _userSettings = updated;
  _mergedSettings = null; // force re-merge
  writeJsonFile(getUserSettingsPath(), updated);
}

/**
 * Save settings to the project settings file.
 */
export function saveProjectSettings(settings: Partial<Settings>): void {
  if (!_projectRoot) throw new Error("No project root set");
  const path = getProjectSettingsPath(_projectRoot);
  const current = getProjectSettings();
  const updated = { ...current, ...settings };
  _projectSettings = updated;
  _mergedSettings = null;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeJsonFile(path, updated);
}

/**
 * Apply CLI option overrides to the merged settings.
 */
export function applyCliOverrides(overrides: Partial<Settings>): void {
  const settings = getSettings();
  _mergedSettings = deepMerge(settings, overrides) as Settings;
}

/**
 * Reset all caches — useful for testing.
 */
export function resetConfigCache(): void {
  _userSettings = null;
  _projectSettings = null;
  _mergedSettings = null;
  _projectRoot = null;
  _config = null;
}

// ── Internal ───────────────────────────────────────────────────────

function mergeSettings(): Settings {
  const defaults = { ...DEFAULT_SETTINGS };
  const user = getUserSettings();
  const project = getProjectSettings();

  // Merge: defaults < user < project
  return deepMerge(deepMerge(defaults, user), project) as Settings;
}

function loadSettingsFile(path: string): Settings {
  const raw = loadJsonFile(path);
  if (!raw) return {};

  // Validate with Zod — passthrough unknown keys
  const result = SettingsSchema.safeParse(raw);
  if (result.success) return result.data;

  // If validation fails, try partial parse — keep valid fields, drop invalid ones
  console.warn(`[config] Warning: settings at ${path} has validation errors:`, result.error.issues.map(i => i.message).join(", "));
  const partial = SettingsSchema.partial().safeParse(raw);
  return partial.success ? partial.data as Settings : {};
}

function loadJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeJsonFile(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (source === undefined || source === null) return target;
  if (target === undefined || target === null) return source;

  if (typeof target !== "object" || typeof source !== "object") return source;
  if (Array.isArray(target) && Array.isArray(source)) {
    // Concatenate arrays and deduplicate (preserves user + project entries)
    return [...new Set([...target, ...source])];
  }
  if (Array.isArray(source)) return source;

  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (value === undefined) continue;
    result[key] = deepMerge(result[key], value);
  }
  return result;
}
