/**
 * Convert MCP tools (registered in the tool registry) to ToolHandler format
 * compatible with the agent loop.
 */
import type { ToolHandler, ToolResult } from "../core/agent-loop.js";
import { getMcpTools } from "../tools/registry.js";
import type { Tool } from "../tools/interface.js";

/**
 * Read all MCP tools currently in the registry and return them
 * as ToolHandler objects the agent loop can use directly.
 */
export function mcpToolsToHandlers(): ToolHandler[] {
  const mcpTools = getMcpTools();
  return mcpTools.map(mcpToolToHandler);
}

function mcpToolToHandler(tool: Tool): ToolHandler {
  return {
    name: tool.name,
    description: typeof tool.description === "function"
      ? (tool.searchHint || `MCP tool: ${tool.name}`)
      : String(tool.description),
    // MCP tools use a permissive object schema — the server validates
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: true,
    },
    isReadOnly: tool.isReadOnly(),
    isConcurrencySafe: tool.isConcurrencySafe(),
    async call(input: Record<string, unknown>): Promise<ToolResult> {
      try {
        const result = await tool.call(input as any, {
          abortController: new AbortController(),
          getAppState: () => ({ toolPermissionContext: {}, verbose: false }),
          setAppState: () => {},
          options: {
            mainLoopModel: "sonnet",
            thinkingConfig: { type: "disabled" as const },
            isNonInteractiveSession: false,
            tools: [],
            agentDefinitions: { activeAgents: [] },
          },
        } as any);

        const block = tool.mapToolResultToToolResultBlockParam(result.data as any, "");
        return block.is_error
          ? { data: block.content, error: block.content, isError: true }
          : { data: block.content };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return { error: errMsg, isError: true };
      }
    },
  };
}
