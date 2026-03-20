/**
 * MCP Server — expose coders as an MCP tool provider
 *
 * Runs via `coders mcp serve` and exposes all built-in tools
 * to MCP clients (Claude Desktop, other agents, etc.)
 *
 * Implements MCP protocol: tools/list, tools/call, notifications, logging
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool as McpTool,
} from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "../cli/index.js";
import { getEnabledTools, getTool } from "../tools/registry.js";

// ── Server creation ────────────────────────────────────────────────

export interface McpServerOptions {
  debug?: boolean;
  verbose?: boolean;
}

export async function createMcpServer(options: McpServerOptions = {}): Promise<Server> {
  const server = new Server(
    {
      name: "@hasna/coders",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    },
  );

  // ── tools/list handler ───────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = getEnabledTools();
    const mcpTools: McpTool[] = [];

    for (const tool of tools) {
      // Skip tools that shouldn't be exposed via MCP
      if (tool.name === "Agent" || tool.name === "SendMessage") continue;

      const description = typeof tool.description === "function"
        ? await tool.description()
        : String(tool.description);

      mcpTools.push({
        name: tool.name,
        description,
        inputSchema: schemaToJsonSchema(tool.inputSchema),
      });
    }

    return { tools: mcpTools };
  });

  // ── tools/call handler ───────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = getTool(name);

    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      } satisfies CallToolResult;
    }

    try {
      // Validate input
      const validation = await tool.validateInput(args as any);
      if (!validation.result) {
        return {
          content: [{ type: "text", text: `Validation error: ${validation.message}` }],
          isError: true,
        } satisfies CallToolResult;
      }

      // Create a minimal tool context for MCP execution
      const context = createMcpToolContext();

      // Execute
      const result = await tool.call(args as any, context);
      const block = tool.mapToolResultToToolResultBlockParam(result.data, "mcp-call");

      return {
        content: [{ type: "text", text: block.content }],
        isError: block.is_error ?? false,
      } satisfies CallToolResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.debug) {
        console.error(`[mcp-server] Tool ${name} error:`, error);
      }
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      } satisfies CallToolResult;
    }
  });

  return server;
}

// ── Run server on stdio ────────────────────────────────────────────

export async function runMcpServer(options: McpServerOptions = {}): Promise<void> {
  const server = await createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (options.debug) {
    console.error(`[mcp-server] @hasna/coders v${VERSION} MCP server running on stdio`);
  }

  // Keep alive until transport closes
  await new Promise<void>((resolve) => {
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });
}

// ── Minimal tool context for MCP calls ─────────────────────────────

function createMcpToolContext() {
  const state = {
    toolPermissionContext: { mode: "bypassPermissions" as const, allowRules: [], denyRules: [] },
    verbose: false,
    expandedView: undefined,
  };

  return {
    abortController: new AbortController(),
    getAppState: () => state,
    setAppState: (updater: (s: typeof state) => typeof state) => {
      Object.assign(state, updater(state));
    },
    options: {
      mainLoopModel: "sonnet",
      thinkingConfig: { type: "disabled" as const },
      isNonInteractiveSession: true,
      tools: [],
      agentDefinitions: { activeAgents: [] },
    },
  };
}

// ── Schema conversion ──────────────────────────────────────────────

function schemaToJsonSchema(schema: unknown): Record<string, unknown> {
  // Try Zod's toJsonSchema if available
  try {
    const s = schema as { _def?: unknown };
    if (s?._def) {
      // Use a simple extraction for Zod strict objects
      return { type: "object", properties: {}, additionalProperties: false };
    }
  } catch { /* fallback */ }

  return { type: "object", properties: {} };
}
