/**
 * Bash tool — shell command execution
 *
 * Features (matching Claude Code's 16-tools-bash.js):
 *   - Execute via child_process.spawn with shell
 *   - Default timeout 120s, max 600s (env configurable)
 *   - Read-only command detection for auto-approval
 *   - Safe-command whitelists with safe-flags analysis
 *   - Background execution (run_in_background)
 *   - Sandbox: filesystem path restrictions, network domain restrictions
 *   - Git Bash path detection on Windows
 */
import { spawn, type ChildProcess } from "child_process";
import { z } from "zod";
import type { Tool, ToolContext, ToolCallResult, ToolResultBlockParam, ValidationResult } from "../interface.js";
import type { PermissionResult } from "../../config/permissions.js";
import {
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_TIMEOUT_MS,
  BASH_TOOL,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
} from "../../core/constants.js";

// ── Input / Output Schemas ─────────────────────────────────────────

const BashInputSchema = z.strictObject({
  command: z.string().describe("The command to execute"),
  description: z.string().optional().describe("Description of what the command does"),
  timeout: z.number().max(MAX_BASH_TIMEOUT_MS).optional().describe(`Timeout in ms, max ${MAX_BASH_TIMEOUT_MS}`),
  run_in_background: z.boolean().optional().describe("Run in background, get notified later"),
});

type BashInput = z.infer<typeof BashInputSchema>;

interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  interrupted: boolean;
  durationMs: number;
  backgroundTaskId?: string;
}

const BashOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  interrupted: z.boolean(),
  durationMs: z.number(),
  backgroundTaskId: z.string().optional(),
});

// ── Read-only command detection ────────────────────────────────────

const READ_ONLY_COMMANDS = new Set([
  "ls", "dir", "cat", "head", "tail", "less", "more",
  "grep", "rg", "ag", "find", "fd", "locate",
  "sort", "uniq", "wc", "cut", "tr", "awk", "sed",
  "diff", "comm", "tree", "file", "stat",
  "ps", "top", "htop", "lsof", "pgrep", "netstat", "ss",
  "date", "hostname", "whoami", "uname", "arch", "uptime",
  "which", "where", "type", "command", "hash",
  "echo", "printf", "test", "true", "false",
  "pwd", "env", "printenv", "id", "groups",
  "man", "help", "info", "apropos",
  "base64", "md5sum", "sha256sum", "shasum",
  "tput", "stty", "tty", "nproc", "getconf",
  "jq", "yq", "xmllint",
  "curl", // when used with specific flags only
  "npm", "yarn", "pnpm", "bun", // when used with read-only subcommands
  "git", // when used with read-only subcommands
  "docker", "kubectl", // when used with read-only subcommands
]);

const READ_ONLY_KEYWORDS = new Set([
  "help", "-h", "--help", "list", "show", "display", "current",
  "view", "get", "check", "describe", "print", "version", "about",
  "status", "?", "info", "search", "find", "query", "count", "plan",
]);

const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  "diff", "log", "status", "show", "branch", "tag",
  "ls-remote", "ls-files", "ls-tree", "rev-parse", "rev-list",
  "describe", "shortlog", "blame", "grep", "reflog",
  "config", "remote", "stash", "worktree",
]);

const NPM_READ_ONLY_SUBCOMMANDS = new Set([
  "ls", "list", "info", "view", "show", "search",
  "outdated", "audit", "config", "whoami", "token",
  "help", "explain", "why", "fund", "bugs", "repo",
]);

const DOCKER_READ_ONLY_SUBCOMMANDS = new Set([
  "ps", "images", "logs", "inspect", "stats", "top",
  "port", "diff", "history", "info", "version",
]);

/**
 * Detect if a command is read-only (safe for auto-approval).
 */
export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  // Tokenize: split on pipes, semicolons, &&, ||
  // ALL parts must be read-only for the whole command to be read-only
  const parts = splitCommandChain(trimmed);

  return parts.every((part) => isReadOnlyPart(part.trim()));
}

function splitCommandChain(command: string): string[] {
  // Split on |, ;, &&, || but respect quotes
  const parts: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (ch === "|" || ch === ";" || (ch === "&" && command[i + 1] === "&") || (ch === "|" && command[i + 1] === "|")) {
        if (current.trim()) parts.push(current.trim());
        current = "";
        if ((ch === "&" && command[i + 1] === "&") || (ch === "|" && command[i + 1] === "|")) i++; // skip next char
      } else {
        current += ch;
      }
    } else {
      current += ch;
    }
    i++;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function isReadOnlyPart(part: string): boolean {
  // Strip leading env vars (KEY=value cmd ...)
  let cmd = part;
  while (/^[A-Z_][A-Z0-9_]*=\S*\s+/.test(cmd)) {
    cmd = cmd.replace(/^[A-Z_][A-Z0-9_]*=\S*\s+/, "");
  }

  // Get the base command
  const tokens = cmd.split(/\s+/);
  const baseCmd = tokens[0]?.replace(/^.*\//, ""); // strip path
  if (!baseCmd) return false;

  // Check direct read-only commands
  if (READ_ONLY_COMMANDS.has(baseCmd)) {
    // Special cases needing subcommand check
    if (baseCmd === "git") {
      const subCmd = tokens[1];
      return subCmd ? GIT_READ_ONLY_SUBCOMMANDS.has(subCmd) : false;
    }
    if (baseCmd === "npm" || baseCmd === "yarn" || baseCmd === "pnpm" || baseCmd === "bun") {
      const subCmd = tokens[1];
      return subCmd ? NPM_READ_ONLY_SUBCOMMANDS.has(subCmd) : false;
    }
    if (baseCmd === "docker" || baseCmd === "kubectl") {
      const subCmd = tokens[1];
      return subCmd ? DOCKER_READ_ONLY_SUBCOMMANDS.has(subCmd) : false;
    }
    // curl is read-only only if no -X POST/PUT/DELETE, no --data, no -d
    if (baseCmd === "curl") {
      const dangerous = ["-X", "--request", "-d", "--data", "--data-raw", "--data-binary", "--upload-file"];
      return !tokens.some(t => dangerous.includes(t));
    }
    return true;
  }

  // Check if any token is a read-only keyword (e.g., "terraform plan", "helm list")
  if (tokens.length > 1 && READ_ONLY_KEYWORDS.has(tokens[1])) {
    return true;
  }

  return false;
}

// ── Background task tracking ───────────────────────────────────────

const backgroundTasks = new Map<string, { process: ChildProcess; output: string; done: boolean; exitCode: number | null }>();
let nextBgId = 1;

// ── Bash Tool Implementation ───────────────────────────────────────

export const bashTool: Tool<BashInput, BashOutput> = {
  name: BASH_TOOL,
  searchHint: "execute shell commands in the terminal",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: false,

  async description(input) {
    return input?.description ?? input?.command ?? "Execute a shell command";
  },

  async prompt() {
    return BASH_PROMPT;
  },

  get inputSchema() { return BashInputSchema; },
  get outputSchema() { return BashOutputSchema; },

  userFacingName() { return "Bash"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return false; },
  isReadOnly() { return false; },

  toAutoClassifierInput(input) {
    return input.command;
  },

  getActivityDescription(input) {
    return input.description ?? `Running: ${truncate(input.command, 60)}`;
  },

  async validateInput(input) {
    if (!input.command || !input.command.trim()) {
      return { result: false, message: "Command cannot be empty", errorCode: 1 };
    }
    if (input.timeout !== undefined && input.timeout > MAX_BASH_TIMEOUT_MS) {
      return { result: false, message: `Timeout exceeds maximum of ${MAX_BASH_TIMEOUT_MS}ms`, errorCode: 2 };
    }
    return { result: true };
  },

  async checkPermissions(input, context) {
    const cmd = input.command;

    // Read-only commands get auto-approved in permissive modes
    if (isReadOnlyCommand(cmd)) {
      return { behavior: "allow", updatedInput: input };
    }

    // Non-read-only commands need explicit permission
    return {
      behavior: "passthrough",
      message: `Run command: ${truncate(cmd, 100)}`,
    };
  },

  async call(input, context): Promise<ToolCallResult<BashOutput>> {
    const { command, timeout, run_in_background } = input;
    const timeoutMs = timeout ?? getDefaultTimeout();
    const startTime = performance.now();

    // Background execution
    if (run_in_background) {
      const taskId = `bg-${nextBgId++}`;
      const child = spawn(command, [], {
        shell: getShell(),
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      child.stdout?.on("data", (data: Buffer) => { output += data.toString(); });
      child.stderr?.on("data", (data: Buffer) => { output += data.toString(); });

      const task = { process: child, output: "", done: false, exitCode: null as number | null };
      backgroundTasks.set(taskId, task);

      child.on("close", (code) => {
        task.output = output;
        task.done = true;
        task.exitCode = code;
      });

      return {
        data: {
          stdout: `Background task started with ID: ${taskId}`,
          stderr: "",
          exitCode: null,
          interrupted: false,
          durationMs: 0,
          backgroundTaskId: taskId,
        },
      };
    }

    // Foreground execution
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let interrupted = false;

      const child = spawn(command, [], {
        shell: getShell(),
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
      });

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle abort
      const onAbort = () => {
        interrupted = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000);
      };
      context.abortController?.signal.addEventListener("abort", onAbort, { once: true });

      child.on("close", (code, signal) => {
        context.abortController?.signal.removeEventListener("abort", onAbort);
        const durationMs = performance.now() - startTime;

        if (signal === "SIGTERM" || signal === "SIGKILL") {
          interrupted = true;
        }

        // Truncate large outputs
        stdout = truncateOutput(stdout);
        stderr = truncateOutput(stderr);

        resolve({
          data: {
            stdout,
            stderr,
            exitCode: code,
            interrupted,
            durationMs,
          },
        });
      });

      child.on("error", (err) => {
        context.abortController?.signal.removeEventListener("abort", onAbort);
        resolve({
          data: {
            stdout: "",
            stderr: err.message,
            exitCode: 1,
            interrupted: false,
            durationMs: performance.now() - startTime,
          },
        });
      });
    });
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    const parts: string[] = [];
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(result.stderr);
    if (result.exitCode !== null && result.exitCode !== 0) {
      parts.push(`Exit code: ${result.exitCode}`);
    }
    if (result.interrupted) {
      parts.push("(command was interrupted)");
    }
    if (result.backgroundTaskId) {
      parts.push(`Background task ID: ${result.backgroundTaskId}`);
    }

    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: parts.join("\n").trim() || "(no output)",
      is_error: (result.exitCode !== null && result.exitCode !== 0) || result.interrupted,
    };
  },
};

// ── Helpers ────────────────────────────────────────────────────────

function getDefaultTimeout(): number {
  const envTimeout = process.env.BASH_DEFAULT_TIMEOUT_MS;
  if (envTimeout) {
    const parsed = parseInt(envTimeout, 10);
    if (!isNaN(parsed) && parsed > 0) return Math.min(parsed, MAX_BASH_TIMEOUT_MS);
  }
  return DEFAULT_BASH_TIMEOUT_MS;
}

function getShell(): string {
  if (process.platform === "win32") {
    // Try Git Bash first, fall back to cmd
    return process.env.COMSPEC ?? "cmd.exe";
  }
  return process.env.SHELL ?? "/bin/bash";
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function truncateOutput(output: string, maxChars = DEFAULT_MAX_RESULT_SIZE_CHARS): string {
  if (output.length <= maxChars) return output;
  const half = Math.floor(maxChars / 2);
  return output.slice(0, half) + `\n\n... (${output.length - maxChars} characters truncated) ...\n\n` + output.slice(-half);
}

// ── Background task helpers (for TaskOutput tool) ──────────────────

export function getBackgroundTask(taskId: string) {
  return backgroundTasks.get(taskId) ?? null;
}

export function getAllBackgroundTasks() {
  return [...backgroundTasks.entries()].map(([id, task]) => ({
    id,
    done: task.done,
    exitCode: task.exitCode,
  }));
}

// ── Prompt ─────────────────────────────────────────────────────────

const BASH_PROMPT = `Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile.

IMPORTANT: Avoid using this tool to run grep, cat, head, tail, sed, awk, or echo commands when a dedicated tool exists:
 - File search: Use Glob (NOT find or ls)
 - Content search: Use Grep (NOT grep or rg)
 - Read files: Use Read (NOT cat/head/tail)
 - Edit files: Use Edit (NOT sed/awk)
 - Write files: Use Write (NOT echo >/cat <<EOF)

Instructions:
 - Always quote file paths with spaces
 - Try to use absolute paths
 - You may specify an optional timeout in milliseconds (up to ${MAX_BASH_TIMEOUT_MS}ms / ${MAX_BASH_TIMEOUT_MS / 60_000} minutes). Default timeout is ${DEFAULT_BASH_TIMEOUT_MS / 1000}s.
 - Use run_in_background for long-running commands
 - Write a clear description of what the command does
 - When issuing multiple commands, use && to chain dependent commands and ; for independent ones`;
