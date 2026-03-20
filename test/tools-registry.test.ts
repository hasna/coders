import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import {
  registerTool,
  registerTools,
  registerDeferredTool,
  registerMcpTool,
  getTool,
  hasTool,
  getEnabledTools,
  getAllToolNames,
  searchTools,
  disableTool,
  enableTool,
  isToolDisabled,
  resetRegistry,
  loadDeferredTool,
  isReadOnlyTool,
  isWriteTool,
  type DeferredToolInfo,
} from "../src/tools/registry.js";
import type { Tool, ToolContext, ToolCallResult, ToolResultBlockParam } from "../src/tools/interface.js";

function createMockTool(name: string, opts?: Partial<Tool>): Tool {
  return {
    name,
    searchHint: `mock ${name} tool`,
    maxResultSizeChars: 100_000,
    shouldDefer: false,
    description: async () => `Description for ${name}`,
    prompt: async () => `Prompt for ${name}`,
    get inputSchema() { return z.object({}) as any; },
    get outputSchema() { return z.object({}) as any; },
    userFacingName: () => name,
    isEnabled: () => true,
    isConcurrencySafe: () => true,
    isReadOnly: () => false,
    toAutoClassifierInput: () => "",
    checkPermissions: async () => ({ behavior: "passthrough" as const }),
    validateInput: async () => ({ result: true }),
    call: async () => ({ data: {} } satisfies ToolCallResult),
    mapToolResultToToolResultBlockParam: (result, id) => ({
      type: "tool_result" as const,
      tool_use_id: id,
      content: JSON.stringify(result),
    } satisfies ToolResultBlockParam),
    ...opts,
  };
}

describe("tools/registry", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it("registers and retrieves a tool", () => {
    const tool = createMockTool("TestTool");
    registerTool(tool);
    expect(getTool("TestTool")).toBe(tool);
  });

  it("registers multiple tools", () => {
    const tools = [createMockTool("A"), createMockTool("B"), createMockTool("C")];
    registerTools(tools);
    expect(getTool("A")).toBeTruthy();
    expect(getTool("B")).toBeTruthy();
    expect(getTool("C")).toBeTruthy();
  });

  it("returns null for unknown tool", () => {
    expect(getTool("UnknownTool")).toBeNull();
  });

  it("hasTool checks registered tools", () => {
    registerTool(createMockTool("Bash"));
    expect(hasTool("Bash")).toBe(true);
    expect(hasTool("Missing")).toBe(false);
  });

  it("getEnabledTools returns only enabled tools", () => {
    registerTool(createMockTool("Enabled"));
    registerTool(createMockTool("Disabled", { isEnabled: () => false }));
    const enabled = getEnabledTools();
    expect(enabled.map(t => t.name)).toContain("Enabled");
    expect(enabled.map(t => t.name)).not.toContain("Disabled");
  });

  it("disables and enables tools", () => {
    registerTool(createMockTool("Bash"));
    expect(isToolDisabled("Bash")).toBe(false);

    disableTool("Bash");
    expect(isToolDisabled("Bash")).toBe(true);
    expect(getEnabledTools().map(t => t.name)).not.toContain("Bash");

    enableTool("Bash");
    expect(isToolDisabled("Bash")).toBe(false);
    expect(getEnabledTools().map(t => t.name)).toContain("Bash");
  });

  it("getAllToolNames includes registered, MCP, and deferred", () => {
    registerTool(createMockTool("Read"));
    registerMcpTool(createMockTool("mcp__browser__click"));
    registerDeferredTool({
      name: "LSP",
      searchHint: "code intelligence",
      description: "LSP tool",
      loader: async () => createMockTool("LSP"),
    });
    const names = getAllToolNames();
    expect(names).toContain("Read");
    expect(names).toContain("mcp__browser__click");
    expect(names).toContain("LSP");
  });

  it("searchTools finds tools by name", () => {
    registerTool(createMockTool("Read"));
    registerTool(createMockTool("Edit"));
    registerTool(createMockTool("Bash"));
    const results = searchTools("read");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("Read");
  });

  it("searchTools finds tools by hint", () => {
    registerTool(createMockTool("Grep", { searchHint: "search file contents with ripgrep" }));
    const results = searchTools("ripgrep");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("Grep");
  });

  it("searchTools returns deferred tools", () => {
    registerDeferredTool({
      name: "WebFetch",
      searchHint: "fetch URL content",
      description: "Fetch web content",
      loader: async () => createMockTool("WebFetch"),
    });
    const results = searchTools("fetch URL");
    expect(results.some(r => r.name === "WebFetch" && r.deferred)).toBe(true);
  });

  it("loadDeferredTool resolves and moves to registered", async () => {
    const mockTool = createMockTool("LSP");
    registerDeferredTool({
      name: "LSP",
      searchHint: "code intelligence",
      description: "LSP",
      loader: async () => mockTool,
    });

    expect(getTool("LSP")).toBeNull(); // not registered yet
    expect(hasTool("LSP")).toBe(true); // but known as deferred

    const loaded = await loadDeferredTool("LSP");
    expect(loaded).toBe(mockTool);
    expect(getTool("LSP")).toBe(mockTool); // now registered
  });

  it("MCP tools appear in enabled tools", () => {
    registerMcpTool(createMockTool("mcp__db__query"));
    const enabled = getEnabledTools();
    expect(enabled.map(t => t.name)).toContain("mcp__db__query");
  });

  it("classifies read-only and write tools", () => {
    expect(isReadOnlyTool("Read")).toBe(true);
    expect(isReadOnlyTool("Glob")).toBe(true);
    expect(isReadOnlyTool("Grep")).toBe(true);
    expect(isReadOnlyTool("Bash")).toBe(false);
    expect(isWriteTool("Edit")).toBe(true);
    expect(isWriteTool("Write")).toBe(true);
    expect(isWriteTool("Read")).toBe(false);
  });
});
