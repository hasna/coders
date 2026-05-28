#!/usr/bin/env bun
import { parseHttpArgv, resolveMcpHttpPort } from "./http.js";

async function main() {
  const { http, port } = parseHttpArgv();
  if (http) {
    const { runMcpHttpServer } = await import("./http.js");
    await runMcpHttpServer({ port: resolveMcpHttpPort(port) });
    return;
  }
  const { runMcpServer } = await import("./server.js");
  await runMcpServer();
}

main().catch((err) => {
  console.error("coders-mcp failed to start:", err);
  process.exit(1);
});
