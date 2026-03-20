/**
 * Marketplace management — discover and install plugins from marketplaces
 *
 * Supports: git repos (SSH/HTTPS), URLs, local directories.
 * Stores marketplace list in known_marketplaces.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getMarketplacesConfigPath, getPluginsDir } from "../config/paths.js";

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

// ── Install from marketplace ───────────────────────────────────────

export async function installFromMarketplace(
  pluginName: string,
  marketplaceName?: string,
): Promise<{ success: boolean; error?: string }> {
  const marketplaces = getMarketplaces();

  if (marketplaceName) {
    const mp = marketplaces.find((m) => m.name === marketplaceName);
    if (!mp) return { success: false, error: `Marketplace "${marketplaceName}" not found` };
    return installPlugin(pluginName, mp);
  }

  // Try all marketplaces
  for (const mp of marketplaces) {
    const result = await installPlugin(pluginName, mp);
    if (result.success) return result;
  }

  return { success: false, error: `Plugin "${pluginName}" not found in any marketplace` };
}

async function installPlugin(
  name: string,
  marketplace: Marketplace,
): Promise<{ success: boolean; error?: string }> {
  const pluginsDir = getPluginsDir();
  const targetDir = join(pluginsDir, name);

  if (existsSync(targetDir)) {
    return { success: false, error: `Plugin "${name}" already installed` };
  }

  // TODO: implement git clone, URL download, directory copy
  // For now, return not-yet-implemented
  return { success: false, error: `Marketplace installation not yet implemented for ${marketplace.type}` };
}

// ── Uninstall ──────────────────────────────────────────────────────

export async function uninstallPlugin(name: string): Promise<boolean> {
  const pluginsDir = getPluginsDir();
  const targetDir = join(pluginsDir, name);

  if (!existsSync(targetDir)) return false;

  const { rmSync } = await import("fs");
  rmSync(targetDir, { recursive: true, force: true });
  return true;
}
