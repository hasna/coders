import { describe, it, expect, vi } from "vitest";
import {
  runAgentLoop,
  type ToolHandler,
  type AgentLoopOptions,
  type ToolResult,
} from "../src/core/agent-loop.js";
import { createDefaultPermissionContext } from "../src/config/permissions.js";

// Mock tool that returns a simple result
function createMockTool(name: string, result: unknown, opts?: Partial<ToolHandler>): ToolHandler {
  return {
    name,
    description: `Mock ${name} tool`,
    inputSchema: { type: "object", properties: {} },
    isReadOnly: true,
    isConcurrencySafe: true,
    call: vi.fn().mockResolvedValue({ data: result } satisfies ToolResult),
    ...opts,
  };
}

describe("agent-loop", () => {
  it("exports runAgentLoop function", () => {
    expect(typeof runAgentLoop).toBe("function");
  });

  it("tool handler interface shape is correct", () => {
    const tool = createMockTool("TestTool", "hello");
    expect(tool.name).toBe("TestTool");
    expect(tool.isReadOnly).toBe(true);
    expect(tool.isConcurrencySafe).toBe(true);
    expect(typeof tool.call).toBe("function");
  });

  it("createDefaultPermissionContext works with agent loop options", () => {
    const ctx = createDefaultPermissionContext();
    const options: Partial<AgentLoopOptions> = {
      permissionContext: ctx,
      model: "sonnet46",
      systemPrompt: "You are a helpful assistant",
      tools: [createMockTool("Read", "file contents")],
      thinkingConfig: { type: "disabled" },
    };
    expect(options.permissionContext!.mode).toBe("default");
    expect(options.tools!.length).toBe(1);
  });

  it("tool call returns correct shape", async () => {
    const tool = createMockTool("Bash", { stdout: "hello", code: 0 });
    const result = await tool.call({ command: "echo hello" }, {
      toolUseId: "test-123",
      agentId: undefined,
    });
    expect(result.data).toEqual({ stdout: "hello", code: 0 });
    expect(result.isError).toBeUndefined();
  });

  it("tool validation can reject invalid input", async () => {
    const tool = createMockTool("Edit", "ok", {
      validateInput: vi.fn().mockResolvedValue({
        result: false,
        message: "old_string not found in file",
        errorCode: 1,
      }),
    });
    const validation = await tool.validateInput!({ file_path: "/tmp/test" });
    expect(validation.result).toBe(false);
    expect(validation.message).toContain("old_string not found");
  });

  it("concurrent tools are identified correctly", () => {
    const readTool = createMockTool("Read", "data", { isConcurrencySafe: true });
    const bashTool = createMockTool("Bash", "data", { isConcurrencySafe: false });
    expect(readTool.isConcurrencySafe).toBe(true);
    expect(bashTool.isConcurrencySafe).toBe(false);
  });
});
