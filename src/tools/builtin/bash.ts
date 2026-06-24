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
import { dbRun } from "../../db/index.js";
import {
  createTask as createBgTask,
  completeTask as completeBgTask,
  failTask as failBgTask,
  writeTaskOutput,
} from "../../core/background-tasks.js";
import { DEFAULT_TEXT_LIMIT, compactLongTextMiddle } from "../../utils/output.js";

// ── Dangerous command patterns (always blocked) ────────────────────

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Use \s+ (flexible whitespace) instead of fixed \s to match normalized commands
  { pattern: /\brm\s+-r[f ]?\s+\/\s*$/,  reason: "Recursive delete of root filesystem" },
  { pattern: /\brm\s+-r[f ]?\s+~\//,     reason: "Recursive delete of home directory" },
  { pattern: /\brm\s+-r[f ]?\s+\*/,      reason: "Recursive delete with wildcard" },
  { pattern: /\bmkfs\b/,                  reason: "Format filesystem" },
  { pattern: /\bdd\s+.*of=\/dev\//,       reason: "Direct write to device" },
  { pattern: />\s*\/dev\/sd[a-z]/,        reason: "Redirect to disk device" },
  { pattern: /:\(\)\s*\{.*:\|:.*&\s*\}\s*;?\s*:/, reason: "Fork bomb" },
  { pattern: /\bchmod\s+-R\s+777\s+\//,   reason: "Recursive chmod 777 on root" },
  { pattern: /\bchown\s+-R\s+.*\s+\//,    reason: "Recursive chown on root" },
  { pattern: /\b(curl|wget)\s.*\|\s*(sh|bash|zsh|ksh)\b/, reason: "Pipe remote script to shell" },
  { pattern: /\bdd\s+if=/,                reason: "Direct disk copy" },
  { pattern: /\bsudo\s+rm\s+-r/,          reason: "Recursive delete as root" },
  { pattern: /\/etc\/passwd\b/,            reason: "Access to passwd file" },
  { pattern: /\/etc\/shadow\b/,            reason: "Access to shadow file" },
  { pattern: /\bsudo\s+chmod\b/,          reason: "Sudo chmod" },
  { pattern: /\bsudo\s+chown\b/,          reason: "Sudo chown" },
];

/**
 * Normalize a shell command for security pattern matching.
 * Strips common evasion tricks: extra whitespace, quote insertion, backslash escapes.
 */
function normalizeForSecurity(command: string): string {
  return command
    // Collapse whitespace (tabs, multiple spaces)
    .replace(/\s+/g, " ")
    // Remove single-char quote wrapping: r''m → rm, r""m → rm
    .replace(/([a-zA-Z])['"]{1,2}([a-zA-Z])/g, "$1$2")
    // Remove backslash escapes in command names: r\m → rm
    .replace(/\\([a-zA-Z])/g, "$1")
    // Strip $'' ANSI-C quoting around single chars
    .replace(/\$'\\x[0-9a-fA-F]{2}'/g, "?")
    .trim();
}

/**
 * Check if command contains dangerous patterns that should be blocked.
 * Normalizes the command first to defeat common evasion tricks.
 */
export function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
  // Check both raw and normalized forms
  const normalized = normalizeForSecurity(command);
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(command) || pattern.test(normalized)) {
      return { dangerous: true, reason };
    }
  }
  return { dangerous: false };
}

/**
 * Log a bash execution to the SQLite audit log.
 */
function auditLog(command: string, exitCode: number | null, durationMs: number, sessionId?: string): void {
  try {
    dbRun(
      "INSERT INTO audit_log (session_id, tool_name, input_summary, result_summary, exit_code, duration_ms, was_allowed) VALUES (?, 'Bash', ?, ?, ?, ?, 1)",
      [sessionId ?? null, command.slice(0, 500), exitCode === 0 ? "success" : `exit ${exitCode}`, exitCode, durationMs],
    );
  } catch { /* audit failures shouldn't break tool execution */ }
}

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
  "sort", "uniq", "wc", "cut", "tr",
  // NOTE: awk and sed removed — both support in-place editing (-i flag)
  "diff", "comm", "tree", "file", "stat",
  "ps", "top", "htop", "lsof", "pgrep", "netstat", "ss",
  "date", "hostname", "whoami", "uname", "arch", "uptime",
  "which", "where", "type",
  "echo", "printf", "test", "true", "false",
  "pwd", "printenv", "id", "groups",
  "man", "help", "info", "apropos",
  "base64", "md5sum", "sha256sum", "shasum",
  "tput", "stty", "tty", "nproc", "getconf",
  "jq", "yq", "xmllint",
  "terraform", "helm",
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
  // NOTE: config, remote, stash, worktree are NOT read-only — they can modify state
]);

const NPM_READ_ONLY_SUBCOMMANDS = new Set([
  "ls", "list", "info", "view", "show", "search",
  "outdated", "audit", "whoami",
  "help", "explain", "why", "fund", "bugs", "repo",
]);

const PACKAGE_MANAGER_CONFIG_READ_ONLY_SUBCOMMANDS = new Set(["get"]);
const PACKAGE_MANAGER_SENSITIVE_CONFIG_KEY = /(?:auth|token|password|passwd|secret|credential|key|cert|otp)/i;
const PACKAGE_MANAGER_SAFE_CONFIG_KEY = /^[A-Za-z0-9_@./:-]+$/;

const DOCKER_READ_ONLY_SUBCOMMANDS = new Set([
  "ps", "images", "logs", "inspect", "stats", "top",
  "port", "diff", "history", "info", "version",
]);

const TERRAFORM_READ_ONLY_SUBCOMMANDS = new Set([
  "version", "validate",
]);

const HELM_READ_ONLY_SUBCOMMANDS = new Set([
  "list", "ls", "status", "history", "show", "search", "version", "lint",
]);

const TERRAFORM_STATE_READ_ONLY_SUBCOMMANDS = new Set(["list"]);
const TERRAFORM_PROVIDERS_READ_ONLY_SUBCOMMANDS = new Set(["schema"]);
const HELM_REPO_READ_ONLY_SUBCOMMANDS = new Set(["list"]);

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
      // Check two-char operators first (&&, ||), then single-char separators.
      if ((ch === "&" && command[i + 1] === "&") || (ch === "|" && command[i + 1] === "|")) {
        if (current.trim()) parts.push(current.trim());
        current = "";
        i++; // skip next char
      } else if (ch === "|" || ch === ";" || ch === "&" || ch === "\n" || ch === "\r") {
        if (current.trim()) parts.push(current.trim());
        current = "";
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
  if (hasOutputRedirection(part)) return false;
  if (hasCommandSubstitution(part)) return false;

  // Environment assignments can alter "read-only" commands via hooks such as
  // GIT_EXTERNAL_DIFF, PAGER, LESSOPEN, NODE_OPTIONS, or tool-specific config.
  // Keep these explicit rather than auto-approving the command after stripping.
  let cmd = part;
  if (/^[A-Z_][A-Z0-9_]*=\S*\s+/.test(cmd)) return false;

  // Get the base command. Strip simple shell quote wrapping so safety checks
  // see "-out=tfplan" the same way the shell will pass it to terraform.
  const tokens = cmd.split(/\s+/).filter(Boolean).map(normalizeShellToken);
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
      return isReadOnlyPackageManagerCommand(tokens);
    }
    if (baseCmd === "docker" || baseCmd === "kubectl") {
      const subCmd = tokens[1];
      return subCmd ? DOCKER_READ_ONLY_SUBCOMMANDS.has(subCmd) : false;
    }
    if (baseCmd === "find") {
      return !tokens.some(isUnsafeFindArg);
    }
    if (baseCmd === "terraform") {
      const subCmd = tokens[1];
      if (!subCmd) return false;
      if (subCmd === "plan") {
        return !tokens.slice(2).some(isUnsafeTerraformPlanArg);
      }
      if (subCmd === "state") {
        const stateSubCmd = tokens[2];
        return stateSubCmd ? TERRAFORM_STATE_READ_ONLY_SUBCOMMANDS.has(stateSubCmd) : false;
      }
      if (subCmd === "providers") {
        const providersSubCmd = tokens[2];
        return providersSubCmd ? TERRAFORM_PROVIDERS_READ_ONLY_SUBCOMMANDS.has(providersSubCmd) : true;
      }
      return TERRAFORM_READ_ONLY_SUBCOMMANDS.has(subCmd);
    }
    if (baseCmd === "helm") {
      const subCmd = tokens[1];
      if (!subCmd) return false;
      if (subCmd === "repo") {
        const repoSubCmd = tokens[2];
        return repoSubCmd ? HELM_REPO_READ_ONLY_SUBCOMMANDS.has(repoSubCmd) : false;
      }
      return HELM_READ_ONLY_SUBCOMMANDS.has(subCmd);
    }
    return true;
  }

  // Check if second token is a read-only keyword — but ONLY for known safe base commands
  // (prevents "rm help" or "chmod list" from being auto-approved)
  if (tokens.length > 1 && READ_ONLY_KEYWORDS.has(tokens[1]) && READ_ONLY_COMMANDS.has(baseCmd)) {
    return true;
  }

  return false;
}

function isReadOnlyPackageManagerCommand(tokens: string[]): boolean {
  const subCmd = tokens[1];
  if (!subCmd) return false;

  if (subCmd === "config") {
    const configSubCmd = tokens[2];
    if (!configSubCmd || !PACKAGE_MANAGER_CONFIG_READ_ONLY_SUBCOMMANDS.has(configSubCmd)) return false;
    const configKeys = tokens.slice(3).filter((token) => !token.startsWith("-"));
    return configKeys.length > 0 && configKeys.every((token) =>
      PACKAGE_MANAGER_SAFE_CONFIG_KEY.test(token) &&
      !hasShellExpansion(token) &&
      !PACKAGE_MANAGER_SENSITIVE_CONFIG_KEY.test(token)
    );
  }

  if (subCmd === "token") {
    return false;
  }

  return NPM_READ_ONLY_SUBCOMMANDS.has(subCmd);
}

function normalizeShellToken(token: string): string {
  let normalized = token;
  while (
    normalized.length >= 2 &&
    (
      (normalized.startsWith("'") && normalized.endsWith("'")) ||
      (normalized.startsWith('"') && normalized.endsWith('"'))
    )
  ) {
    normalized = normalized.slice(1, -1);
  }
  return normalized.replace(/\\(.)/g, "$1").replace(/['"]/g, "");
}

function isUnsafeTerraformPlanArg(token: string): boolean {
  return hasShellExpansion(token) || isTerraformPlanWriteFlag(token);
}

function hasShellExpansion(token: string): boolean {
  return token.includes("$") || token.includes("`");
}

function isTerraformPlanWriteFlag(token: string): boolean {
  const writeFlags = ["-out", "--out", "-generate-config-out", "--generate-config-out"];
  return writeFlags.some((flag) => token === flag || token.startsWith(`${flag}=`));
}

function isUnsafeFindArg(token: string): boolean {
  return FIND_UNSAFE_ACTIONS.has(token);
}

const FIND_UNSAFE_ACTIONS = new Set([
  "-delete",
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-fls",
]);

function hasCommandSubstitution(command: string): boolean {
  return command.includes("$(") || command.includes("`") || command.includes("<(") || command.includes(">(");
}

function hasOutputRedirection(command: string): boolean {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (ch === ">" && !inSingleQuote && !inDoubleQuote) {
      return true;
    }
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
    // Block dangerous commands
    const danger = isDangerousCommand(input.command);
    if (danger.dangerous) {
      try { dbRun("INSERT INTO audit_log (tool_name, input_summary, was_allowed) VALUES ('Bash', ?, 0)", [input.command.slice(0, 200)]); } catch {}
      return { result: false, message: `Blocked dangerous command: ${danger.reason}`, errorCode: 3 };
    }

    // Sandbox enforcement: check filesystem write restrictions
    try {
      const { getSettings } = require("../../config/loader.js");
      const sandbox = getSettings().sandbox;
      if (sandbox?.filesystem?.denyWrite?.length) {
        const cmd = input.command;
        for (const denied of sandbox.filesystem.denyWrite) {
          if (cmd.includes(denied)) {
            return { result: false, message: `Sandbox: write access denied to "${denied}"`, errorCode: 4 };
          }
        }
      }
      if (sandbox?.network?.deniedDomains?.length) {
        const cmd = input.command;
        for (const denied of sandbox.network.deniedDomains) {
          if (cmd.includes(denied)) {
            return { result: false, message: `Sandbox: network access denied to "${denied}"`, errorCode: 5 };
          }
        }
      }
    } catch { /* sandbox config not available */ }

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
    if (!input.command || typeof input.command !== "string") {
      return { data: { stdout: "", stderr: "Error: command is required", exitCode: 1, interrupted: false, durationMs: 0 } };
    }
    const { command, timeout, run_in_background } = input;
    const timeoutMs = timeout ?? getDefaultTimeout();
    const startTime = performance.now();

    // Background execution
    if (run_in_background) {
      const bgTask = createBgTask("bash", command);
      const taskId = bgTask.id;
      const child = spawn(command, [], {
        shell: getShell(),
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      child.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        writeTaskOutput(taskId, chunk);
      });
      child.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        writeTaskOutput(taskId, chunk);
      });

      // Also keep in the legacy map for backward compat
      const task = { process: child, output: "", done: false, exitCode: null as number | null };
      backgroundTasks.set(taskId, task);

      child.on("close", (code) => {
        task.output = output;
        task.done = true;
        task.exitCode = code;
        completeBgTask(taskId, output, code ?? undefined);
        // Clean up after 5 minutes to prevent memory leak
        setTimeout(() => backgroundTasks.delete(taskId), 5 * 60 * 1000);
      });

      child.on("error", (err) => {
        task.done = true;
        task.exitCode = 1;
        failBgTask(taskId, err.message);
        setTimeout(() => backgroundTasks.delete(taskId), 5 * 60 * 1000);
      });

      return {
        data: {
          stdout: `Background task started with ID: ${taskId}. Use TaskOutput to check its status.`,
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
      });

      const MAX_OUTPUT = 5 * 1024 * 1024; // 5MB cap per stream
      child.stdout?.on("data", (data: Buffer) => {
        if (stdout.length < MAX_OUTPUT) stdout += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        if (stderr.length < MAX_OUTPUT) stderr += data.toString();
      });

      // Enforce timeout — spawn() does NOT support timeout option natively
      const timeoutTimer = setTimeout(() => {
        interrupted = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 3000);
      }, timeoutMs);

      // Handle abort
      const onAbort = () => {
        interrupted = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000);
      };
      const abortSignal = context.abortController?.signal ?? (context as any).abortSignal;
      abortSignal?.addEventListener("abort", onAbort, { once: true });

      child.on("close", (code, signal) => {
        clearTimeout(timeoutTimer);
        abortSignal?.removeEventListener("abort", onAbort);
        const durationMs = performance.now() - startTime;

        if (signal === "SIGTERM" || signal === "SIGKILL") {
          interrupted = true;
        }

        // Truncate large outputs
        stdout = truncateOutput(stdout);
        stderr = truncateOutput(stderr);

        // Audit log
        auditLog(command, code, durationMs);

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
        clearTimeout(timeoutTimer);
        abortSignal?.removeEventListener("abort", onAbort);
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

    const content = compactLongTextMiddle(
      parts.join("\n").trim() || "(no output)",
      DEFAULT_TEXT_LIMIT * 3,
      "Use run_in_background:true with TaskOutput limit, redirect output to a file, or narrow the command for more detail.",
    );

    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content,
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
