#!/usr/bin/env node
import { parseHttpArgv, resolveMcpHttpPort, runMcpHttpServer } from "./http.js";
import { runMcpServer } from "./server.js";

async function main() {
  const { http, port } = parseHttpArgv();
  if (http) {
    await runMcpHttpServer({ port: resolveMcpHttpPort(port) });
    return;
  }
  await runMcpServer();
}

main().catch((err) => {
  console.error("coders-mcp failed to start:", err);
  process.exit(1);
});
