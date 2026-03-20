import { describe, it, expect } from "vitest";
import { createMcpServer } from "../src/mcp/server.js";
import {
  getConnectedServers,
  isServerConnected,
  type McpServerConfig,
} from "../src/mcp/client.js";
import { loadMcpConfigs } from "../src/mcp/config.js";

describe("MCP Server", () => {
  it("creates server instance", async () => {
    const server = await createMcpServer({ debug: false });
    expect(server).toBeTruthy();
  });
});

describe("MCP Client", () => {
  it("starts with no connected servers", () => {
    expect(getConnectedServers()).toEqual([]);
  });

  it("reports server not connected", () => {
    expect(isServerConnected("nonexistent")).toBe(false);
  });

  it("McpServerConfig shape is correct", () => {
    const config: McpServerConfig = {
      name: "test-server",
      command: "node",
      args: ["server.js"],
      transport: "stdio",
    };
    expect(config.name).toBe("test-server");
    expect(config.transport).toBe("stdio");
  });

  it("SSE config has url", () => {
    const config: McpServerConfig = {
      name: "sse-server",
      url: "http://localhost:3000/sse",
      transport: "sse",
    };
    expect(config.url).toContain("http");
  });
});

describe("MCP Config", () => {
  it("loads configs without error", () => {
    const configs = loadMcpConfigs();
    expect(Array.isArray(configs)).toBe(true);
  });

  it("loads configs with project root", () => {
    const configs = loadMcpConfigs("/tmp/nonexistent-project");
    expect(Array.isArray(configs)).toBe(true);
  });
});
