/**
 * Tool registry — register, discover, and manage tools
 *
 * Features:
 *   - Register tools by name
 *   - Deferred tools (loaded on demand via ToolSearch)
 *   - MCP tools (from connected MCP servers)
 *   - Tool search by keyword matching
 *   - Enable/disable tools
 *   - Get tool definitions for API
 */
import type { Tool } from "./interface.js";
import type { ToolDefinition } from "../api/client.js";
import { READ_ONLY_TOOLS, WRITE_TOOLS } from "../core/constants.js";

// ── Registry State ─────────────────────────────────────────────────

const registeredTools = new Map<string, Tool>();
const deferredTools = new Map<string, DeferredToolInfo>();
const disabledTools = new Set<string>();
const mcpTools = new Map<string, Tool>();

/** Full JSON schemas for deferred tools — populated by the UI layer, read by ToolSearch */
const deferredToolSchemas = new Map<string, DeferredToolSchema>();

export interface DeferredToolInfo {
  name: string;
  searchHint: string;
  description: string;
  loader: () => Promise<Tool>;
}

export interface DeferredToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ── Registration ───────────────────────────────────────────────────

/**
 * Register a built-in tool.
 */
export function registerTool(tool: Tool): void {
  registeredTools.set(tool.name, tool);
}

/**
 * Register multiple tools at once.
 */
export function registerTools(tools: Tool[]): void {
  for (const tool of tools) {
    registerTool(tool);
  }
}

/**
 * Register a deferred tool (loaded on demand).
 */
export function registerDeferredTool(info: DeferredToolInfo): void {
  deferredTools.set(info.name, info);
}

/**
 * Register an MCP tool (from external server).
 */
export function registerMcpTool(tool: Tool): void {
  mcpTools.set(tool.name, tool);
}

/**
 * Remove an MCP tool.
 */
export function unregisterMcpTool(name: string): void {
  mcpTools.delete(name);
}

/**
 * Clear all MCP tools (e.g., when MCP server disconnects).
 */
export function clearMcpTools(): void {
  mcpTools.clear();
}

/**
 * Get all registered MCP tools.
 */
export function getMcpTools(): Tool[] {
  return [...mcpTools.values()];
}

// ── Lookup ─────────────────────────────────────────────────────────

/**
 * Get a tool by name (checks registered, MCP, then deferred).
 */
export function getTool(name: string): Tool | null {
  // Check registered tools first
  const registered = registeredTools.get(name);
  if (registered) return registered;

  // Check MCP tools
  const mcp = mcpTools.get(name);
  if (mcp) return mcp;

  // Deferred tools are not resolved here — use loadDeferredTool()
  return null;
}

/**
 * Load a deferred tool by name.
 */
export async function loadDeferredTool(name: string): Promise<Tool | null> {
  const info = deferredTools.get(name);
  if (!info) return null;

  const tool = await info.loader();
  registeredTools.set(name, tool);
  deferredTools.delete(name);
  return tool;
}

/**
 * Check if a tool exists (registered, MCP, or deferred).
 */
export function hasTool(name: string): boolean {
  return registeredTools.has(name) || mcpTools.has(name) || deferredTools.has(name);
}

// ── Querying ───────────────────────────────────────────────────────

/**
 * Get all enabled tools (registered + MCP, excluding disabled).
 */
export function getEnabledTools(): Tool[] {
  const tools: Tool[] = [];

  for (const [name, tool] of registeredTools) {
    if (!disabledTools.has(name) && tool.isEnabled()) {
      tools.push(tool);
    }
  }

  for (const [name, tool] of mcpTools) {
    if (!disabledTools.has(name) && tool.isEnabled()) {
      tools.push(tool);
    }
  }

  return tools;
}

/**
 * Get all tool names (including deferred).
 */
export function getAllToolNames(): string[] {
  const names = new Set<string>();
  for (const name of registeredTools.keys()) names.add(name);
  for (const name of mcpTools.keys()) names.add(name);
  for (const name of deferredTools.keys()) names.add(name);
  return [...names];
}

/**
 * Get deferred tool info for ToolSearch display.
 */
export function getDeferredToolInfos(): DeferredToolInfo[] {
  return [...deferredTools.values()];
}

/**
 * Store the full JSON schema for a deferred tool.
 * Called by the UI layer when splitting tools into immediate/deferred groups.
 */
export function setDeferredToolSchema(schema: DeferredToolSchema): void {
  deferredToolSchemas.set(schema.name, schema);
}

/**
 * Store multiple deferred tool schemas at once.
 */
export function setDeferredToolSchemas(schemas: DeferredToolSchema[]): void {
  for (const s of schemas) {
    deferredToolSchemas.set(s.name, s);
  }
}

/**
 * Get a deferred tool's full schema by name.
 */
export function getDeferredToolSchema(name: string): DeferredToolSchema | undefined {
  return deferredToolSchemas.get(name);
}

/**
 * Get all deferred tool schemas.
 */
export function getAllDeferredToolSchemas(): DeferredToolSchema[] {
  return [...deferredToolSchemas.values()];
}

/**
 * Search deferred tool schemas by keyword matching.
 * Returns matching schemas sorted by relevance.
 */
export function searchDeferredToolSchemas(query: string, maxResults = 5): DeferredToolSchema[] {
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/);

  // Support "select:Name1,Name2" syntax for exact name lookup
  if (queryLower.startsWith("select:")) {
    const names = query.slice(7).split(",").map(n => n.trim());
    return names
      .map(n => deferredToolSchemas.get(n))
      .filter((s): s is DeferredToolSchema => s !== undefined);
  }

  // Support "+required term" syntax: require the prefixed word in the name
  const requiredTerms = queryTerms.filter(t => t.startsWith("+")).map(t => t.slice(1));
  const searchTerms = queryTerms.filter(t => !t.startsWith("+"));

  const results: Array<{ schema: DeferredToolSchema; score: number }> = [];

  for (const schema of deferredToolSchemas.values()) {
    const nameLower = schema.name.toLowerCase();
    const descLower = schema.description.toLowerCase();

    // Check required terms — all must be in the name
    if (requiredTerms.length > 0 && !requiredTerms.every(rt => nameLower.includes(rt))) {
      continue;
    }

    let score = 0;
    const allTerms = searchTerms.length > 0 ? searchTerms : requiredTerms;
    for (const term of allTerms) {
      if (nameLower === term) score += 10;
      else if (nameLower.includes(term)) score += 5;
      if (descLower.includes(term)) score += 3;
    }

    if (score > 0) {
      results.push({ schema, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults).map(r => r.schema);
}

/**
 * Build tool definitions for the Anthropic API.
 */
export function buildToolDefinitions(tools?: Tool[]): ToolDefinition[] {
  const allTools = tools ?? getEnabledTools();
  return allTools.map((tool) => ({
    name: tool.name,
    description: typeof tool.description === "function"
      ? "Tool: " + tool.name // Will be resolved dynamically
      : String(tool.description),
    input_schema: zodSchemaToJsonSchema(tool.inputSchema),
  }));
}

// ── Enable/Disable ─────────────────────────────────────────────────

export function disableTool(name: string): void {
  disabledTools.add(name);
}

export function enableTool(name: string): void {
  disabledTools.delete(name);
}

export function isToolDisabled(name: string): boolean {
  return disabledTools.has(name);
}

// ── Tool Search ────────────────────────────────────────────────────

/**
 * Search for tools by keyword matching against name and searchHint.
 */
export function searchTools(query: string, maxResults = 5): Array<{ name: string; hint: string; deferred: boolean }> {
  const results: Array<{ name: string; hint: string; deferred: boolean; score: number }> = [];
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/);

  // Search registered tools
  for (const tool of registeredTools.values()) {
    const score = matchScore(tool.name, tool.searchHint, queryTerms);
    if (score > 0) {
      results.push({ name: tool.name, hint: tool.searchHint, deferred: false, score });
    }
  }

  // Search MCP tools
  for (const tool of mcpTools.values()) {
    const score = matchScore(tool.name, tool.searchHint, queryTerms);
    if (score > 0) {
      results.push({ name: tool.name, hint: tool.searchHint, deferred: false, score });
    }
  }

  // Search deferred tools
  for (const info of deferredTools.values()) {
    const score = matchScore(info.name, info.searchHint, queryTerms);
    if (score > 0) {
      results.push({ name: info.name, hint: info.searchHint, deferred: true, score });
    }
  }

  // Sort by score descending, take top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults).map(({ name, hint, deferred }) => ({ name, hint, deferred }));
}

function matchScore(name: string, hint: string, queryTerms: string[]): number {
  const nameLower = name.toLowerCase();
  const hintLower = hint.toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    if (nameLower === term) score += 10;
    else if (nameLower.includes(term)) score += 5;
    if (hintLower.includes(term)) score += 3;
  }

  return score;
}

// ── Tool Classification Helpers ────────────────────────────────────

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

// ── Reset (for testing) ────────────────────────────────────────────

export function resetRegistry(): void {
  registeredTools.clear();
  deferredTools.clear();
  deferredToolSchemas.clear();
  disabledTools.clear();
  mcpTools.clear();
}

// ── Schema Conversion ──────────────────────────────────────────────

/**
 * Convert a Zod schema to JSON Schema for the API.
 * This is a simplified converter — full Zod-to-JSON-Schema conversion
 * would use a library like zod-to-json-schema.
 */
function zodSchemaToJsonSchema(schema: unknown): Record<string, unknown> {
  // If schema has a _def, try to extract JSON Schema
  const s = schema as { _def?: { typeName?: string }; shape?: unknown };

  if (s && typeof s === "object" && "_def" in s) {
    // Try to use Zod's built-in JSON schema generation if available
    try {
      const zodSchema = schema as { _toJsonSchema?: () => Record<string, unknown> };
      if (typeof zodSchema._toJsonSchema === "function") {
        return zodSchema._toJsonSchema();
      }
    } catch {
      // Fall through
    }
  }

  // Fallback: return a permissive object schema
  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
}
