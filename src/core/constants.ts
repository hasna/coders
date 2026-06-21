/**
 * Core constants — tool names, config paths, defaults
 */
import { readFileSync } from "fs";

function readPackageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
    ) as { version?: unknown };
    if (typeof packageJson.version === "string") return packageJson.version;
  } catch {
    // Bundled builds inject CODERS_VERSION; source runs fall back to 0.0.0.
  }
  return "0.0.0";
}

// Tool names (matching Claude Code's tool name constants)
export const BASH_TOOL = "Bash" as const;
export const READ_TOOL = "Read" as const;
export const EDIT_TOOL = "Edit" as const;
export const WRITE_TOOL = "Write" as const;
export const GLOB_TOOL = "Glob" as const;
export const GREP_TOOL = "Grep" as const;
export const AGENT_TOOL = "Agent" as const;
export const WEB_FETCH_TOOL = "WebFetch" as const;
export const WEB_SEARCH_TOOL = "WebSearch" as const;
export const NOTEBOOK_EDIT_TOOL = "NotebookEdit" as const;
export const LSP_TOOL = "LSP" as const;
export const TASK_CREATE_TOOL = "TaskCreate" as const;
export const TASK_GET_TOOL = "TaskGet" as const;
export const TASK_LIST_TOOL = "TaskList" as const;
export const TASK_UPDATE_TOOL = "TaskUpdate" as const;
export const TASK_STOP_TOOL = "TaskStop" as const;
export const TASK_OUTPUT_TOOL = "TaskOutput" as const;
export const ENTER_PLAN_MODE_TOOL = "EnterPlanMode" as const;
export const EXIT_PLAN_MODE_TOOL = "ExitPlanMode" as const;
export const ASK_USER_QUESTION_TOOL = "AskUserQuestion" as const;
export const CRON_CREATE_TOOL = "CronCreate" as const;
export const CRON_DELETE_TOOL = "CronDelete" as const;
export const CRON_LIST_TOOL = "CronList" as const;
export const ENTER_WORKTREE_TOOL = "EnterWorktree" as const;
export const EXIT_WORKTREE_TOOL = "ExitWorktree" as const;
export const TOOL_SEARCH_TOOL = "ToolSearch" as const;
export const SEND_MESSAGE_TOOL = "SendMessage" as const;
export const CONFIG_TOOL = "Config" as const;
export const LIST_MCP_RESOURCES_TOOL = "ListMcpResourcesTool" as const;
export const READ_MCP_RESOURCE_TOOL = "ReadMcpResourceTool" as const;
export const SKILL_TOOL = "Skill" as const;

// Read-only tools (safe for speculation and plan mode)
export const READ_ONLY_TOOLS = new Set([
  READ_TOOL,
  GLOB_TOOL,
  GREP_TOOL,
  TOOL_SEARCH_TOOL,
  LSP_TOOL,
  TASK_GET_TOOL,
  TASK_LIST_TOOL,
  LIST_MCP_RESOURCES_TOOL,
  READ_MCP_RESOURCE_TOOL,
  SKILL_TOOL,
]);

// Write-class tools
export const WRITE_TOOLS = new Set([EDIT_TOOL, WRITE_TOOL, NOTEBOOK_EDIT_TOOL]);

// Config paths
export const CONFIG_DIR_ENV = "CODERS_CONFIG_DIR";
export const DEFAULT_CONFIG_DIR = ".coders";

// Instructions file names
export const INSTRUCTIONS_FILE = "CODERS.md";

// Defaults
export const DEFAULT_BASH_TIMEOUT_MS = 120_000;
export const MAX_BASH_TIMEOUT_MS = 600_000;
export const DEFAULT_READ_LINE_LIMIT = 2000;
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 100_000;
export const DEFAULT_MCP_CONNECTION_BATCH_SIZE = 3;

// Permission modes
export type PermissionMode =
  | "default"
  | "plan"
  | "acceptEdits"
  | "dontAsk"
  | "auto"
  | "bypassPermissions";

export const PERMISSION_MODES: PermissionMode[] = [
  "default",
  "plan",
  "acceptEdits",
  "dontAsk",
  "auto",
  "bypassPermissions",
];

// API
export const ANTHROPIC_API_URL = "https://api.anthropic.com";
export const MESSAGES_ENDPOINT = "/v1/messages";
export const BETA_HEADERS = [
  "claude-code-20250219",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
];

// Telemetry prefix
export const TELEMETRY_PREFIX = "coders_";

// Version info
export const VERSION = process.env.CODERS_VERSION ?? readPackageVersion();
export const BUILD_TIME = process.env.CODERS_BUILD_TIME ?? new Date().toISOString();
