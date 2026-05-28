import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export const DEFAULT_MCP_HTTP_PORT = 8805;
export const MCP_SERVICE_NAME = "coders";

async function defaultBuildServer(): Promise<Server> {
  const { buildServer } = await import("./server.js");
  return buildServer();
}

export function resolveMcpHttpPort(explicit?: number): number {
  if (explicit != null && !Number.isNaN(explicit)) return explicit;
  const env = process.env.MCP_HTTP_PORT;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return DEFAULT_MCP_HTTP_PORT;
}

export function isHttpMode(argv: string[] = process.argv): boolean {
  return argv.includes("--http") || process.env.MCP_HTTP === "1";
}

export function parseHttpArgv(argv: string[] = process.argv): { http: boolean; port?: number } {
  const http = isHttpMode(argv);
  let port: number | undefined;
  const portIdx = argv.indexOf("--port");
  if (portIdx !== -1 && argv[portIdx + 1]) {
    port = parseInt(argv[portIdx + 1]!, 10);
  }
  return { http, port };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

export async function handleStatelessMcpNode(
  req: IncomingMessage,
  res: ServerResponse,
  getServer: () => Server | Promise<Server> = defaultBuildServer,
): Promise<void> {
  const server = await getServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  const body = req.method === "POST" ? await readJsonBody(req) : undefined;
  await transport.handleRequest(req, res, body);
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
}

export function healthPayload(name: string = MCP_SERVICE_NAME): { status: string; name: string } {
  return { status: "ok", name };
}

export async function startMcpHttpServer(options: {
  port?: number;
  getServer?: () => Server | Promise<Server>;
  name?: string;
} = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const port = options.port ?? resolveMcpHttpPort();
  const host = "127.0.0.1";
  const getServer = options.getServer ?? defaultBuildServer;
  const name = options.name ?? MCP_SERVICE_NAME;

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(healthPayload(name)));
      return;
    }

    if (url.pathname === "/mcp") {
      await handleStatelessMcpNode(req, res, getServer);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  const address = httpServer.address();
  const boundPort = typeof address === "object" && address ? address.port : port;

  return {
    port: boundPort,
    close: () =>
      new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export async function runMcpHttpServer(options: { port?: number } = {}): Promise<void> {
  const { port } = await startMcpHttpServer(options);
  console.error(`coders-mcp listening on http://127.0.0.1:${port}/mcp`);
  await new Promise<void>(() => {});
}
