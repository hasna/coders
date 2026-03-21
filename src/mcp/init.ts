/**
 * MCP initialization — connect configured MCP servers at startup
 * and convert their tools to ToolHandler format for the agent loop.
 */
import { loadMcpConfigs } from "./config.js";
import { connectMcpServers, type McpServerConfig } from "./client.js";
import { mcpToolsToHandlers } from "./handlers.js";
import type { ToolHandler } from "../core/agent-loop.js";

export interface McpInitResult {
  handlers: ToolHandler[];
  /** server name -> tool names */
  connected: Map<string, string[]>;
  errors: string[];
}

/**
 * Load MCP configs, connect all servers, and return ToolHandlers
 * ready for the agent loop. Failures are logged but never throw.
 */
export async function initMcpServers(projectRoot?: string): Promise<McpInitResult> {
  const errors: string[] = [];

  // 1. Load configs from all sources
  let configs: McpServerConfig[];
  try {
    configs = loadMcpConfigs(projectRoot);
  } catch (err) {
    const msg = `[mcp-init] Failed to load MCP configs: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    return { handlers: [], connected: new Map(), errors };
  }

  if (configs.length === 0) {
    return { handlers: [], connected: new Map(), errors };
  }

  // 2. Connect all servers (batched, with error handling per server)
  let connected: Map<string, string[]>;
  try {
    connected = await connectMcpServers(configs);
  } catch (err) {
    const msg = `[mcp-init] Failed to connect MCP servers: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    return { handlers: [], connected: new Map(), errors };
  }

  // Collect per-server errors (servers that returned 0 tools might have failed)
  for (const [name, tools] of connected) {
    if (tools.length === 0) {
      errors.push(`[mcp-init] Server "${name}" connected but exposed 0 tools`);
    }
  }

  // 3. Convert registered MCP tools to ToolHandler format
  const handlers = mcpToolsToHandlers();

  return { handlers, connected, errors };
}
