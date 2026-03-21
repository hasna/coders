/**
 * Marketplace management — discover and install plugins from marketplaces
 *
 * Supports: git repos (SSH/HTTPS), URLs, local directories.
 * Stores marketplace list in known_marketplaces.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { getMarketplacesConfigPath, getPluginsDir } from "../config/paths.js";
import { PluginManifestSchema } from "./manifest.js";

export interface Marketplace {
  name: string;
  source: string;
  type: "git" | "url" | "directory";
  lastUpdated?: string;
  scope: "user" | "project";
}

// ── Marketplace registry ───────────────────────────────────────────

export function getMarketplaces(): Marketplace[] {
  const path = getMarketplacesConfigPath();
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Marketplace[];
  } catch {
    return [];
  }
}

export function addMarketplace(marketplace: Marketplace): void {
  const existing = getMarketplaces();
  const filtered = existing.filter((m) => m.name !== marketplace.name);
  filtered.push(marketplace);
  saveMarketplaces(filtered);
}

export function removeMarketplace(name: string): boolean {
  const existing = getMarketplaces();
  const filtered = existing.filter((m) => m.name !== name);
  if (filtered.length === existing.length) return false;
  saveMarketplaces(filtered);
  return true;
}

function saveMarketplaces(marketplaces: Marketplace[]): void {
  const path = getMarketplacesConfigPath();
  const dir = join(path, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(marketplaces, null, 2) + "\n", "utf-8");
}

// ── Install result type ───────────────────────────────────────────

export interface InstallResult {
  success: boolean;
  pluginName?: string;
  version?: string;
  installPath?: string;
  error?: string;
}

// ── Install from marketplace ───────────────────────────────────────

export async function installFromMarketplace(
  pluginName: string,
  marketplaceName?: string,
): Promise<InstallResult> {
  const marketplaces = getMarketplaces();

  if (marketplaceName) {
    const mp = marketplaces.find((m) => m.name === marketplaceName);
    if (!mp) return { success: false, error: `Marketplace "${marketplaceName}" not found` };
    return installPluginFromMarketplace(pluginName, mp);
  }

  // Try all marketplaces
  for (const mp of marketplaces) {
    const result = await installPluginFromMarketplace(pluginName, mp);
    if (result.success) return result;
  }

  return { success: false, error: `Plugin "${pluginName}" not found in any marketplace` };
}

async function installPluginFromMarketplace(
  name: string,
  marketplace: Marketplace,
): Promise<InstallResult> {
  const pluginsDir = getPluginsDir();

  switch (marketplace.type) {
    case "git": {
      // Marketplace source is the base git repo URL; plugin may be a subdirectory
      const gitUrl = marketplace.source.endsWith("/")
        ? marketplace.source + name
        : marketplace.source + "/" + name;
      return installFromGit(gitUrl, pluginsDir);
    }
    case "directory": {
      const sourcePath = join(marketplace.source, name);
      return installFromDirectory(sourcePath, pluginsDir);
    }
    case "url":
      return { success: false, error: `URL-based marketplace installation not yet implemented` };
    default:
      return { success: false, error: `Unknown marketplace type: ${marketplace.type}` };
  }
}

// ── Install from source (auto-detect) ─────────────────────────────

/**
 * Install a plugin from any source — auto-detects git URLs vs local paths.
 *
 * Accepts:
 *   - Git URL (HTTPS/SSH): contains ".git" or "github.com" or "gitlab.com"
 *   - Local directory path: resolved against cwd
 */
export function installFromSource(
  source: string,
  pluginsDir?: string,
): InstallResult {
  const dir = pluginsDir ?? getPluginsDir();

  if (isGitUrl(source)) {
    return installFromGit(source, dir);
  }

  // Treat as local directory path
  const resolvedPath = resolve(source);
  return installFromDirectory(resolvedPath, dir);
}

// ── Install from git ──────────────────────────────────────────────

/**
 * Clone a git repository, validate its manifest, and install to plugins dir.
 */
export function installFromGit(
  url: string,
  pluginsDir?: string,
): InstallResult {
  const dir = pluginsDir ?? getPluginsDir();
  const tempDir = join(tmpdir(), `coders-plugin-${randomBytes(8).toString("hex")}`);

  try {
    // Clone to temp directory
    try {
      execSync(`git clone --depth 1 ${escapeShellArg(url)} ${escapeShellArg(tempDir)}`, {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 60_000,
      });
    } catch (err) {
      return {
        success: false,
        error: `Failed to clone "${url}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Validate manifest exists
    const manifestPath = join(tempDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      return { success: false, error: `No manifest.json found in cloned repository "${url}"` };
    }

    // Parse and validate manifest
    const validated = validateManifest(manifestPath);
    if (!validated.success) return validated;

    const pluginName = validated.pluginName!;
    const targetDir = join(dir, pluginName);

    if (existsSync(targetDir)) {
      return { success: false, error: `Plugin "${pluginName}" is already installed` };
    }

    // Copy to plugins directory (skip .git directory)
    mkdirSync(targetDir, { recursive: true });
    cpSync(tempDir, targetDir, {
      recursive: true,
      filter: (src) => !src.includes(join(tempDir, ".git")),
    });

    return {
      success: true,
      pluginName,
      version: validated.version,
      installPath: targetDir,
    };
  } finally {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch { /* cleanup failure is non-fatal */ }
  }
}

// ── Install from directory ────────────────────────────────────────

/**
 * Copy a local directory plugin into the plugins directory.
 */
export function installFromDirectory(
  sourcePath: string,
  pluginsDir?: string,
): InstallResult {
  const dir = pluginsDir ?? getPluginsDir();
  const resolvedSource = resolve(sourcePath);

  if (!existsSync(resolvedSource)) {
    return { success: false, error: `Source directory does not exist: "${resolvedSource}"` };
  }

  // Validate manifest exists
  const manifestPath = join(resolvedSource, "manifest.json");
  if (!existsSync(manifestPath)) {
    return { success: false, error: `No manifest.json found in "${resolvedSource}"` };
  }

  // Parse and validate manifest
  const validated = validateManifest(manifestPath);
  if (!validated.success) return validated;

  const pluginName = validated.pluginName!;
  const targetDir = join(dir, pluginName);

  if (existsSync(targetDir)) {
    return { success: false, error: `Plugin "${pluginName}" is already installed` };
  }

  // Copy to plugins directory
  mkdirSync(targetDir, { recursive: true });
  cpSync(resolvedSource, targetDir, { recursive: true });

  return {
    success: true,
    pluginName,
    version: validated.version,
    installPath: targetDir,
  };
}

// ── Uninstall ──────────────────────────────────────────────────────

/**
 * Remove a plugin by name from the plugins directory.
 */
export function uninstallPlugin(name: string, pluginsDir?: string): boolean {
  const dir = pluginsDir ?? getPluginsDir();
  const targetDir = join(dir, name);

  if (!existsSync(targetDir)) return false;

  rmSync(targetDir, { recursive: true, force: true });
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Detect whether a source string looks like a git URL.
 */
function isGitUrl(source: string): boolean {
  return (
    source.endsWith(".git") ||
    source.startsWith("git@") ||
    source.startsWith("git://") ||
    source.includes("github.com") ||
    source.includes("gitlab.com") ||
    source.includes("bitbucket.org")
  );
}

/**
 * Validate a manifest.json file and return the plugin name + version.
 */
function validateManifest(
  manifestPath: string,
): InstallResult & { pluginName?: string; version?: string } {
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const result = PluginManifestSchema.safeParse(raw);

    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { success: false, error: `Invalid manifest: ${issues}` };
    }

    return {
      success: true,
      pluginName: result.data.name,
      version: result.data.version,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to read manifest: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Escape a shell argument to prevent injection.
 */
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
