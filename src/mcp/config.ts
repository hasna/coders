/**
 * MCP config loading — discover servers from multiple config sources
 *
 * Config sources (matching Claude Code's scope hierarchy):
 *   1. Local: project .coders.json (per-project)
 *   2. User: ~/.coders/settings.json mcpServers
 *   3. Project: .mcp.json in project root
 *   4. CLI: --mcp-config flag
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { McpServerConfig } from "./client.js";
import { getConfigDir } from "../config/paths.js";
import { getSettings } from "../config/loader.js";

export type McpConfigScope = "local" | "user" | "project";

export interface McpServerConfigWithScope extends McpServerConfig {
  scope: McpConfigScope;
  configPath: string;
}

interface RawMcpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: "stdio" | "sse" | "streamable-http";
}

/**
 * Load all MCP server configs from all sources.
 */
export function loadMcpConfigs(projectRoot?: string): McpServerConfig[] {
  const configs: McpServerConfig[] = [];
  const seen = new Set<string>();

  // 1. User settings (~/.coders/settings.json mcpServers)
  const settings = getSettings();
  if (settings.mcpServers) {
    for (const [name, entry] of Object.entries(settings.mcpServers)) {
      if (!seen.has(name)) {
        configs.push(entryToConfig(name, entry));
        seen.add(name);
      }
    }
  }

  // 2. Project .mcp.json
  if (projectRoot) {
    const mcpJsonPath = join(projectRoot, ".mcp.json");
    const mcpJson = loadJsonFile(mcpJsonPath) as { mcpServers?: Record<string, RawMcpServerEntry> } | null;
    if (mcpJson?.mcpServers) {
      for (const [name, entry] of Object.entries(mcpJson.mcpServers)) {
        if (!seen.has(name)) {
          configs.push(entryToConfig(name, entry));
          seen.add(name);
        }
      }
    }
  }

  // 3. User global MCP config (~/.coders/.mcp.json)
  const globalMcpPath = join(getConfigDir(), ".mcp.json");
  const globalMcp = loadJsonFile(globalMcpPath) as { mcpServers?: Record<string, RawMcpServerEntry> } | null;
  if (globalMcp?.mcpServers) {
    for (const [name, entry] of Object.entries(globalMcp.mcpServers)) {
      if (!seen.has(name)) {
        configs.push(entryToConfig(name, entry));
        seen.add(name);
      }
    }
  }

  return configs;
}

/**
 * Load all MCP server configs with scope metadata for display.
 */
export function loadMcpConfigsWithScope(projectRoot?: string): McpServerConfigWithScope[] {
  const configs: McpServerConfigWithScope[] = [];
  const seen = new Set<string>();

  // 1. User settings (~/.coders/settings.json mcpServers)
  const userSettingsPath = join(getConfigDir(), "settings.json");
  const settings = getSettings();
  if (settings.mcpServers) {
    for (const [name, entry] of Object.entries(settings.mcpServers)) {
      if (!seen.has(name)) {
        configs.push({ ...entryToConfig(name, entry), scope: "user", configPath: userSettingsPath });
        seen.add(name);
      }
    }
  }

  // 2. Project .mcp.json
  if (projectRoot) {
    const mcpJsonPath = join(projectRoot, ".mcp.json");
    const mcpJson = loadJsonFile(mcpJsonPath) as { mcpServers?: Record<string, RawMcpServerEntry> } | null;
    if (mcpJson?.mcpServers) {
      for (const [name, entry] of Object.entries(mcpJson.mcpServers)) {
        if (!seen.has(name)) {
          configs.push({ ...entryToConfig(name, entry), scope: "project", configPath: mcpJsonPath });
          seen.add(name);
        }
      }
    }
  }

  // 3. User global MCP config (~/.coders/.mcp.json) = "local" scope
  const globalMcpPath = join(getConfigDir(), ".mcp.json");
  const globalMcp = loadJsonFile(globalMcpPath) as { mcpServers?: Record<string, RawMcpServerEntry> } | null;
  if (globalMcp?.mcpServers) {
    for (const [name, entry] of Object.entries(globalMcp.mcpServers)) {
      if (!seen.has(name)) {
        configs.push({ ...entryToConfig(name, entry), scope: "local", configPath: globalMcpPath });
        seen.add(name);
      }
    }
  }

  return configs;
}

/**
 * Add an MCP server config to a specific scope.
 */
export function addMcpServerConfig(
  name: string,
  config: Omit<McpServerConfig, "name">,
  scope: McpConfigScope,
  projectRoot?: string,
): void {
  const entry: RawMcpServerEntry = {
    command: config.command,
    args: config.args,
    env: config.env,
    url: config.url,
    transport: config.transport,
  };

  switch (scope) {
    case "user": {
      const { saveUserSettings, getUserSettings } = require("../config/loader.js");
      const settings = getUserSettings();
      const servers = settings.mcpServers ?? {};
      servers[name] = entry;
      saveUserSettings({ mcpServers: servers });
      break;
    }
    case "project": {
      if (!projectRoot) throw new Error("projectRoot required for project scope");
      const mcpJsonPath = join(projectRoot, ".mcp.json");
      const existing = (loadJsonFile(mcpJsonPath) ?? { mcpServers: {} }) as { mcpServers: Record<string, unknown> };
      existing.mcpServers[name] = entry;
      const { writeFileSync } = require("fs");
      writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
      break;
    }
    case "local":
    default: {
      const localPath = join(getConfigDir(), ".mcp.json");
      const existing = (loadJsonFile(localPath) ?? { mcpServers: {} }) as { mcpServers: Record<string, unknown> };
      existing.mcpServers[name] = entry;
      const { writeFileSync } = require("fs");
      writeFileSync(localPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
      break;
    }
  }
}

/**
 * Remove an MCP server config from all scopes (or a specific scope).
 */
export function removeMcpServerConfig(name: string, projectRoot?: string, scope?: McpConfigScope): boolean {
  let removed = false;
  const { writeFileSync: fsWrite } = require("fs") as typeof import("fs");

  // Check user settings
  if (!scope || scope === "user") {
    const { getUserSettings: getUS, saveUserSettings: saveUS } = require("../config/loader.js");
    const settings = getUS();
    if (settings.mcpServers?.[name]) {
      delete settings.mcpServers[name];
      saveUS({ mcpServers: settings.mcpServers });
      removed = true;
    }
  }

  // Check project .mcp.json
  if ((!scope || scope === "project") && projectRoot) {
    const projectMcpPath = join(projectRoot, ".mcp.json");
    const projectMcp = loadJsonFile(projectMcpPath) as { mcpServers?: Record<string, unknown> } | null;
    if (projectMcp?.mcpServers?.[name]) {
      delete projectMcp.mcpServers[name];
      fsWrite(projectMcpPath, JSON.stringify(projectMcp, null, 2) + "\n", "utf-8");
      removed = true;
    }
  }

  // Check local config (~/.coders/.mcp.json)
  if (!scope || scope === "local") {
    const localPath = join(getConfigDir(), ".mcp.json");
    const localMcp = loadJsonFile(localPath) as { mcpServers?: Record<string, unknown> } | null;
    if (localMcp?.mcpServers?.[name]) {
      delete localMcp.mcpServers[name];
      fsWrite(localPath, JSON.stringify(localMcp, null, 2) + "\n", "utf-8");
      removed = true;
    }
  }

  return removed;
}

// ── Helpers ────────────────────────────────────────────────────────

function entryToConfig(name: string, entry: RawMcpServerEntry): McpServerConfig {
  return {
    name,
    command: entry.command,
    args: entry.args,
    env: entry.env,
    url: entry.url,
    transport: entry.transport ?? (entry.command ? "stdio" : entry.url ? "sse" : "stdio"),
  };
}

function loadJsonFile(path: string): unknown | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}
