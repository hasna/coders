/**
 * Web dashboard server — lightweight HTTP server for open-coders management UI
 *
 * Zero dependencies — uses Node built-in http module.
 * Serves REST API endpoints + static HTML dashboard.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createHash } from "crypto";
import type { Socket } from "net";
import { dashboardEvents } from "./events.js";
import { getAllSlashCommands, getTopCommands } from "../core/slash-commands.js";
import { MODEL_REGISTRY } from "../api/models.js";
import { getSettings, saveUserSettings } from "../config/loader.js";
import { loadMcpConfigsWithScope } from "../mcp/config.js";
import { discoverPlugins } from "../plugins/loader.js";
import { getAvailableThemes } from "../ui/themes.js";
import { dbAll, dbGet } from "../db/index.js";
import { dashboardHTML } from "./dashboard.js";

interface RouteHandler {
  method: string;
  path: string;
  handler: (req: IncomingMessage, body: string) => Promise<unknown> | unknown;
}

const routes: RouteHandler[] = [];

function route(method: string, path: string, handler: RouteHandler["handler"]) {
  routes.push({ method, path, handler });
}

// ── API Routes ────────────────────────────────────────────────────

route("GET", "/api/commands", () => {
  const commands = getAllSlashCommands();
  const top = getTopCommands(5).map((c) => c.name);
  return {
    commands: commands.map((c) => ({
      name: c.name,
      aliases: c.aliases,
      category: c.category,
      description: c.description,
    })),
    topCommands: top,
    total: commands.length,
  };
});

route("GET", "/api/models", () => {
  return {
    models: Object.entries(MODEL_REGISTRY).map(([key, entry]) => ({
      key,
      alias: entry.alias,
      firstParty: entry.variants.firstParty,
      bedrock: entry.variants.bedrock,
      vertex: entry.variants.vertex,
      xai: entry.variants.xai,
      gemini: entry.variants.gemini,
      contextWindow: entry.contextWindow,
      maxOutput: entry.maxOutput,
      supportsThinking: entry.supportsThinking,
      supportsVision: entry.supportsVision,
    })),
    total: Object.keys(MODEL_REGISTRY).length,
  };
});

route("GET", "/api/settings", () => {
  return getSettings();
});

route("POST", "/api/settings", (_req, body) => {
  const updates = JSON.parse(body);
  saveUserSettings(updates);
  return { ok: true, settings: getSettings() };
});

route("GET", "/api/mcp", () => {
  const configs = loadMcpConfigsWithScope(process.cwd());
  return {
    servers: configs.map((c) => ({
      name: c.name,
      scope: (c as any).scope,
      transport: c.transport,
      command: c.command,
      args: c.args,
      url: c.url,
    })),
    total: configs.length,
  };
});

route("GET", "/api/plugins", () => {
  const plugins = discoverPlugins();
  return {
    plugins: plugins.map((p) => ({
      name: p.name,
      version: p.version,
      enabled: p.enabled,
      source: p.source,
    })),
    total: plugins.length,
  };
});

route("GET", "/api/themes", () => {
  return { themes: getAvailableThemes() };
});

route("GET", "/api/sessions", () => {
  try {
    const sessions = dbAll<any>(
      `SELECT s.id, s.model, s.created_at, s.project_dir,
              COUNT(m.id) AS msg_count,
              COALESCE(SUM(m.tokens_in), 0) AS tokens_in,
              COALESCE(SUM(m.tokens_out), 0) AS tokens_out,
              COALESCE(SUM(m.cost_usd), 0) AS cost
       FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
       GROUP BY s.id ORDER BY s.created_at DESC LIMIT 50`,
    );
    return { sessions, total: sessions.length };
  } catch {
    return { sessions: [], total: 0 };
  }
});

route("GET", "/api/sessions/:id", (_req, _body) => {
  // Extract ID from URL — handled in the router
  return { error: "Use /api/sessions/:id path" };
});

route("GET", "/api/checkpoints", () => {
  try {
    const checkpoints = dbAll<any>(
      `SELECT id, file_path, edit_operation, created_at FROM checkpoints ORDER BY created_at DESC LIMIT 50`,
    );
    return {
      checkpoints: checkpoints.map((cp: any) => {
        let op = null;
        try { op = cp.edit_operation ? JSON.parse(cp.edit_operation) : null; } catch { /* skip */ }
        return {
          id: cp.id,
          filePath: cp.file_path,
          operation: op?.old_string ? `"${cp_truncate(op.old_string, 40)}" → "${cp_truncate(op.new_string, 40)}"` : op?.type ?? "unknown",
          createdAt: cp.created_at,
        };
      }),
      total: checkpoints.length,
    };
  } catch {
    return { checkpoints: [], total: 0 };
  }
});

route("GET", "/api/cost", () => {
  try {
    const row = dbGet<any>(
      `SELECT COALESCE(SUM(tokens_in), 0) AS total_in,
              COALESCE(SUM(tokens_out), 0) AS total_out,
              COALESCE(SUM(cost_usd), 0) AS total_cost,
              COUNT(DISTINCT session_id) AS session_count
       FROM messages`,
    );
    // Per-model breakdown
    const byModel = dbAll<any>(
      `SELECT s.model, COUNT(m.id) AS msg_count,
              COALESCE(SUM(m.tokens_in), 0) AS tokens_in,
              COALESCE(SUM(m.tokens_out), 0) AS tokens_out,
              COALESCE(SUM(m.cost_usd), 0) AS cost
       FROM messages m JOIN sessions s ON s.id = m.session_id
       GROUP BY s.model ORDER BY cost DESC`,
    );
    return {
      totalIn: row?.total_in ?? 0,
      totalOut: row?.total_out ?? 0,
      totalCost: row?.total_cost ?? 0,
      sessionCount: row?.session_count ?? 0,
      byModel,
    };
  } catch {
    return { totalIn: 0, totalOut: 0, totalCost: 0, sessionCount: 0, byModel: [] };
  }
});

function cp_truncate(s: string, max: number): string {
  if (!s) return "";
  const oneLine = s.replace(/\n/g, "\\n");
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

// ── Server ────────────────────────────────────────────────────────

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => resolve(data));
  });
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res: ServerResponse, html: string) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method?.toUpperCase() ?? "GET";
  const path = url.pathname;

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // Dynamic session route
  if (method === "GET" && path.startsWith("/api/sessions/") && path.split("/").length === 4) {
    const sessionId = path.split("/")[3];
    try {
      const session = dbGet<any>(`SELECT * FROM sessions WHERE id = ?`, [sessionId]);
      const messages = dbAll<any>(
        `SELECT role, content, tokens_in, tokens_out, cost_usd, tool_uses, created_at FROM messages WHERE session_id = ? ORDER BY created_at`,
        [sessionId],
      );
      sendJson(res, { session, messages });
    } catch {
      sendJson(res, { error: "Session not found" }, 404);
    }
    return;
  }

  // API routes
  const body = method === "POST" || method === "PUT" ? await parseBody(req) : "";
  for (const r of routes) {
    if (r.method === method && r.path === path) {
      try {
        const result = await r.handler(req, body);
        sendJson(res, result);
      } catch (err) {
        sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }
  }

  // Dashboard HTML
  if (path === "/" || path === "/dashboard") {
    sendHtml(res, dashboardHTML());
    return;
  }

  // Terminal page
  if (path === "/terminal") {
    sendHtml(res, terminalPageHTML());
    return;
  }

  // 404
  sendJson(res, { error: "Not found" }, 404);
}

// ── Minimal WebSocket server (RFC 6455) ──────────────────────────

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-5AB964C80A2";

function handleUpgrade(req: IncomingMessage, socket: Socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key) { socket.destroy(); return; }

  const accept = createHash("sha1").update(key + WS_MAGIC).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    "\r\n",
  );

  function sendFrame(data: string) {
    const buf = Buffer.from(data, "utf-8");
    const len = buf.length;
    let header: Buffer;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // text frame, FIN
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    socket.write(Buffer.concat([header, buf]));
  }

  // Register client
  dashboardEvents.addClient(sendFrame);

  // Send initial connected event
  sendFrame(JSON.stringify({ type: "connected", data: { clients: dashboardEvents.clientCount }, timestamp: Date.now() }));

  socket.on("close", () => dashboardEvents.removeClient(sendFrame));
  socket.on("error", () => dashboardEvents.removeClient(sendFrame));

  // Handle incoming frames (for future: send messages to the agent)
  socket.on("data", (raw: Buffer) => {
    if (raw.length < 2) return;
    const opcode = raw[0] & 0x0f;
    if (opcode === 0x8) { // close
      dashboardEvents.removeClient(sendFrame);
      socket.end();
    }
    // Ignore other frames for now (ping/pong/text)
  });
}

function terminalPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>open-coders — live terminal</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0d1117; color: #e6edf3; font-family: 'SF Mono', Menlo, Monaco, monospace; font-size: 14px; }
    #terminal { padding: 16px; min-height: 100vh; white-space: pre-wrap; word-wrap: break-word; }
    .event { margin-bottom: 4px; }
    .event-message { color: #e6edf3; }
    .event-tool_start { color: #d29922; }
    .event-tool_end { color: #3fb950; }
    .event-thinking { color: #8b949e; font-style: italic; }
    .event-streaming { color: #e6edf3; }
    .event-status { color: #58a6ff; }
    .event-busy { color: #d29922; }
    .event-idle { color: #3fb950; }
    .event-connected { color: #58a6ff; font-weight: bold; }
    .timestamp { color: #484f58; font-size: 12px; }
    #status { position: fixed; bottom: 0; left: 0; right: 0; padding: 8px 16px;
      background: #161b22; border-top: 1px solid #21262d; display: flex; justify-content: space-between; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .dot-green { background: #3fb950; }
    .dot-yellow { background: #d29922; }
    .dot-red { background: #f85149; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <div id="status">
    <span><span class="dot dot-red" id="dot"></span><span id="conn-status">Connecting...</span></span>
    <span id="event-count">0 events</span>
  </div>
  <script>
    const term = document.getElementById('terminal');
    const dot = document.getElementById('dot');
    const connStatus = document.getElementById('conn-status');
    const eventCount = document.getElementById('event-count');
    let count = 0;

    function connect() {
      const ws = new WebSocket('ws://' + location.host + '/ws');
      ws.onopen = () => {
        dot.className = 'dot dot-green';
        connStatus.textContent = 'Connected';
      };
      ws.onclose = () => {
        dot.className = 'dot dot-red';
        connStatus.textContent = 'Disconnected — reconnecting...';
        setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        try {
          const evt = JSON.parse(e.data);
          count++;
          eventCount.textContent = count + ' events';
          const el = document.createElement('div');
          el.className = 'event event-' + evt.type;
          const ts = new Date(evt.timestamp).toLocaleTimeString();
          const data = typeof evt.data === 'string' ? evt.data : JSON.stringify(evt.data);
          el.innerHTML = '<span class="timestamp">' + ts + '</span> [' + evt.type + '] ' + data;
          term.appendChild(el);
          window.scrollTo(0, document.body.scrollHeight);
        } catch {}
      };
    }
    connect();
  </script>
</body>
</html>`;
}

export function startDashboard(port = 7077): void {
  const server = createServer(handleRequest);

  // WebSocket upgrade
  server.on("upgrade", (req: IncomingMessage, socket: Socket) => {
    if (req.url === "/ws") {
      handleUpgrade(req, socket);
    } else {
      socket.destroy();
    }
  });

  server.listen(port, () => {
    console.log(`\n  open-coders dashboard running at http://localhost:${port}\n`);
    console.log(`  API endpoints:`);
    console.log(`    GET  /api/commands     — slash commands`);
    console.log(`    GET  /api/models       — model registry`);
    console.log(`    GET  /api/settings     — current settings`);
    console.log(`    POST /api/settings     — update settings`);
    console.log(`    GET  /api/mcp          — MCP servers`);
    console.log(`    GET  /api/plugins      — installed plugins`);
    console.log(`    GET  /api/themes       — available themes`);
    console.log(`    GET  /api/sessions     — session history`);
    console.log(`    GET  /api/sessions/:id — session details`);
    console.log(`    GET  /api/checkpoints  — file checkpoints`);
    console.log(`    GET  /api/cost         — cost analytics`);
    console.log(`    WS   /ws              — live event stream`);
    console.log(`    GET  /terminal        — live terminal view`);
    console.log(``);
  });
}
