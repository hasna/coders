#!/usr/bin/env node
/**
 * @hasna/coders — CLI entry point
 *
 * Bootstrap flow (matching Claude Code's wTz -> ATz -> KTz):
 *   bootstrap() -> main() -> run() (Commander.js)
 *
 * Fast-paths skip the full import chain for instant responses:
 *   --version, --chrome-native-host
 */

export const VERSION = "0.1.2";
export const BUILD_TIME = process.env.CODERS_BUILD_TIME ?? new Date().toISOString();
export const PACKAGE_NAME = "@hasna/coders";
export const ISSUES_URL = "https://github.com/hasnaxyz/open-coders/issues";

// ── Startup profiling ──────────────────────────────────────────────

const startupTimestamps: Record<string, number> = {};

export function profileCheckpoint(label: string): void {
  startupTimestamps[label] = performance.now();
}

export function getStartupProfile(): Record<string, number> {
  return { ...startupTimestamps };
}

profileCheckpoint("cli_entry");

// ── Working directory ──────────────────────────────────────────────

let originalCwd: string = process.cwd();

export function getOriginalCwd(): string {
  return originalCwd;
}

export function setOriginalCwd(cwd: string): void {
  originalCwd = cwd;
}

// ── Signal handling ────────────────────────────────────────────────

const RESET_TERMINAL = "\x1b[0m\x1b[?25h\x1b[?1049l"; // reset style, show cursor, exit alt screen
let cleanupHandlers: Array<() => void | Promise<void>> = [];

export function registerCleanupHandler(handler: () => void | Promise<void>): void {
  cleanupHandlers.push(handler);
}

async function runCleanup(): Promise<void> {
  for (const handler of cleanupHandlers) {
    try {
      await handler();
    } catch {
      // swallow cleanup errors
    }
  }
  cleanupHandlers = [];
}

function setupSignalHandlers(): void {
  // SIGINT (ctrl+c) — graceful shutdown
  process.on("SIGINT", async () => {
    await runCleanup();
    // Reset terminal in case we were in raw mode
    if (process.stderr.isTTY) process.stderr.write(RESET_TERMINAL);
    else if (process.stdout.isTTY) process.stdout.write(RESET_TERMINAL);
    process.exit(130); // 128 + SIGINT(2)
  });

  // SIGTERM — graceful shutdown
  process.on("SIGTERM", async () => {
    await runCleanup();
    process.exit(143); // 128 + SIGTERM(15)
  });

  // SIGHUP — terminal closed
  process.on("SIGHUP", async () => {
    await runCleanup();
    process.exit(129); // 128 + SIGHUP(1)
  });

  // Uncaught exceptions — log and exit
  process.on("uncaughtException", (err) => {
    console.error("[coders] Uncaught exception:", err);
    process.exit(1);
  });

  // Unhandled rejections — log and exit
  process.on("unhandledRejection", (reason) => {
    console.error("[coders] Unhandled rejection:", reason);
    process.exit(1);
  });
}

// ── Early input capture ────────────────────────────────────────────
// Capture stdin input that arrives before the UI is ready

let earlyInput: Buffer[] = [];
let earlyInputCapturing = false;

export function startCapturingEarlyInput(): void {
  if (earlyInputCapturing || !process.stdin.readable) return;
  earlyInputCapturing = true;
  process.stdin.on("data", onEarlyInput);
}

export function stopCapturingEarlyInput(): Buffer[] {
  if (!earlyInputCapturing) return [];
  earlyInputCapturing = false;
  process.stdin.removeListener("data", onEarlyInput);
  const captured = earlyInput;
  earlyInput = [];
  return captured;
}

function onEarlyInput(chunk: Buffer): void {
  earlyInput.push(chunk);
}

// ── Bootstrap ──────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  const args = process.argv.slice(2);
  profileCheckpoint("cli_args_parsed");

  // Fast-path: --version (no imports needed)
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v" || args[0] === "-V")) {
    console.log(`${VERSION} (Coders)`);
    return;
  }

  // Fast-path: --update / --upgrade (redirect to subcommand)
  if (args.length === 1 && (args[0] === "--update" || args[0] === "--upgrade")) {
    process.argv = [process.argv[0], process.argv[1], "update"];
  }

  // Set up signal handlers early
  setupSignalHandlers();

  // Start capturing early input before UI is ready
  startCapturingEarlyInput();
  profileCheckpoint("cli_before_main_import");

  // Disable corepack auto-pin (can interfere with child processes)
  process.env.COREPACK_ENABLE_AUTO_PIN = "0";

  // Increase memory for remote sessions
  if (process.env.CODERS_REMOTE === "true") {
    const nodeOpts = process.env.NODE_OPTIONS || "";
    process.env.NODE_OPTIONS = nodeOpts
      ? `${nodeOpts} --max-old-space-size=8192`
      : "--max-old-space-size=8192";
  }

  // Import and run main
  const { main } = await import("./main.js");
  profileCheckpoint("cli_after_main_import");

  await main();
  profileCheckpoint("cli_after_main_complete");
}

bootstrap().catch((err) => {
  console.error(`[coders] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  if (process.env.CODERS_DEBUG === "true" && err instanceof Error) {
    console.error(err.stack);
  }
  process.exit(1);
});
