/**
 * MCP Resources tools — list and read resources from connected MCP servers
 *
 * Two tools:
 *   - ListMcpResourcesTool: enumerate all resources across all connected servers
 *   - ReadMcpResourceTool: read a specific resource by server name + URI
 */
import { z } from "zod";
import type { Tool, ToolCallResult } from "../interface.js";
import {
  LIST_MCP_RESOURCES_TOOL,
  READ_MCP_RESOURCE_TOOL,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
} from "../../core/constants.js";
import {
  getConnectedServerNames,
  getServerClient,
} from "../../mcp/client.js";

// ── ListMcpResourcesTool ────────────────────────────────────────────

const ListMcpResourcesInputSchema = z.strictObject({});

type ListMcpResourcesInput = z.infer<typeof ListMcpResourcesInputSchema>;

interface McpResourceEntry {
  server: string;
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface ListMcpResourcesOutput {
  resources: McpResourceEntry[];
  totalCount: number;
}

const ListMcpResourcesOutputSchema = z.object({
  resources: z.array(z.object({
    server: z.string(),
    uri: z.string(),
    name: z.string(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
  })),
  totalCount: z.number(),
});

export const listMcpResourcesTool: Tool<ListMcpResourcesInput, ListMcpResourcesOutput> = {
  name: LIST_MCP_RESOURCES_TOOL,
  searchHint: "list MCP server resources",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,

  async description() {
    return "List all resources available from connected MCP servers.";
  },

  async prompt() {
    return LIST_MCP_RESOURCES_PROMPT;
  },

  get inputSchema() { return ListMcpResourcesInputSchema; },
  get outputSchema() { return ListMcpResourcesOutputSchema; },

  userFacingName() { return "List MCP Resources"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },

  toAutoClassifierInput() {
    return "list mcp resources";
  },

  async validateInput() {
    return { result: true };
  },

  async checkPermissions() {
    return { behavior: "allow" };
  },

  async call(_input, _context): Promise<ToolCallResult<ListMcpResourcesOutput>> {
    const serverNames = getConnectedServerNames();
    const resources: McpResourceEntry[] = [];

    for (const serverName of serverNames) {
      const client = getServerClient(serverName);
      if (!client) continue;

      try {
        const result = await client.listResources();
        if (result.resources && Array.isArray(result.resources)) {
          for (const res of result.resources) {
            resources.push({
              server: serverName,
              uri: res.uri,
              name: res.name,
              description: res.description,
              mimeType: res.mimeType,
            });
          }
        }
      } catch {
        // Server may not support resources — skip silently
      }
    }

    return {
      data: {
        resources,
        totalCount: resources.length,
      },
    };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    if (result.resources.length === 0) {
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "No resources found from any connected MCP server.",
      };
    }

    const lines = result.resources.map((r) => {
      let line = `[${r.server}] ${r.uri} — ${r.name}`;
      if (r.description) line += ` (${r.description})`;
      if (r.mimeType) line += ` [${r.mimeType}]`;
      return line;
    });

    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: `Found ${result.totalCount} resource(s):\n\n${lines.join("\n")}`,
    };
  },
};

const LIST_MCP_RESOURCES_PROMPT = `List all resources available from connected MCP servers.
- Returns resources with server name, URI, name, description, and MIME type
- No input required — queries all connected servers
- Use ReadMcpResourceTool to read a specific resource by server name and URI`;

// ── ReadMcpResourceTool ─────────────────────────────────────────────

const ReadMcpResourceInputSchema = z.strictObject({
  server_name: z.string().describe("The name of the MCP server that owns the resource"),
  uri: z.string().describe("The URI of the resource to read"),
});

type ReadMcpResourceInput = z.infer<typeof ReadMcpResourceInputSchema>;

interface ReadMcpResourceOutput {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
}

const ReadMcpResourceOutputSchema = z.object({
  contents: z.array(z.object({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
  })),
});

export const readMcpResourceTool: Tool<ReadMcpResourceInput, ReadMcpResourceOutput> = {
  name: READ_MCP_RESOURCE_TOOL,
  searchHint: "read MCP server resource by URI",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,

  async description(input) {
    return input?.uri
      ? `Read MCP resource: ${input.uri}`
      : "Read a resource from a connected MCP server.";
  },

  async prompt() {
    return READ_MCP_RESOURCE_PROMPT;
  },

  get inputSchema() { return ReadMcpResourceInputSchema; },
  get outputSchema() { return ReadMcpResourceOutputSchema; },

  userFacingName() { return "Read MCP Resource"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },

  toAutoClassifierInput(input) {
    return `${input.server_name} ${input.uri}`;
  },

  async validateInput(input) {
    if (!input.server_name?.trim()) {
      return { result: false, message: "server_name is required", errorCode: 1 };
    }
    if (!input.uri?.trim()) {
      return { result: false, message: "uri is required", errorCode: 2 };
    }
    return { result: true };
  },

  async checkPermissions() {
    return { behavior: "allow" };
  },

  async call(input, _context): Promise<ToolCallResult<ReadMcpResourceOutput>> {
    const client = getServerClient(input.server_name);
    if (!client) {
      return {
        data: {
          contents: [{
            uri: input.uri,
            text: `Error: MCP server "${input.server_name}" is not connected. Use ListMcpResourcesTool to see available servers.`,
          }],
        },
      };
    }

    try {
      const result = await client.readResource({ uri: input.uri });

      const contents = (result.contents ?? []).map((c: any) => ({
        uri: c.uri ?? input.uri,
        mimeType: c.mimeType,
        text: c.text,
        blob: c.blob,
      }));

      return { data: { contents } };
    } catch (error) {
      return {
        data: {
          contents: [{
            uri: input.uri,
            text: `Error reading resource: ${error instanceof Error ? error.message : String(error)}`,
          }],
        },
      };
    }
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    if (result.contents.length === 0) {
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "Resource returned no content.",
      };
    }

    const parts: string[] = [];
    for (const c of result.contents) {
      if (c.text) {
        parts.push(c.text);
      } else if (c.blob) {
        parts.push(`[base64 blob, ${c.blob.length} chars]${c.mimeType ? ` (${c.mimeType})` : ""}`);
      } else {
        parts.push(`[empty content for ${c.uri}]`);
      }
    }

    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: parts.join("\n\n"),
    };
  },
};

const READ_MCP_RESOURCE_PROMPT = `Read a resource from a connected MCP server.
- Requires server_name (the MCP server name) and uri (the resource URI)
- Use ListMcpResourcesTool first to discover available resources
- Returns text content or base64-encoded binary data`;
