import { build } from "esbuild";
import { writeFileSync, readFileSync, chmodSync } from "fs";

await build({
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/cli.mjs",
  sourcemap: true,
  minify: process.env.NODE_ENV === "production",
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
  external: [
    // Node built-ins
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
    // Native modules that can't be bundled
    "better-sqlite3",
    "sharp",
    "tree-sitter",
    "yoga-wasm-web",
    "bun:sqlite",
    // Optional @hasna/* packages — resolved at runtime
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
    "process.env.CODERS_VERSION": '"0.0.15"',
    "process.env.CODERS_BUILD_TIME": `"${new Date().toISOString()}"`,
  },
  logLevel: "info",
});

// Create cli.js wrapper with shebang that imports the bundle
const shebangWrapper = `#!/usr/bin/env node
import "./cli.mjs";
`;
writeFileSync("dist/cli.js", shebangWrapper);
chmodSync("dist/cli.js", 0o755);
chmodSync("dist/cli.mjs", 0o644);
