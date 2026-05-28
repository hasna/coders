import { build } from "esbuild";
import { writeFileSync, chmodSync } from "fs";

const shared = {
  bundle: true,
  platform: "node" as const,
  target: "node18",
  format: "esm" as const,
  sourcemap: true,
  minify: process.env.NODE_ENV === "production",
  external: [
    "node:*",
    "fs",
    "path",
    "os",
    "crypto",
    "child_process",
    "http",
    "https",
    "http2",
    "net",
    "tls",
    "url",
    "util",
    "stream",
    "events",
    "readline",
    "zlib",
    "assert",
    "buffer",
    "string_decoder",
    "tty",
    "worker_threads",
    "better-sqlite3",
    "sharp",
    "tree-sitter",
    "yoga-wasm-web",
    "bun:sqlite",
    "@hasna/todos",
    "@hasna/conversations",
    "@hasna/connectors",
    "@hasna/mementos",
    "@hasna/sessions",
    "@hasna/skills",
    "@hasna/configs",
    "@hasna/prompts",
    "@hasna/recordings",
    "@hasna/sandboxes",
    "@hasna/economy",
    "@hasna/wallets",
    "@hasna/brains",
    "@hasna/attachments",
  ],
  define: {
    "process.env.CODERS_VERSION": '"0.1.2"',
    "process.env.CODERS_BUILD_TIME": `"${new Date().toISOString()}"`,
  },
  logLevel: "info" as const,
};

await build({
  ...shared,
  entryPoints: ["src/cli/index.ts"],
  outfile: "dist/cli.mjs",
});

await build({
  ...shared,
  entryPoints: ["src/mcp/bin.ts"],
  outfile: "dist/coders-mcp.mjs",
});

writeFileSync("dist/cli.js", `#!/usr/bin/env bun
import "./cli.mjs";
`);
writeFileSync("dist/coders-mcp.js", `#!/usr/bin/env node
import "./coders-mcp.mjs";
`);
chmodSync("dist/cli.js", 0o755);
chmodSync("dist/cli.mjs", 0o644);
chmodSync("dist/coders-mcp.js", 0o755);
chmodSync("dist/coders-mcp.mjs", 0o644);
