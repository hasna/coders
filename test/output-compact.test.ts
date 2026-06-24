import { describe, expect, it } from "vitest";
import {
  compactLongText,
  compactLongTextMiddle,
  parseLimit,
  truncateLine,
} from "../src/utils/output.js";
import { taskOutputTool } from "../src/tools/builtin/task-output.js";
import { webFetchTool } from "../src/tools/builtin/web-fetch.js";
import { webSearchTool } from "../src/tools/builtin/web-search.js";
import { grepTool } from "../src/tools/builtin/grep.js";
import { listMcpResourcesTool, readMcpResourceTool } from "../src/tools/builtin/mcp-resources.js";
import { toolSearchTool } from "../src/tools/builtin/misc.js";
import { resetRegistry, setDeferredToolSchemas } from "../src/tools/registry.js";

describe("compact output helpers", () => {
  it("parses and clamps list limits", () => {
    expect(parseLimit(undefined, 20, 200)).toBe(20);
    expect(parseLimit("50", 20, 200)).toBe(50);
    expect(parseLimit("500", 20, 200)).toBe(200);
    expect(parseLimit("bad", 20, 200)).toBe(20);
  });

  it("truncates one-line and long text with hints", () => {
    expect(truncateLine("hello\n   world", 20)).toBe("hello world");

    const compact = compactLongText("a".repeat(50), 10, "Use details.");
    expect(compact).toContain("truncated 40 character(s)");
    expect(compact).toContain("Use details.");

    const middle = compactLongTextMiddle("1234567890", 6, "More.");
    expect(middle).toContain("123");
    expect(middle).toContain("890");
    expect(middle).toContain("More.");
  });
});

describe("tool result compact defaults", () => {
  it("summarizes TaskOutput with output sizing metadata", () => {
    const block = taskOutputTool.mapToolResultToToolResultBlockParam({
      task_id: "bg-1",
      status: "completed",
      output: compactLongTextMiddle("x".repeat(20_000), 4_000, "Use TaskOutput with limit:30000."),
      totalOutputChars: 20_000,
      returnedOutputChars: 4_100,
      truncated: true,
      limit: 4_000,
    }, "task-output");

    expect(block.content).toContain("Output: 4100/20000 chars");
    expect(block.content).toContain("Output truncated");
    expect(block.content.length).toBeLessThan(5_000);
  });

  it("compacts web fetch and search text blocks", () => {
    const fetchBlock = webFetchTool.mapToolResultToToolResultBlockParam({
      bytes: 25_000,
      code: 200,
      codeText: "OK",
      result: "page ".repeat(5_000),
      durationMs: 10,
      url: "https://example.com",
    }, "fetch");

    expect(fetchBlock.content).toContain("truncated");
    expect(fetchBlock.content.length).toBeLessThan(4_500);

    const searchBlock = webSearchTool.mapToolResultToToolResultBlockParam({
      query: "large result",
      results: ["result ".repeat(5_000)],
      durationSeconds: 1,
    }, "search");

    expect(searchBlock.content).toContain("Web search results");
    expect(searchBlock.content).toContain("truncated");
    expect(searchBlock.content.length).toBeLessThan(5_000);
  });

  it("compacts grep result text and preserves expansion hints", () => {
    const block = grepTool.mapToolResultToToolResultBlockParam({
      content: Array.from({ length: 200 }, (_, i) => `/tmp/file-${i}.ts`).join("\n"),
      matchCount: 200,
      fileCount: 200,
      truncated: true,
    }, "grep");

    expect(block.content).toContain("head_limit");
    expect(block.content).toContain("results truncated");
    expect(block.content.length).toBeLessThan(9_000);
  });

  it("caps MCP resource lists and read content", () => {
    const listBlock = listMcpResourcesTool.mapToolResultToToolResultBlockParam({
      resources: Array.from({ length: 12 }, (_, i) => ({
        server: "docs",
        uri: `file:///very/long/path/${"segment/".repeat(20)}resource-${i}.md`,
        name: `Resource ${i}`,
        description: "description ".repeat(30),
        mimeType: "text/markdown",
      })),
      totalCount: 12,
      hiddenCount: 10,
      limit: 2,
      offset: 0,
      hasMore: true,
      nextOffset: 2,
    }, "mcp-list");

    expect(listBlock.content).toContain("showing 2");
    expect(listBlock.content).toContain("10 more resource(s) hidden");
    expect(listBlock.content).toContain("offset:2");
    expect(listBlock.content).toContain("verbose:true");

    const readBlock = readMcpResourceTool.mapToolResultToToolResultBlockParam({
      contents: [{
        uri: "file:///resource.md",
        mimeType: "text/markdown",
        text: "content ".repeat(2_000),
        totalChars: 16_000,
      }],
      limit: 4_000,
      offset: 0,
    }, "mcp-read");

    expect(readBlock.content).toContain("content chars: 16000");
    expect(readBlock.content).toContain("next offset:4000");
    expect(readBlock.content).toContain("offset:4000");
    expect(readBlock.content.length).toBeLessThan(4_700);
  });

  it("ListMcpResourcesTool still accepts omitted input", async () => {
    const result = await listMcpResourcesTool.call(undefined as any, {} as any);
    expect(result.data.resources).toEqual([]);
    expect(result.data.totalCount).toBe(0);
    expect(result.data.offset).toBe(0);
  });

  it("caps ToolSearch exact selection output", async () => {
    resetRegistry();
    setDeferredToolSchemas(Array.from({ length: 12 }, (_, i) => ({
      name: `Tool${i}`,
      description: `Deferred tool ${i}`,
      inputSchema: { type: "object", properties: { value: { type: "string" } } },
    })));

    const result = await toolSearchTool.call({
      query: Array.from({ length: 12 }, (_, i) => `Tool${i}`).join(",").replace(/^/, "select:"),
      max_results: 5,
    } as any, {} as any);
    const block = toolSearchTool.mapToolResultToToolResultBlockParam(result.data, "tool-search");

    expect(result.data.matchedSchemas).toHaveLength(5);
    expect(block.content).toContain("7 selected schema(s) omitted by the cap");
    expect(block.content).toContain("Tool4");
    expect(block.content).not.toContain("Tool5");
  });
});
