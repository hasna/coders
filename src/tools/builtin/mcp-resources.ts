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
import {
  DEFAULT_TEXT_LIMIT,
  MAX_TEXT_LIMIT,
  parseLimit,
  sliceWithLimit,
  truncateLine,
} from "../../utils/output.js";

// ── ListMcpResourcesTool ────────────────────────────────────────────

const ListMcpResourcesInputSchema = z.strictObject({
  limit: z.number().optional().describe("Maximum resources to include in the default summary"),
  offset: z.number().optional().describe("Number of resources to skip before rendering the summary"),
  verbose: z.boolean().optional().describe("Include full URI and description text in the summary"),
});

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
  hiddenCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset?: number;
  verbose?: boolean;
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
  hiddenCount: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
  nextOffset: z.number().optional(),
  verbose: z.boolean().optional(),
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

  async checkPermissions(input: any) {
    return { behavior: "allow", updatedInput: input };
  },

  async call(input = {}, _context): Promise<ToolCallResult<ListMcpResourcesOutput>> {
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

    const limit = parseLimit(input.limit, 20, 200);
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const shown = Math.min(limit, Math.max(0, resources.length - offset));
    const hidden = Math.max(0, resources.length - offset - shown);

    return {
      data: {
        resources,
        totalCount: resources.length,
        hiddenCount: hidden,
        limit,
        offset,
        hasMore: hidden > 0,
        nextOffset: hidden > 0 ? offset + shown : undefined,
        verbose: input.verbose,
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

    const offset = result.offset ?? 0;
    const limit = result.limit ?? 20;
    const { items: visibleResources, hidden } = sliceWithLimit(result.resources.slice(offset), limit);
    const hiddenCount = result.hiddenCount ?? hidden;
    const nextOffset = result.nextOffset ?? (hiddenCount > 0 ? offset + visibleResources.length : undefined);
    const lines = visibleResources.map((r) => {
      const uri = result.verbose ? r.uri : truncateLine(r.uri, 96);
      let line = `[${r.server}] ${uri} - ${truncateLine(r.name, 80)}`;
      if (r.description) {
        line += ` (${result.verbose ? r.description : truncateLine(r.description, 120)})`;
      }
      if (r.mimeType) line += ` [${r.mimeType}]`;
      return line;
    });
    const hiddenHint = hiddenCount > 0
      ? `\n\n${hiddenCount} more resource(s) hidden. Use offset:${nextOffset} limit:${limit}, or ReadMcpResourceTool for a specific URI.`
      : "";
    const detailHint = result.verbose ? "" : "\nUse verbose:true for full URI and description text.";

    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: `Found ${result.totalCount} resource(s), showing ${visibleResources.length}:\n\n${lines.join("\n")}${hiddenHint}${detailHint}`,
    };
  },
};

const LIST_MCP_RESOURCES_PROMPT = `List all resources available from connected MCP servers.
- Returns resources with server name, URI, name, description, and MIME type
- Compact by default. Use limit and offset to page rows, and verbose:true for full text.
- Use ReadMcpResourceTool to read a specific resource by server name and URI`;

// ── ReadMcpResourceTool ─────────────────────────────────────────────

const ReadMcpResourceInputSchema = z.strictObject({
  server_name: z.string().describe("The name of the MCP server that owns the resource"),
  uri: z.string().describe("The URI of the resource to read"),
  limit: z.number().optional().describe("Maximum text/blob characters to return. Defaults to a compact summary."),
  offset: z.number().optional().describe("Character offset to render from in the compact summary"),
});

type ReadMcpResourceInput = z.infer<typeof ReadMcpResourceInputSchema>;

interface ReadMcpResourceOutput {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
    totalChars?: number;
  }>;
  limit: number;
  offset: number;
}

const ReadMcpResourceOutputSchema = z.object({
  contents: z.array(z.object({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
    totalChars: z.number().optional(),
  })),
  limit: z.number(),
  offset: z.number(),
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

  async checkPermissions(input: any) {
    return { behavior: "allow", updatedInput: input };
  },

  async call(input, _context): Promise<ToolCallResult<ReadMcpResourceOutput>> {
    const limit = parseLimit(input.limit, DEFAULT_TEXT_LIMIT, MAX_TEXT_LIMIT);
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const client = getServerClient(input.server_name);
    if (!client) {
      return {
        data: {
          contents: [{
            uri: input.uri,
            text: `Error: MCP server "${input.server_name}" is not connected. Use ListMcpResourcesTool to see available servers.`,
            totalChars: 0,
          }],
          limit,
          offset,
        },
      };
    }

    try {
      const result = await client.readResource({ uri: input.uri });

      const contents = (result.contents ?? []).map((c: any) => {
        const rawText = c.text == null ? undefined : String(c.text);
        const rawBlob = c.blob == null ? undefined : String(c.blob);
        const raw = rawText ?? rawBlob ?? "";
        return {
          uri: c.uri ?? input.uri,
          mimeType: c.mimeType,
          text: rawText,
          blob: rawText == null ? rawBlob : undefined,
          totalChars: raw.length,
        };
      });

      return { data: { contents, limit, offset } };
    } catch (error) {
      return {
        data: {
          contents: [{
            uri: input.uri,
            text: `Error reading resource: ${error instanceof Error ? error.message : String(error)}`,
            totalChars: 0,
          }],
          limit,
          offset,
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
        const rendered = renderResourceContent(c.text, result.offset, result.limit);
        parts.push(`${rendered.text}${rendered.metadata}`);
      } else if (c.blob) {
        const blobLimit = Math.min(result.limit, 1_000);
        const rendered = renderResourceContent(c.blob, result.offset, blobLimit);
        parts.push(`[base64 blob preview]${c.mimeType ? ` (${c.mimeType})` : ""}\n${rendered.text}${rendered.metadata}`);
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
- Returns compact text content by default. Pass limit and offset for more characters. Binary blobs are previewed.`;

function renderResourceContent(value: string, offset: number, limit: number): { text: string; metadata: string } {
  const safeOffset = Math.min(Math.max(0, offset), value.length);
  const safeLimit = parseLimit(limit, DEFAULT_TEXT_LIMIT, MAX_TEXT_LIMIT);
  const end = Math.min(value.length, safeOffset + safeLimit);
  const text = value.slice(safeOffset, end);
  const next = end < value.length ? end : undefined;
  const metadata = `\n[content chars: ${value.length}, shown ${safeOffset}-${end}${next != null ? `, next offset:${next}` : ""}]` +
    (next != null ? `\nUse ReadMcpResourceTool with offset:${next} limit:${safeLimit} for the next chunk.` : "");
  return { text, metadata };
}
