/**
 * Plugin loader — discover, load, validate, and register plugins
 *
 * Loading pipeline (matching Claude Code's 38-plugin-marketplace.js):
 *   1. Discover plugins from installed list
 *   2. Load manifests in parallel
 *   3. Trust/security checks
 *   4. Filter into enabled/disabled
 *   5. Validate and register (MCP servers, commands, hooks, etc.)
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { PluginManifestSchema, type InstalledPlugin, type PluginManifest } from "./manifest.js";
import { getPluginsDir } from "../config/paths.js";

// ── Plugin state ───────────────────────────────────────────────────

const loadedPlugins: Map<string, InstalledPlugin> = new Map();

// ── Discovery ──────────────────────────────────────────────────────

/**
 * Discover installed plugins from the plugins directory.
 */
export function discoverPlugins(): InstalledPlugin[] {
  const pluginsDir = getPluginsDir();
  if (!existsSync(pluginsDir)) return [];

  const plugins: InstalledPlugin[] = [];
  const registryPath = join(pluginsDir, "registry.json");

  if (existsSync(registryPath)) {
    try {
      const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as InstalledPlugin[];
      if (Array.isArray(registry)) {
        return registry.filter((p) => validatePluginEntry(p));
      }
    } catch { /* corrupt registry */ }
  }

  // Fallback: scan directory for plugin manifests
  try {
    for (const name of readdirSync(pluginsDir)) {
      const manifestPath = join(pluginsDir, name, "manifest.json");
      if (!existsSync(manifestPath)) continue;

      try {
        const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
        const result = PluginManifestSchema.safeParse(raw);
        if (result.success) {
          plugins.push({
            name: result.data.name,
            version: result.data.version,
            source: "directory",
            sourcePath: join(pluginsDir, name),
            manifest: result.data,
            enabled: true,
            scope: "user",
            installedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
          });
        }
      } catch { /* skip invalid */ }
    }
  } catch { /* plugins dir read error */ }

  return plugins;
}

// ── Loading ────────────────────────────────────────────────────────

/**
 * Load all plugins: discover, validate, and register.
 */
export async function loadPlugins(): Promise<InstalledPlugin[]> {
  const discovered = discoverPlugins();
  const enabled: InstalledPlugin[] = [];

  for (const plugin of discovered) {
    if (!plugin.enabled) continue;

    // Trust check (basic for now — could be expanded)
    if (!isPluginTrusted(plugin)) continue;

    loadedPlugins.set(plugin.name, plugin);
    enabled.push(plugin);
  }

  return enabled;
}

/**
 * Get all loaded plugins.
 */
export function getLoadedPlugins(): InstalledPlugin[] {
  return [...loadedPlugins.values()];
}

/**
 * Get a specific loaded plugin.
 */
export function getPlugin(name: string): InstalledPlugin | null {
  return loadedPlugins.get(name) ?? null;
}

// ── Enable/Disable ─────────────────────────────────────────────────

export function enablePlugin(name: string): boolean {
  const plugin = loadedPlugins.get(name);
  if (!plugin) return false;
  plugin.enabled = true;
  return true;
}

export function disablePlugin(name: string): boolean {
  const plugin = loadedPlugins.get(name);
  if (!plugin) return false;
  plugin.enabled = false;
  return true;
}

// ── Built-in plugins ───────────────────────────────────────────────

export const BUILTIN_PLUGINS: PluginManifest[] = [
  {
    name: "pr-comments",
    version: "1.0.0",
    description: "Fetch GitHub PR comments via gh CLI",
    commands: [{
      name: "pr-comments",
      description: "Fetch comments on a GitHub PR",
      command: "gh api repos/{owner}/{repo}/pulls/{number}/comments",
    }],
  },
  {
    name: "code-review",
    version: "1.0.0",
    description: "Review a GitHub PR diff",
    commands: [{
      name: "review",
      description: "Review PR diff via gh pr diff",
      command: "gh pr diff {number}",
    }],
  },
];

// ── Validation ─────────────────────────────────────────────────────

function validatePluginEntry(plugin: unknown): plugin is InstalledPlugin {
  if (!plugin || typeof plugin !== "object") return false;
  const p = plugin as Record<string, unknown>;
  return typeof p.name === "string" && typeof p.version === "string";
}

function isPluginTrusted(plugin: InstalledPlugin): boolean {
  // Basic trust: local directory and file sources are trusted
  if (plugin.source === "directory" || plugin.source === "file") return true;
  // Git/URL sources need explicit approval (future: signature verification)
  return true; // TODO: implement trust checks
}

// ── Reset ──────────────────────────────────────────────────────────

export function resetPlugins(): void {
  loadedPlugins.clear();
}
