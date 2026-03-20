import { describe, it, expect } from "vitest";
import { agentTool, BUILTIN_AGENT_TYPES, getAllRunningAgents } from "../src/tools/builtin/agent.js";

describe("Agent tool", () => {
  it("has correct name", () => expect(agentTool.name).toBe("Agent"));
  it("is not read-only", () => expect(agentTool.isReadOnly()).toBe(false));
  it("is concurrency-safe", () => expect(agentTool.isConcurrencySafe()).toBe(true));

  it("validates empty prompt", async () => {
    const r = await agentTool.validateInput({ prompt: "" });
    expect(r.result).toBe(false);
  });

  it("validates good prompt", async () => {
    const r = await agentTool.validateInput({ prompt: "Search for all API endpoints" });
    expect(r.result).toBe(true);
  });

  it("has 4 built-in agent types", () => {
    expect(Object.keys(BUILTIN_AGENT_TYPES)).toEqual([
      "general-purpose", "Explore", "Plan", "verification",
    ]);
  });

  it("general-purpose has all tools", () => {
    expect(BUILTIN_AGENT_TYPES["general-purpose"].allowedTools).toBe("all");
  });

  it("Explore excludes write tools", () => {
    const explore = BUILTIN_AGENT_TYPES["Explore"];
    expect(explore.excludedTools).toContain("Edit");
    expect(explore.excludedTools).toContain("Write");
    expect(explore.excludedTools).toContain("Agent");
  });

  it("Plan excludes write tools but includes search", () => {
    const plan = BUILTIN_AGENT_TYPES["Plan"];
    expect(plan.excludedTools).toContain("Edit");
    expect(plan.allowedTools).toContain("WebFetch");
    expect(plan.allowedTools).toContain("WebSearch");
  });

  it("tracks running agents", () => {
    const agents = getAllRunningAgents();
    expect(Array.isArray(agents)).toBe(true);
  });

  it("maps background result correctly", () => {
    const block = agentTool.mapToolResultToToolResultBlockParam(
      {
        result: "done",
        agentId: "agent-1",
        agentType: "Explore",
        model: "sonnet",
        totalTurns: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        backgrounded: true,
      },
      "tool-1",
    );
    expect(block.content).toContain("background");
    expect(block.content).toContain("agent-1");
  });

  it("maps foreground result correctly", () => {
    const block = agentTool.mapToolResultToToolResultBlockParam(
      {
        result: "Found 5 API endpoints in src/api/",
        agentId: "agent-2",
        agentType: "Explore",
        model: "sonnet",
        totalTurns: 3,
        usage: { inputTokens: 1000, outputTokens: 500 },
      },
      "tool-2",
    );
    expect(block.content).toContain("Found 5 API endpoints");
  });
});
