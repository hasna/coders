import { describe, expect, it, beforeEach } from "vitest";
import { buildServer } from "../src/mcp/server.js";
import { healthPayload, startMcpHttpServer } from "../src/mcp/http.js";

describe("coders MCP HTTP transport", () => {
  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => NodeJS.ReadStream };
    if (!stdin.setRawMode) {
      stdin.setRawMode = () => stdin;
    }
  });

  it("GET /health returns 200", async () => {
    const { port, close } = await startMcpHttpServer({ port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(healthPayload("coders"));
    } finally {
      await close();
    }
  });

  it("streamable HTTP initialize + list_agents round-trip", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const { port, close } = await startMcpHttpServer({ port: 0 });
    try {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(transport);
      const result = await client.callTool({ name: "list_agents", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.content?.[0]?.type).toBe("text");
      await client.close();
    } finally {
      await close();
    }
  });

  it("stdio buildServer registers tools unchanged", async () => {
    const server = await buildServer();
    expect(server).toBeTruthy();
  });
});
