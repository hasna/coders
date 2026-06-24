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
import { getDb } from "../db/index.js";
import { DEFAULT_TEXT_LIMIT, compactLongText, parseLimit, sliceWithLimit, truncateLine } from "../utils/output.js";

// ── Agent registry (in-memory) ─────────────────────────────────────
const _agentReg = new Map<string, { id: string; name: string; last_seen_at: string; project_id?: string }>();

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

    // Agent tools
    mcpTools.push(
      { name: "register_agent", description: "Register an agent session (idempotent). Auto-updates last_seen_at on re-register.", inputSchema: { type: "object", properties: { name: { type: "string" }, session_id: { type: "string" } }, required: ["name"] } },
      { name: "heartbeat", description: "Update last_seen_at to signal agent is active.", inputSchema: { type: "object", properties: { agent_id: { type: "string" } }, required: ["agent_id"] } },
      { name: "set_focus", description: "Set active project context for this agent session.", inputSchema: { type: "object", properties: { agent_id: { type: "string" }, project_id: { type: "string" } }, required: ["agent_id"] } },
      { name: "list_agents", description: "List registered agents. Returns the historical JSON array by default; pass format:'text' for a compact table.", inputSchema: { type: "object", properties: { limit: { type: "number" }, format: { type: "string", enum: ["json", "text"] } } } },
      { name: "send_feedback", description: "Send feedback about this service", inputSchema: { type: "object", properties: { message: { type: "string" }, email: { type: "string" }, category: { type: "string", enum: ["bug", "feature", "general"] } }, required: ["message"] } },
    );

    return { tools: mcpTools };
  });

  // ── tools/call handler ───────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Handle agent tools
    if (name === "register_agent") {
      const a = args as { name: string; session_id?: string };
      const existing = [..._agentReg.values()].find(x => x.name === a.name);
      if (existing) { existing.last_seen_at = new Date().toISOString(); return { content: [{ type: "text", text: JSON.stringify(existing) }] }; }
      const id = Math.random().toString(36).slice(2, 10);
      const ag = { id, name: a.name, last_seen_at: new Date().toISOString() };
      _agentReg.set(id, ag);
      return { content: [{ type: "text", text: JSON.stringify(ag) }] };
    }
    if (name === "heartbeat") {
      const a = args as { agent_id: string };
      const ag = _agentReg.get(a.agent_id);
      if (!ag) return { content: [{ type: "text", text: `Agent not found: ${a.agent_id}` }], isError: true };
      ag.last_seen_at = new Date().toISOString();
      return { content: [{ type: "text", text: JSON.stringify({ id: ag.id, name: ag.name, last_seen_at: ag.last_seen_at }) }] };
    }
    if (name === "set_focus") {
      const a = args as { agent_id: string; project_id?: string };
      const ag = _agentReg.get(a.agent_id);
      if (!ag) return { content: [{ type: "text", text: `Agent not found: ${a.agent_id}` }], isError: true };
      (ag as any).project_id = a.project_id ?? undefined;
      return { content: [{ type: "text", text: a.project_id ? `Focus: ${a.project_id}` : "Focus cleared" }] };
    }
    if (name === "list_agents") {
      const agents = [..._agentReg.values()];
      if (agents.length === 0) return { content: [{ type: "text", text: "No agents registered." }] };
      const requested = args as { limit?: number; format?: "json" | "text" } | undefined;
      if (requested?.format !== "text") {
        return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
      }
      const limit = parseLimit(requested?.limit, 20, 200);
      const visible = sliceWithLimit(agents, limit);
      const lines = visible.items.map((a) => {
        const focus = a.project_id ? ` ${truncateLine(a.project_id, 60)}` : "";
        return `${a.id.padEnd(10)} ${truncateLine(a.name, 32).padEnd(32)} ${a.last_seen_at}${focus}`;
      });
      const hidden = visible.hidden > 0
        ? `\n${visible.hidden} more agent(s) hidden. Call list_agents with limit:${Math.min(agents.length, limit * 2)} for more.`
        : "";
      return {
        content: [{
          type: "text",
          text: `Agents (${visible.items.length}/${agents.length}):\nID         Name                             Last seen${lines.length ? `\n${lines.join("\n")}` : ""}${hidden}`,
        }],
      };
    }
    if (name === "send_feedback") {
      try {
        const p = args as { message: string; email?: string; category?: string };
        const db = getDb();
        db.exec(`CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), message TEXT NOT NULL, email TEXT, category TEXT DEFAULT 'general', version TEXT, machine_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
        const stmt = db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)");
        stmt.run(p.message, p.email || null, p.category || "general", VERSION);
        return { content: [{ type: "text", text: "Feedback saved. Thank you!" }] };
      } catch (e) {
        return { content: [{ type: "text", text: String(e) }], isError: true };
      }
    }

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
      const content = compactLongText(
        block.content,
        DEFAULT_TEXT_LIMIT * 3,
        "Use the tool's limit, filter, verbose, or detail parameters for more content.",
      );

      return {
        content: [{ type: "text", text: content }],
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

export const buildServer = createMcpServer;

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
