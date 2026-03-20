/**
 * MCP Client — connect to external MCP servers and surface their tools
 *
 * Supports 3 transport types:
 *   - Stdio: spawn a process and communicate via stdin/stdout
 *   - SSE: connect to HTTP Server-Sent Events endpoint
 *   - StreamableHTTP: HTTP with streaming responses
 *
 * Each connected server's tools are registered in the tool registry.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Tool as McpToolDef } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../tools/interface.js";
import { registerMcpTool, unregisterMcpTool } from "../tools/registry.js";
import { DEFAULT_MAX_RESULT_SIZE_CHARS } from "../core/constants.js";

// ── MCP Server Config ──────────────────────────────────────────────

export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport: "stdio" | "sse" | "streamable-http";
}

// ── Connected client tracking ──────────────────────────────────────

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport | SSEClientTransport;
  tools: string[];
}

const connectedServers = new Map<string, ConnectedServer>();

const DEFAULT_BATCH_SIZE = 3;

// ── Connect to an MCP server ───────────────────────────────────────

export async function connectMcpServer(config: McpServerConfig): Promise<string[]> {
  // Disconnect existing connection with same name
  if (connectedServers.has(config.name)) {
    await disconnectMcpServer(config.name);
  }

  const client = new Client(
    { name: "@hasna/coders-client", version: "0.0.1" },
    { capabilities: {} },
  );

  let transport: StdioClientTransport | SSEClientTransport;

  switch (config.transport) {
    case "stdio": {
      if (!config.command) throw new Error(`MCP server ${config.name}: command is required for stdio transport`);
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
      });
      break;
    }
    case "sse": {
      if (!config.url) throw new Error(`MCP server ${config.name}: url is required for SSE transport`);
      transport = new SSEClientTransport(new URL(config.url));
      break;
    }
    case "streamable-http": {
      // StreamableHTTP uses SSE transport with different endpoint handling
      if (!config.url) throw new Error(`MCP server ${config.name}: url is required for streamable-http transport`);
      transport = new SSEClientTransport(new URL(config.url));
      break;
    }
    default:
      throw new Error(`Unknown transport: ${config.transport}`);
  }

  await client.connect(transport);

  // Discover tools
  const toolNames: string[] = [];
  try {
    const result = await client.listTools();
    for (const mcpTool of result.tools) {
      const tool = wrapMcpTool(config.name, mcpTool, client);
      registerMcpTool(tool);
      toolNames.push(tool.name);
    }
  } catch (error) {
    console.error(`[mcp-client] Failed to list tools from ${config.name}:`, error);
  }

  connectedServers.set(config.name, {
    name: config.name,
    client,
    transport,
    tools: toolNames,
  });

  return toolNames;
}

// ── Disconnect ─────────────────────────────────────────────────────

export async function disconnectMcpServer(name: string): Promise<void> {
  const server = connectedServers.get(name);
  if (!server) return;

  // Unregister all tools from this server
  for (const toolName of server.tools) {
    unregisterMcpTool(toolName);
  }

  try {
    await server.client.close();
  } catch { /* ignore close errors */ }

  connectedServers.delete(name);
}

export async function disconnectAllMcpServers(): Promise<void> {
  const names = [...connectedServers.keys()];
  await Promise.all(names.map(disconnectMcpServer));
}

// ── Connect multiple servers with batching ─────────────────────────

export async function connectMcpServers(
  configs: McpServerConfig[],
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<Map<string, string[]>> {
  const results = new Map<string, string[]>();

  for (let i = 0; i < configs.length; i += batchSize) {
    const batch = configs.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((config) => connectMcpServer(config)),
    );

    for (let j = 0; j < batch.length; j++) {
      const result = batchResults[j];
      if (result.status === "fulfilled") {
        results.set(batch[j].name, result.value);
      } else {
        console.error(`[mcp-client] Failed to connect ${batch[j].name}:`, result.reason);
        results.set(batch[j].name, []);
      }
    }
  }

  return results;
}

// ── Query ──────────────────────────────────────────────────────────

export function getConnectedServers(): Array<{ name: string; toolCount: number }> {
  return [...connectedServers.values()].map((s) => ({
    name: s.name,
    toolCount: s.tools.length,
  }));
}

export function isServerConnected(name: string): boolean {
  return connectedServers.has(name);
}

// ── Wrap MCP tool as internal Tool ─────────────────────────────────

function wrapMcpTool(serverName: string, mcpTool: McpToolDef, client: Client): Tool {
  const toolName = `mcp__${serverName}__${mcpTool.name}`;

  return {
    name: toolName,
    searchHint: mcpTool.description ?? mcpTool.name,
    maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
    shouldDefer: true,

    async description() { return mcpTool.description ?? `MCP tool: ${mcpTool.name}`; },
    async prompt() { return mcpTool.description ?? ""; },

    get inputSchema() { return z.record(z.unknown()) as any; },
    get outputSchema() { return z.any() as any; },

    userFacingName() { return `${serverName}/${mcpTool.name}`; },
    isEnabled() { return connectedServers.has(serverName); },
    isConcurrencySafe() { return true; },
    isReadOnly() { return false; },
    toAutoClassifierInput(input: Record<string, unknown>) {
      return `${serverName} ${mcpTool.name} ${JSON.stringify(input).slice(0, 100)}`;
    },

    async checkPermissions(input: Record<string, unknown>) {
      return { behavior: "ask" as const, message: `Run MCP tool ${serverName}/${mcpTool.name}?` };
    },
    async validateInput() { return { result: true }; },

    async call(input: Record<string, unknown>): Promise<ToolCallResult> {
      const result = await client.callTool({
        name: mcpTool.name,
        arguments: input,
      });

      // Extract text content from MCP result
      const textParts: string[] = [];
      if (result.content && Array.isArray(result.content)) {
        for (const part of result.content) {
          if (typeof part === "object" && part !== null && "text" in part) {
            textParts.push(String((part as { text: string }).text));
          }
        }
      }

      return {
        data: {
          content: textParts.join("\n"),
          isError: result.isError ?? false,
        },
      };
    },

    mapToolResultToToolResultBlockParam(result: any, toolUseId: string): ToolResultBlockParam {
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: result.content ?? JSON.stringify(result),
        is_error: result.isError,
      };
    },
  };
}
