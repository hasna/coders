/**
 * Main Ink App — full-screen terminal coding agent UI
 *
 * This is the REAL agent UI. It:
 *   1. Streams API responses with real-time text display
 *   2. Executes all 26 built-in tools (Bash, Read, Edit, Write, Glob, Grep, Agent, Tasks, LSP, etc.)
 *   3. Shows tool progress with ⎿ connectors and spinners
 *   4. Handles permissions (y/n/a) for dangerous operations
 *   5. Maintains multi-turn conversation with tool results
 *   6. Displays diffs for file edits
 *   7. Tracks cost and token usage
 */
import React, { useState, useCallback, useEffect, useRef } from "react";
import { render, Box, Text, Static, useApp, useInput, useStdout } from "ink";
import { execSync } from "child_process";
import { VERSION } from "../cli/index.js";
import { resolveApiKey } from "../auth/api-key.js";
import { getSettings } from "../config/loader.js";
import { getApiClient } from "../api/client.js";
import type { Message as ApiMessage, ThinkingConfig } from "../api/client.js";
import { isSlashCommand, executeSlashCommand, getAllSlashCommands } from "../core/slash-commands.js";
import { estimateCost } from "../api/streaming.js";
import { renderMarkdown } from "./components/markdown.js";
import { runAgentLoop, type ToolHandler, type ToolResult } from "../core/agent-loop.js";
import { createDefaultPermissionContext, checkToolPermission, type PermissionResult } from "../config/permissions.js";
import { dbRun } from "../db/index.js";
import {
  getRunningTasks,
  getRecentlyCompletedTasks,
  type BackgroundTask,
} from "../core/background-tasks.js";
import {
  createSession,
  loadSession,
  addMessage,
  updateSession,
  setCurrentSessionId,
  listRecentSessions,
  saveCheckpoint,
  type Session,
  type ConversationCheckpoint,
} from "../core/session.js";
import { buildSystemPrompt } from "../core/system-prompt.js";
import { bashTool } from "../tools/builtin/bash.js";
import { readTool } from "../tools/builtin/read.js";
import { editTool } from "../tools/builtin/edit.js";
import { writeTool } from "../tools/builtin/write.js";
import { globTool } from "../tools/builtin/glob.js";
import { grepTool } from "../tools/builtin/grep.js";
import { agentTool } from "../tools/builtin/agent.js";
import { taskCreateTool, taskGetTool, taskListTool, taskUpdateTool } from "../tools/builtin/tasks.js";
import { taskOutputTool, taskStopTool } from "../tools/builtin/task-output.js";
import { askUserQuestionTool } from "../tools/builtin/ask-user.js";
import { webSearchTool } from "../tools/builtin/web-search.js";
import { webFetchTool } from "../tools/builtin/web-fetch.js";
import { lspTool } from "../tools/builtin/lsp.js";
import { enterPlanModeTool, exitPlanModeTool } from "../tools/builtin/plan-mode.js";
import {
  toolSearchTool, cronCreateTool, cronDeleteTool, cronListTool,
  enterWorktreeTool, exitWorktreeTool, notebookEditTool,
  configTool, sendMessageTool,
} from "../tools/builtin/misc.js";
import { listMcpResourcesTool, readMcpResourceTool } from "../tools/builtin/mcp-resources.js";
import { executeHooks } from "../hooks/registry.js";
import { initMcpServers } from "../mcp/init.js";
import { disconnectAllMcpServers } from "../mcp/client.js";
import { createTeam, getTeam, addTeamMember, updateMemberStatus } from "../core/team.js";
import { classifyPrompt, filterToolsByClassification, type PromptClassification } from "../core/classifier.js";
import { skillTool } from "../tools/builtin/skill.js";
import { setDeferredToolSchemas } from "../tools/registry.js";

// ── Types ──────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  tools?: ToolDisplay[];
  thinking?: string;
  durationMs?: number;
  durationVerb?: string; // Fixed at creation, not random on each render
}

interface ToolDisplay {
  id: string;
  name: string;
  summary: string;
  status: "running" | "done" | "error";
  result?: string;
  error?: string;
  durationMs?: number;
}

// ── Constants ──────────────────────────────────────────────────────

const CONN = "⎿";
const PROMPT = "❯";
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const VERBS = ["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"];

// ── Tool JSON Schemas (sent to the API so the model knows each tool's parameters) ──

const TOOL_JSON_SCHEMAS: Record<string, Record<string, unknown>> = {
  Bash: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to execute" },
      description: { type: "string", description: "Clear, concise description of what this command does" },
      timeout: { type: "number", description: "Optional timeout in milliseconds (max 600000)" },
      run_in_background: { type: "boolean", description: "Set to true to run in the background" },
    },
    required: ["command"],
  },
  Read: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "The absolute path to the file to read" },
      offset: { type: "number", description: "The line number to start reading from" },
      limit: { type: "number", description: "The number of lines to read" },
      pages: { type: "string", description: "Page range for PDF files (e.g. '1-5')" },
    },
    required: ["file_path"],
  },
  Edit: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "The absolute path to the file to modify" },
      old_string: { type: "string", description: "The text to replace" },
      new_string: { type: "string", description: "The text to replace it with (must be different from old_string)" },
      replace_all: { type: "boolean", description: "Replace all occurrences of old_string (default false)", default: false },
    },
    required: ["file_path", "old_string", "new_string"],
  },
  Write: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "The absolute path to the file to write" },
      content: { type: "string", description: "The content to write to the file" },
    },
    required: ["file_path", "content"],
  },
  Glob: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The glob pattern to match files against" },
      path: { type: "string", description: "The directory to search in. Defaults to current working directory." },
    },
    required: ["pattern"],
  },
  Grep: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The regular expression pattern to search for" },
      path: { type: "string", description: "File or directory to search in. Defaults to cwd." },
      glob: { type: "string", description: "Glob pattern to filter files (e.g. '*.js', '*.{ts,tsx}')" },
      type: { type: "string", description: "File type to search (js, py, rust, go, etc.)" },
      output_mode: { type: "string", enum: ["content", "files_with_matches", "count"], description: "Output mode. Defaults to 'files_with_matches'." },
      "-A": { type: "number", description: "Lines to show after each match" },
      "-B": { type: "number", description: "Lines to show before each match" },
      "-C": { type: "number", description: "Context lines before and after each match" },
      context: { type: "number", description: "Alias for -C" },
      "-i": { type: "boolean", description: "Case insensitive search" },
      "-n": { type: "boolean", description: "Show line numbers (default true)" },
      multiline: { type: "boolean", description: "Enable multiline mode" },
      head_limit: { type: "number", description: "Limit output to first N entries" },
      offset: { type: "number", description: "Skip first N entries" },
    },
    required: ["pattern"],
  },
  Agent: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "The task for the agent to perform" },
      description: { type: "string", description: "A short (3-5 word) description of the task" },
      subagent_type: { type: "string", description: "Agent type: general-purpose, Explore, Plan, verification" },
      model: { type: "string", enum: ["sonnet", "opus", "haiku"], description: "Model override for this agent" },
      run_in_background: { type: "boolean", description: "Run agent in background" },
      isolation: { type: "string", enum: ["worktree"], description: "Isolation mode" },
    },
    required: ["prompt"],
  },
  TaskCreate: {
    type: "object",
    properties: {
      subject: { type: "string", description: "A brief title for the task" },
      description: { type: "string", description: "A detailed description of what needs to be done" },
      activeForm: { type: "string", description: 'Present continuous form for spinner (e.g., "Running tests")' },
      metadata: { type: "object", description: "Arbitrary metadata" },
    },
    required: ["subject", "description"],
  },
  TaskGet: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "The ID of the task to retrieve" },
    },
    required: ["taskId"],
  },
  TaskList: {
    type: "object",
    properties: {},
  },
  TaskUpdate: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "The ID of the task to update" },
      subject: { type: "string", description: "New subject" },
      description: { type: "string", description: "New description" },
      activeForm: { type: "string", description: "New active form" },
      status: { type: "string", description: "New status: pending, in_progress, completed, failed, cancelled, deleted" },
      owner: { type: "string", description: "New owner" },
      addBlocks: { type: "array", items: { type: "string" }, description: "Task IDs this task blocks" },
      addBlockedBy: { type: "array", items: { type: "string" }, description: "Task IDs that block this task" },
      metadata: { type: "object", description: "Metadata to merge" },
    },
    required: ["taskId"],
  },
  AskUserQuestion: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        description: "1-4 questions to ask",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The complete question to ask" },
            header: { type: "string", description: "Short label (max 30 chars)" },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "Display text (1-5 words)" },
                  description: { type: "string", description: "Explanation of the option" },
                  preview: { type: "string", description: "Optional preview content" },
                },
                required: ["label", "description"],
              },
              description: "2-4 available choices",
            },
            multiSelect: { type: "boolean", description: "Allow multiple selections" },
          },
          required: ["question", "header", "options"],
        },
      },
      answers: { type: "object", description: "Pre-filled answers from permission UI" },
      annotations: { type: "object", description: "Per-question annotations" },
    },
    required: ["questions"],
  },
  WebSearch: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
      allowed_domains: { type: "array", items: { type: "string" }, description: "Only include results from these domains" },
      blocked_domains: { type: "array", items: { type: "string" }, description: "Never include results from these domains" },
    },
    required: ["query"],
  },
  WebFetch: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
      prompt: { type: "string", description: "Prompt to run on fetched content" },
    },
    required: ["url", "prompt"],
  },
  LSP: {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["goToDefinition", "findReferences", "hover", "documentSymbol", "workspaceSymbol", "goToImplementation", "prepareCallHierarchy", "incomingCalls", "outgoingCalls"], description: "The LSP operation to perform" },
      filePath: { type: "string", description: "Absolute or relative path to the file" },
      line: { type: "number", description: "Line number (1-based)" },
      character: { type: "number", description: "Character offset (1-based)" },
    },
    required: ["operation", "filePath", "line", "character"],
  },
  EnterPlanMode: {
    type: "object",
    properties: {},
  },
  ExitPlanMode: {
    type: "object",
    properties: {},
  },
  ToolSearch: {
    type: "object",
    properties: {
      query: { type: "string", description: "Query to find tools" },
      max_results: { type: "number", description: "Max results (default 5)" },
    },
    required: ["query"],
  },
  CronCreate: {
    type: "object",
    properties: {
      cron: { type: "string", description: '5-field cron: "M H DoM Mon DoW"' },
      prompt: { type: "string", description: "The prompt to enqueue" },
      recurring: { type: "boolean", description: "true=recurring, false=one-shot" },
    },
    required: ["cron", "prompt"],
  },
  CronDelete: {
    type: "object",
    properties: {
      id: { type: "string", description: "Job ID to cancel" },
    },
    required: ["id"],
  },
  CronList: {
    type: "object",
    properties: {},
  },
  EnterWorktree: {
    type: "object",
    properties: {
      name: { type: "string", description: "Worktree name" },
    },
  },
  ExitWorktree: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["keep", "remove"], description: "Keep or remove the worktree" },
      discard_changes: { type: "boolean", description: "Allow discarding uncommitted changes" },
    },
    required: ["action"],
  },
  NotebookEdit: {
    type: "object",
    properties: {
      notebook_path: { type: "string", description: "Path to the .ipynb file" },
      command: { type: "string", enum: ["insert_cell", "replace_cell", "delete_cell", "move_cell", "change_cell_type"], description: "Operation to perform on the notebook" },
      cell_index: { type: "number", description: "Cell index to operate on (0-based). For insert_cell, position to insert at (omit to append)." },
      cell_type: { type: "string", enum: ["code", "markdown", "raw"], description: "Cell type — required for insert_cell and change_cell_type" },
      new_source: { type: "string", description: "New cell content — required for insert_cell and replace_cell" },
      target_index: { type: "number", description: "Destination index for move_cell" },
    },
    required: ["notebook_path", "command"],
  },
  Config: {
    type: "object",
    properties: {
      setting: { type: "string", description: "Setting key" },
      value: { type: ["string", "boolean", "number"], description: "New value (omit to get)" },
    },
    required: ["setting"],
  },
  SendMessage: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient agent name or ID" },
      message: { type: "string", description: "Message content" },
    },
    required: ["to", "message"],
  },
  TaskOutput: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The ID of the background task to check (e.g. 'bg-1', 'agent-2')" },
    },
    required: ["task_id"],
  },
  TaskStop: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The ID of the background task to stop (e.g. 'bg-1', 'agent-2')" },
    },
    required: ["task_id"],
  },
  ListMcpResourcesTool: {
    type: "object",
    properties: {},
  },
  ReadMcpResourceTool: {
    type: "object",
    properties: {
      server_name: { type: "string", description: "The name of the MCP server that owns the resource" },
      uri: { type: "string", description: "The URI of the resource to read" },
    },
    required: ["server_name", "uri"],
  },
  Skill: {
    type: "object",
    properties: {
      skill: { type: "string", description: "The skill name to invoke (e.g. 'commit', 'review-pr')" },
      args: { type: "string", description: "Optional arguments to pass to the skill prompt" },
    },
    required: ["skill"],
  },
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  Bash: "Executes a bash command and returns its output. Use for system commands, builds, and terminal operations.",
  Read: "Reads a file from the filesystem. Returns contents with line numbers. Supports text, PDF, images, and notebooks.",
  Edit: "Performs exact string replacements in files. Use old_string/new_string for targeted edits.",
  Write: "Writes content to a file, creating it if needed or overwriting if it exists.",
  Glob: "Fast file pattern matching. Returns matching file paths sorted by modification time.",
  Grep: "Content search powered by ripgrep. Supports regex, file type filters, and multiple output modes.",
  Agent: "Launch a sub-agent to handle complex, multi-step tasks autonomously. Supports multiple agent types.",
  TaskCreate: "Create a new task in the task list for tracking work.",
  TaskGet: "Get a task by ID to view full details including description and dependencies.",
  TaskList: "List all tasks to see status, owners, and blockers.",
  TaskUpdate: "Update a task: change status, subject, description, owner, or dependencies.",
  AskUserQuestion: "Present structured multiple-choice questions to the user for clarification.",
  WebSearch: "Search the web for current information using the model's built-in web search.",
  WebFetch: "Fetch content from a URL and convert HTML to readable text.",
  LSP: "Language Server Protocol — code intelligence (definitions, references, symbols, hover).",
  EnterPlanMode: "Enter plan mode for read-only exploration and design before coding.",
  ExitPlanMode: "Exit plan mode and present plan for user approval.",
  ToolSearch: "Search for available tools by keyword. Use to discover deferred tools.",
  CronCreate: "Schedule a recurring prompt on a cron schedule.",
  CronDelete: "Cancel a scheduled cron job by its ID.",
  CronList: "List all active scheduled cron jobs.",
  EnterWorktree: "Create an isolated git worktree and switch into it.",
  ExitWorktree: "Exit a worktree session, keeping or removing the worktree.",
  NotebookEdit: "Edit Jupyter notebook cells — insert, replace, delete, move cells, or change cell type. Preserves all metadata and outputs.",
  Config: "Get or set a configuration setting.",
  SendMessage: "Send a direct message to another agent or to the user.",
  TaskOutput: "Check the status and output of a background task (bash or agent).",
  TaskStop: "Stop a running background task by its ID.",
  ListMcpResourcesTool: "List all resources available from connected MCP servers.",
  ReadMcpResourceTool: "Read a resource from a connected MCP server by server name and URI.",
  Skill: "Execute a skill within the main conversation. Skills are user-defined prompts in .coders/skills/ or .claude/skills/ directories.",
};

// ── Hooks ──────────────────────────────────────────────────────────

function useSpinner(active: boolean): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, [active]);
  return active ? FRAMES[i] : " ";
}

// ── Tool Handler Factory ───────────────────────────────────────────
// Creates ToolHandler objects that bridge our Tool implementations
// with the agent loop, providing real execution + UI updates

interface ToolHandlerSplit {
  /** Tools sent to the API in the tools array (immediate + always-on) */
  immediate: ToolHandler[];
  /** All tool handlers including deferred — used for execution lookup */
  all: ToolHandler[];
  /** Deferred tool info for the system prompt (name + description only) */
  deferredInfo: Array<{ name: string; description: string }>;
  /** Full deferred tool schemas — used by ToolSearch to return schemas on demand */
  deferredSchemas: Map<string, { name: string; description: string; inputSchema: Record<string, unknown> }>;
}

function createToolHandlers(mcpHandlers?: ToolHandler[]): ToolHandlerSplit {
  const tools = [
    bashTool, readTool, editTool, writeTool, globTool, grepTool,
    agentTool, taskCreateTool, taskGetTool, taskListTool, taskUpdateTool,
    taskOutputTool, taskStopTool,
    askUserQuestionTool, webSearchTool, webFetchTool, lspTool,
    enterPlanModeTool, exitPlanModeTool, toolSearchTool,
    cronCreateTool, cronDeleteTool, cronListTool,
    enterWorktreeTool, exitWorktreeTool, notebookEditTool,
    configTool, sendMessageTool,
    listMcpResourcesTool, readMcpResourceTool,
    skillTool,
  ];
  const permCtx = createDefaultPermissionContext(getSettings());
  const appState = { toolPermissionContext: permCtx, verbose: false };

  const immediate: ToolHandler[] = [];
  const all: ToolHandler[] = [];
  const deferredInfo: Array<{ name: string; description: string }> = [];
  const deferredSchemas = new Map<string, { name: string; description: string; inputSchema: Record<string, unknown> }>();

  for (const tool of tools) {
    const handler: ToolHandler = {
      name: tool.name,
      description: TOOL_DESCRIPTIONS[tool.name] ?? `Tool: ${tool.name}`,
      inputSchema: TOOL_JSON_SCHEMAS[tool.name] ?? { type: "object" as const, properties: {} },
      isReadOnly: tool.isReadOnly(),
      isConcurrencySafe: tool.isConcurrencySafe(),
      call: async (input: Record<string, unknown>, ctx: any): Promise<ToolResult> => {
        const summary = toolSummary(tool.name, input);
        const t0 = performance.now();

        try {
          const toolCtx = {
            abortController: new AbortController(),
            getAppState: () => appState,
            setAppState: (fn: any) => Object.assign(appState, fn(appState)),
            options: { mainLoopModel: "sonnet", thinkingConfig: { type: "disabled" as const }, isNonInteractiveSession: false, tools: [], agentDefinitions: { activeAgents: [] } },
          };

          const result = await tool.call(input as any, toolCtx as any);
          const block = tool.mapToolResultToToolResultBlockParam(result.data as any, ctx.toolUseId ?? "");
          const dur = performance.now() - t0;

          // Audit log
          try { dbRun("INSERT INTO audit_log (tool_name, input_summary, result_summary, duration_ms, was_allowed) VALUES (?, ?, ?, ?, 1)", [tool.name, summary, block.content.slice(0, 200), dur]); } catch {}
          // Propagate tool-level errors (is_error on the result block)
          return block.is_error
            ? { data: block.content, error: block.content, isError: true }
            : { data: block.content };
        } catch (err) {
          const dur = performance.now() - t0;
          const errMsg = err instanceof Error ? err.message : String(err);
          try { dbRun("INSERT INTO audit_log (tool_name, input_summary, result_summary, duration_ms, was_allowed) VALUES (?, ?, ?, ?, 1)", [tool.name, summary, errMsg.slice(0, 200), dur]); } catch {}
          return { error: errMsg, isError: true };
        }
      },
    };

    all.push(handler);

    if (tool.shouldDefer) {
      // Deferred: not sent to the API initially, discovered via ToolSearch
      deferredInfo.push({
        name: tool.name,
        description: TOOL_DESCRIPTIONS[tool.name] ?? tool.searchHint,
      });
      deferredSchemas.set(tool.name, {
        name: tool.name,
        description: TOOL_DESCRIPTIONS[tool.name] ?? tool.searchHint,
        inputSchema: TOOL_JSON_SCHEMAS[tool.name] ?? { type: "object" as const, properties: {} },
      });
    } else {
      // Immediate: sent to the API in the tools array
      immediate.push(handler);
    }
  }

  // Append MCP tool handlers — MCP tools are always immediate (sent to API)
  if (mcpHandlers && mcpHandlers.length > 0) {
    for (const h of mcpHandlers) {
      immediate.push(h);
      all.push(h);
    }
  }

  return { immediate, all, deferredInfo, deferredSchemas };
}

/** Shorten absolute paths to relative from cwd */
function shortPath(p: string): string {
  if (!p) return "";
  const cwd = process.cwd();
  if (p.startsWith(cwd + "/")) return p.slice(cwd.length + 1);
  if (p.startsWith(cwd)) return p.slice(cwd.length) || ".";
  // If outside cwd, show last 2 segments
  const segs = p.split("/").filter(Boolean);
  return segs.length > 2 ? `…/${segs.slice(-2).join("/")}` : p;
}

function toolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Bash": {
      let cmd = String(input.command ?? "");
      // Shorten cwd references in bash commands
      const cwd = process.cwd();
      if (cwd && cmd.includes(cwd)) cmd = cmd.replaceAll(cwd, ".");
      return cmd.slice(0, 60);
    }
    case "Read": return shortPath(String(input.file_path ?? ""));
    case "Edit": return shortPath(String(input.file_path ?? ""));
    case "Write": return shortPath(String(input.file_path ?? ""));
    case "Glob": return String(input.pattern ?? "");
    case "Grep": return String(input.pattern ?? "");
    case "Agent": return String(input.description ?? input.prompt ?? "").slice(0, 50);
    case "TaskCreate": return String(input.subject ?? "").slice(0, 50);
    case "TaskGet": return `#${input.taskId ?? ""}`;
    case "TaskList": return "";
    case "TaskUpdate": return `#${input.taskId ?? ""} ${input.status ?? ""}`.trim();
    case "AskUserQuestion": return `${(input.questions as any[])?.length ?? 0} question(s)`;
    case "WebSearch": return String(input.query ?? "").slice(0, 50);
    case "WebFetch": return String(input.url ?? "").slice(0, 50);
    case "LSP": return `${input.operation ?? ""} ${shortPath(String(input.filePath ?? ""))}`.trim();
    case "EnterPlanMode": return "";
    case "ExitPlanMode": return "";
    case "ToolSearch": return String(input.query ?? "").slice(0, 50);
    case "CronCreate": return String(input.cron ?? "");
    case "CronDelete": return String(input.id ?? "");
    case "CronList": return "";
    case "EnterWorktree": return String(input.name ?? "");
    case "ExitWorktree": return String(input.action ?? "");
    case "NotebookEdit": return `${input.command ?? ""} ${shortPath(String(input.notebook_path ?? ""))}`.trim();
    case "Config": return String(input.setting ?? "");
    case "SendMessage": return `to:${input.to ?? ""}`;
    case "TaskOutput": return String(input.task_id ?? "");
    case "TaskStop": return String(input.task_id ?? "");
    case "ListMcpResourcesTool": return "";
    case "ReadMcpResourceTool": return `${input.server_name ?? ""}:${input.uri ?? ""}`.slice(0, 60);
    case "Skill": return String(input.skill ?? "").slice(0, 50);
    default: return "";
  }
}

// ── Components ─────────────────────────────────────────────────────

function SpinnerDot() {
  const f = useSpinner(true);
  return <Text color="cyan">{f}</Text>;
}

// ── Background Task List Component ─────────────────────────────────

function BackgroundTaskItem({ task }: { task: BackgroundTask }) {
  const spinner = useSpinner(task.status === "running");
  const icon = task.status === "running" ? spinner
    : task.status === "completed" ? "\u2713"
    : "\u2717";
  const color = task.status === "running" ? "yellow"
    : task.status === "completed" ? "green"
    : "red";

  const now = Date.now();
  const durationMs = task.endTime ? (task.endTime - task.startTime) : (now - task.startTime);
  const durSec = Math.round(durationMs / 1000);
  const durStr = durSec < 60 ? `${durSec}s` : `${Math.floor(durSec / 60)}m ${durSec % 60}s`;
  const desc = task.description.length > 40 ? task.description.slice(0, 37) + "..." : task.description;

  let detail = `${task.status === "running" ? "running" : task.status}`;
  detail += ` \u00B7 ${durStr}`;
  if (task.exitCode !== undefined && task.exitCode !== null && task.status !== "running") {
    detail += ` \u00B7 exit ${task.exitCode}`;
  }
  if (task.progress?.tokenCount) {
    detail += ` \u00B7 ${fmtTok(task.progress.tokenCount)} tokens`;
  }

  return (
    <Box>
      <Text color={color}>{icon} </Text>
      <Text bold>{task.id}</Text>
      <Text>: {desc} </Text>
      <Text dimColor>({detail})</Text>
    </Box>
  );
}

function BackgroundTaskList({ tasks }: { tasks: BackgroundTask[] }) {
  if (tasks.length === 0) return null;
  return (
    <Box flexDirection="column">
      {tasks.map((t) => <BackgroundTaskItem key={t.id} task={t} />)}
    </Box>
  );
}

// ── Custom Status Line Hook ────────────────────────────────────────

function useCustomStatusLine(
  config: { type: "command"; command: string; padding?: number } | undefined,
  context: { model: string; cost: number; tokens: number },
): string | null {
  const [output, setOutput] = useState<string | null>(null);
  const lastRunRef = useRef<number>(0);

  useEffect(() => {
    if (!config || config.type !== "command") {
      setOutput(null);
      return;
    }

    const runCommand = () => {
      try {
        const stdinData = JSON.stringify({
          model: context.model,
          cost: context.cost,
          tokens: context.tokens,
          cwd: process.cwd(),
          version: VERSION,
        });
        const result = execSync(config.command, {
          timeout: 3000,
          input: stdinData,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        const trimmed = result.trim();
        if (trimmed) {
          setOutput(config.padding ? trimmed.padEnd(config.padding) : trimmed);
        }
      } catch {
        // Command failed — fall back to default status line
        setOutput(null);
      }
      lastRunRef.current = Date.now();
    };

    // Run immediately on first mount / config change
    runCommand();

    // Poll every 2 seconds
    const interval = setInterval(runCommand, 2000);
    return () => clearInterval(interval);
  }, [config?.command, config?.padding, context.model, context.cost, context.tokens]);

  return output;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _Header({ model, mode, agentName, teamName }: { model: string; mode: string; agentName?: string; teamName?: string }) {
  return (
    <Box marginBottom={1}>
      <Text bold color="cyan">@hasna/coders</Text>
      <Text dimColor> v{VERSION} · {model} · {mode}</Text>
      {agentName && teamName && <Text dimColor> · </Text>}
      {agentName && teamName && <Text color="yellow">{agentName}</Text>}
      {teamName && <Text dimColor>@{teamName}</Text>}
    </Box>
  );
}

function ToolItem({ tool }: { tool: ToolDisplay }) {
  const f = useSpinner(tool.status === "running");
  const icon = tool.status === "running" ? f : "●";
  const color = tool.status === "running" ? "cyan"
    : tool.status === "error" ? "red" : "cyan";

  const toolArgs = tool.summary ? ` ${tool.summary.slice(0, 50)}` : "";
  const dur = tool.durationMs != null ? ` (${(tool.durationMs / 1000).toFixed(1)}s)` : "";

  // Single-line result preview
  const resultLine = tool.result && tool.status === "done"
    ? formatToolResult(tool.name, tool.result)[0] ?? ""
    : "";

  return (
    <Box flexDirection="column" marginTop={0}>
      <Box>
        <Text color={color}>{icon} </Text>
        <Text bold color={color}>{tool.name}</Text>
        <Text dimColor>{toolArgs}{dur}</Text>
      </Box>
      {resultLine && (
        <Box>
          <Text dimColor>  {CONN} </Text>
          <Text dimColor>{resultLine.slice(0, 90)}</Text>
        </Box>
      )}
      {tool.error && (
        <Box>
          <Text dimColor>  {CONN} </Text>
          <Text color="red">{tool.error.slice(0, 90)}</Text>
        </Box>
      )}
    </Box>
  );
}

/** Format tool result — ultra-compact, 1 line like Claude Code */
function formatToolResult(toolName: string, result: string): string[] {
  if (!result || result === "(no output)") return ["Done"];
  const totalLines = result.split("\n").length;

  switch (toolName) {
    case "Bash": {
      if (result.includes("Exit code:")) return [result.split("\n").find(l => l.includes("Exit code:")) ?? "Done"];
      const firstLine = result.split("\n").find(l => l.trim()) ?? "Done";
      return totalLines > 1 ? [`${shortPath(firstLine).slice(0, 70)}… +${totalLines - 1} lines`] : [shortPath(firstLine).slice(0, 80)];
    }
    case "Read":
      return [`Read ${totalLines} lines`];
    case "Edit":
      return [result.includes("Successfully") ? shortPath(result.split("\n")[0]).slice(0, 80) : `Edited (${totalLines} lines changed)`];
    case "Write":
      return [shortPath(result.split("\n").filter(l => l.trim()).join(" ")).slice(0, 80)];
    case "Glob":
      return [`Found ${result.split("\n").filter(l => l.trim()).length} files`];
    case "Grep":
      if (result.includes("No matches")) return ["No matches found"];
      return [`${result.split("\n").filter(l => l.trim()).length} matches`];
    default:
      return [shortPath(result.split("\n")[0] ?? "Done").slice(0, 70)];
  }
}

function ThinkingBlock({ text }: { text: string }) {
  const lines = text.split("\n").filter(l => l.trim());
  const preview = lines.slice(0, 3);
  const hasMore = lines.length > 3;

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box>
        <Text dimColor color="magenta">{"  "}Thinking...</Text>
      </Box>
      {preview.map((line, i) => (
        <Box key={i}>
          <Text dimColor>{"  "}{CONN} {line.slice(0, 120)}</Text>
        </Box>
      ))}
      {hasMore && (
        <Box>
          <Text dimColor>{"  "}{CONN} ... +{lines.length - 3} more lines</Text>
        </Box>
      )}
    </Box>
  );
}

function MessageView({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return <Box marginTop={1}><Text color="cyan" bold>{PROMPT} </Text><Text>{msg.content}</Text></Box>;
  }
  if (msg.role === "system") {
    return <Box marginTop={1}><Text dimColor>{msg.content}</Text></Box>;
  }
  // Assistant — render markdown, show tools, thinking, stable duration verb
  const formattedContent = msg.content && msg.content !== "(no response)"
    ? renderMarkdown(msg.content)
    : null;

  return (
    <Box flexDirection="column" marginTop={0}>
      {/* Thinking block — shown above response text, dimmed and collapsible */}
      {msg.thinking && <ThinkingBlock text={msg.thinking} />}
      {/* Tool calls (shown as they happen) */}
      {msg.tools?.map((t) => <ToolItem key={t.id} tool={t} />)}
      {/* Then the text response — ANSI-formatted via renderMarkdown */}
      {formattedContent && (
        <Box>
          <Text>{formattedContent}</Text>
        </Box>
      )}
      {/* Duration — verb is fixed at creation, NOT random per render */}
      {msg.durationMs != null && msg.durationMs > 1000 && msg.durationVerb && (
        <Box marginTop={1}>
          <Text dimColor>{msg.durationVerb} for {fmtDur(msg.durationMs)}</Text>
        </Box>
      )}
    </Box>
  );
}

function StatusBar({ model, mode, cost, tokens, agentName, teamName, classification, bgTaskCount, customStatusLine }: {
  model: string; mode: string; cost: number; tokens: number;
  agentName?: string; teamName?: string; classification?: PromptClassification | null;
  bgTaskCount?: number; customStatusLine?: string | null;
}) {
  // If a custom status line command produced output, use that instead
  if (customStatusLine) {
    return <Box><Text dimColor>{customStatusLine}</Text></Box>;
  }

  const teamLabel = agentName && teamName ? ` \u00B7 ${agentName}@${teamName}` : "";
  const intentLabel = classification && classification.intent !== "general" ? ` \u00B7 [${classification.intent}]` : "";
  const bgLabel = bgTaskCount && bgTaskCount > 0 ? ` \u00B7 ${bgTaskCount} background task${bgTaskCount > 1 ? "s" : ""}` : "";
  return <Box><Text dimColor>{model} \u00B7 {mode} \u00B7 ${cost.toFixed(4)} \u00B7 {fmtTok(tokens)}{teamLabel}{intentLabel}{bgLabel}</Text></Box>;
}

// ── Main App ───────────────────────────────────────────────────────

function App({ model, mode, dangerouslySkipPermissions, initialPrompt, resumedSession, mcpToolHandlers, agentId, agentName, teamName }: {
  model: string; mode: string; dangerouslySkipPermissions?: boolean; initialPrompt?: string;
  resumedSession?: { session: Session; history: ApiMessage[]; chatMessages: ChatMessage[] };
  mcpToolHandlers?: ToolHandler[];
  agentId?: string; agentName?: string; teamName?: string;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [msgs, setMsgs] = useState<ChatMessage[]>(resumedSession?.chatMessages ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [cost, setCost] = useState(0);
  const [tokens, setTokens] = useState(0);
  const [history, setHistory] = useState<ApiMessage[]>(resumedSession?.history ?? []);
  const [activeTools, setActiveTools] = useState<ToolDisplay[]>([]);
  const [sessionRef] = useState<{ current: Session }>(() => ({
    current: resumedSession?.session ?? createSession(process.cwd(), { model }),
  }));
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const activeToolsRef = React.useRef<ToolDisplay[]>([]);
  const abortRef = React.useRef<AbortController | null>(null);
  // Keep ref in sync with state (so closures always get latest)
  activeToolsRef.current = activeTools;
  const _rows = stdout?.rows ?? 24;
  const [slashSelected, setSlashSelected] = useState(0);
  const [lastClassification, setLastClassification] = useState<PromptClassification | null>(null);
  const [bgTasks, setBgTasks] = useState<BackgroundTask[]>([]);

  // ── Build ThinkingConfig from settings ──
  const appSettings = getSettings();

  // ── Custom status line command ──
  const statusLineConfig = (appSettings as any).statusLine as { type: "command"; command: string; padding?: number } | undefined;
  const customStatusLine = useCustomStatusLine(statusLineConfig, { model, cost, tokens });

  // ── Background task polling (every 1s) ──
  useEffect(() => {
    const poll = () => {
      const running = getRunningTasks();
      const recent = getRecentlyCompletedTasks(5000);
      const all = [...running, ...recent];
      setBgTasks(all);
    };
    poll(); // immediate first poll
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, []);
  const thinkingConfig: ThinkingConfig = (() => {
    if (appSettings.thinking?.enabled) {
      return appSettings.thinking.budgetTokens
        ? { type: "enabled" as const, budget_tokens: appSettings.thinking.budgetTokens }
        : { type: "enabled" as const };
    }
    if (appSettings.alwaysThinkingEnabled) {
      return { type: "enabled" as const };
    }
    return { type: "disabled" as const };
  })();
  const thinkingEnabled = thinkingConfig.type !== "disabled";

  // ── Session lifecycle: track current session ID globally ──
  const isTeamMode = !!(agentId && teamName);
  useEffect(() => {
    setCurrentSessionId(sessionRef.current.id);
    // Fire SessionStart hook (non-blocking — errors logged but don't prevent startup)
    executeHooks("SessionStart").catch(() => {});

    // ── Team registration: join team when agent flags are set ──
    if (isTeamMode) {
      try {
        // Create team if it doesn't exist yet
        if (!getTeam(teamName!)) {
          createTeam(teamName!);
        }
        // Register this agent as a team member
        addTeamMember(teamName!, {
          name: agentName ?? agentId!,
          agentId: agentId,
          role: "agent",
          status: "active",
          currentTask: initialPrompt?.slice(0, 80),
        });
      } catch { /* team registration is non-blocking */ }
    }

    // Fire Stop hook on unmount (app exit) + mark agent offline
    return () => {
      if (isTeamMode) {
        try { updateMemberStatus(teamName!, agentName ?? agentId!, "offline"); } catch {}
      }
      executeHooks("Stop").catch(() => {});
    };
  }, []); // eslint-disable-line

  // ── Slash command autocomplete ────────────────────────────
  const allCommands = getAllSlashCommands();
  const showSlashMenu = input.startsWith("/") && !busy;
  const slashFilter = input.slice(1).toLowerCase();
  const filteredCommands = showSlashMenu
    ? allCommands.filter(c => c.name.toLowerCase().startsWith(slashFilter)).slice(0, 8)
    : [];

  // ── Permission dialog state ──────────────────────────────
  const [permissionPending, setPermissionPending] = useState<{
    toolName: string; summary: string;
    resolve: (decision: "allow" | "deny" | "always") => void;
  } | null>(null);

  // Permission request callback — creates a Promise that blocks until user responds
  const requestPermission = useCallback((toolName: string, summary: string): Promise<"allow" | "deny" | "always"> => {
    return new Promise((resolve) => {
      setPermissionPending({ toolName, summary, resolve });
    });
  }, []);

  // Tools the user has pressed "a" (always) for — auto-allow without prompting
  const [alwaysAllowedTools] = useState<Set<string>>(() => new Set());

  // Handle permission dialog key presses
  useInput((ch) => {
    if (!permissionPending) return;
    if (ch === "y" || ch === "Y") { permissionPending.resolve("allow"); setPermissionPending(null); }
    else if (ch === "n" || ch === "N") { permissionPending.resolve("deny"); setPermissionPending(null); }
    else if (ch === "a" || ch === "A") { permissionPending.resolve("always"); setPermissionPending(null); }
  }, { isActive: !!permissionPending });

  // Tool UI callbacks
  const onToolStart = useCallback((id: string, name: string, summary: string) => {
    setActiveTools((prev) => [...prev, { id, name, summary, status: "running" }]);
  }, []);

  const onToolEnd = useCallback((id: string, result: string, error?: string, durationMs?: number) => {
    // Find tool data from the ref (always current)
    const tool = activeToolsRef.current.find(t => t.id === id);
    if (!tool) return;

    const completed: ToolDisplay = {
      ...tool,
      status: (error ? "error" : "done") as "error" | "done",
      result, error, durationMs,
    };

    // Commit completed tool to Static (permanent) and remove from dynamic zone.
    // Both updates are batched by React 18 into one render — no duplication.
    setMsgs(prev => [...prev, {
      id: `td-${id}`, role: "assistant" as const, content: "",
      timestamp: Date.now(), tools: [completed],
    }]);
    setActiveTools(prev => prev.filter(t => t.id !== id));
  }, []);

  const submit = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;

    // Slash commands
    if (isSlashCommand(text)) {
      const r = await executeSlashCommand(text);

      // Handle /checkpoint — save current conversation state
      if (r.action === "checkpoint") {
        const label = r.data as string | undefined;
        try {
          const cp = saveCheckpoint(sessionRef.current.id, history, label);
          setMsgs((p) => [...p, { id: `s${Date.now()}`, role: "system", content: `Checkpoint saved: "${cp.label}" (${cp.messageCount} messages) id:${cp.id.slice(0, 8)}`, timestamp: Date.now() }]);
        } catch (e) {
          setMsgs((p) => [...p, { id: `s${Date.now()}`, role: "system", content: `Failed to save checkpoint: ${e instanceof Error ? e.message : String(e)}`, timestamp: Date.now() }]);
        }
        return;
      }

      // Handle /restore — restore conversation state from a checkpoint
      if (r.action === "restore" && r.data) {
        const cp = r.data as ConversationCheckpoint;
        // Reset history to the checkpoint's messages
        setHistory(cp.messages.filter((m) => m.role === "user" || m.role === "assistant"));
        // Rebuild chat messages for display from the checkpoint
        const restoredChatMsgs: ChatMessage[] = cp.messages.map((m, i) => ({
          id: `rc${i}`,
          role: m.role as "user" | "assistant" | "system",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          timestamp: Date.now() - (cp.messages.length - i) * 1000,
        }));
        setMsgs([
          ...restoredChatMsgs,
          { id: `s${Date.now()}`, role: "system", content: r.output ?? `Restored checkpoint "${cp.label}"`, timestamp: Date.now() },
        ]);
        return;
      }

      // Handle /compact — summarize conversation, then clear and keep summary
      if (r.action === "compact") {
        if (history.length === 0) {
          setMsgs((p) => [...p, { id: `s${Date.now()}`, role: "system", content: "Nothing to compact — conversation is empty.", timestamp: Date.now() }]);
          return;
        }

        setMsgs((p) => [...p, { id: `s${Date.now()}`, role: "system", content: "Compacting conversation...", timestamp: Date.now() }]);

        try {
          const client = getApiClient();
          const customInstructions = r.data as string | undefined;
          const summaryPrompt = customInstructions
            ? `Summarize the conversation so far in 2-3 concise sentences, focusing on: ${customInstructions}. Include key decisions, files changed, and current state.`
            : "Summarize the conversation so far in 2-3 concise sentences. Include key decisions, files changed, and current state of the work.";

          const summaryResponse = await client.createMessage({
            model,
            messages: [
              ...history,
              { role: "user", content: summaryPrompt },
            ],
            maxTokens: 1024,
          });

          const summaryText = summaryResponse.content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("\n")
            .trim() || "Conversation compacted.";

          // Clear everything and start fresh with summary as context
          const summarySystemMsg: ChatMessage = {
            id: `compact${Date.now()}`,
            role: "system",
            content: `[Compacted conversation summary]\n${summaryText}`,
            timestamp: Date.now(),
          };

          setMsgs([summarySystemMsg]);
          setHistory([
            { role: "user", content: "Here is a summary of our conversation so far:\n" + summaryText },
            { role: "assistant", content: "Understood. I have the context from our previous conversation. How can I help you continue?" },
          ]);
        } catch (e) {
          setMsgs((p) => [...p, { id: `e${Date.now()}`, role: "system", content: `Failed to compact: ${e instanceof Error ? e.message : String(e)}`, timestamp: Date.now() }]);
        }
        return;
      }

      if (r.output) setMsgs((p) => [...p, { id: `s${Date.now()}`, role: "system", content: r.output!, timestamp: Date.now() }]);
      if (r.action === "exit") exit();
      if (r.action === "clear") { setMsgs([]); setHistory([]); }
      return;
    }

    // Fire UserPromptSubmit hook — if blocked, show message and abort
    try {
      const hookResult = await executeHooks("UserPromptSubmit");
      if (hookResult.blocked) {
        setMsgs((p) => [...p, { id: `h${Date.now()}`, role: "system", content: `Blocked by hook: ${hookResult.message ?? "UserPromptSubmit hook rejected the message"}`, timestamp: Date.now() }]);
        return;
      }
    } catch { /* hook failure is non-blocking */ }

    // Add user message
    setMsgs((p) => [...p, { id: `u${Date.now()}`, role: "user", content: text, timestamp: Date.now() }]);
    const newHistory: ApiMessage[] = [...history, { role: "user", content: text }];
    setHistory(newHistory);
    setBusy(true);
    setStreaming("");
    setThinkingText("");
    setActiveTools([]);

    // Persist user message to DB
    try { addMessage(sessionRef.current.id, "user", text); } catch { /* silent */ }

    const t0 = performance.now();

    try {
      const toolSplit = createToolHandlers(mcpToolHandlers);
      const permCtx = createDefaultPermissionContext(getSettings());
      const toolStartTimes = new Map<string, number>();

      // Store deferred tool schemas in registry so ToolSearch can access them
      setDeferredToolSchemas([...toolSplit.deferredSchemas.values()]);

      // ── Classify prompt to filter tools by intent ──
      const classification = classifyPrompt(text);
      setLastClassification(classification);

      // All builtin tool names (immediate + deferred) — used for classification filtering
      // All tools are sent to the API so the model CAN call them; deferred tools are
      // just guided via the system prompt to be discovered through ToolSearch first
      const allBuiltinToolNames = new Set(toolSplit.all.map(h => h.name));

      const toolHandlers = filterToolsByClassification(toolSplit.all, classification, allBuiltinToolNames);

      // Log classification for telemetry
      try {
        dbRun(
          "INSERT INTO audit_log (tool_name, input_summary, result_summary, duration_ms, was_allowed) VALUES (?, ?, ?, ?, 1)",
          ["__classifier", text.slice(0, 200), `${classification.intent}: ${classification.reason} (${toolHandlers.length}/${toolSplit.all.length} tools, ${toolSplit.deferredInfo.length} deferred)`, 0],
        );
      } catch { /* silent */ }

      // Resolve tool prompts only for immediate (non-deferred) tools
      // Deferred tools are listed by name in the system prompt instead
      const immediateBuiltinTools = [
        bashTool, readTool, editTool, writeTool, globTool, grepTool,
        agentTool, toolSearchTool, skillTool,
      ].filter(t => !t.shouldDefer);
      const toolPrompts = await Promise.all(
        immediateBuiltinTools.map(async (t) => ({ name: t.name, prompt: await t.prompt() })),
      );

      // Create AbortController for this turn — enables in-stream interrupt
      const turnAbort = new AbortController();
      abortRef.current = turnAbort;

      // Run the REAL agent loop with tool execution
      const result = await runAgentLoop(
        newHistory,
        {
          signal: turnAbort.signal,
          client: getApiClient(),
          systemPrompt: buildSystemPrompt({
            projectDir: process.cwd(),
            model,
            permissionMode: mode,
            tools: toolPrompts,
            deferredTools: toolSplit.deferredInfo,
          }),
          tools: toolHandlers,
          model,
          thinkingConfig,
          permissionContext: permCtx,
          maxTurns: 10,
          agentId,
          onPermissionCheck: async (toolName: string, toolInput: Record<string, unknown>): Promise<PermissionResult> => {
            // Fire PreToolUse hook — if blocked, reject the tool use
            try {
              const preHook = await executeHooks("PreToolUse", { toolName });
              if (preHook.blocked) {
                return { behavior: "deny", message: preHook.message ?? `Blocked by PreToolUse hook for ${toolName}` };
              }
            } catch { /* hook failure is non-blocking */ }

            // Bypass permissions mode or --dangerously-skip-permissions: allow everything
            if (dangerouslySkipPermissions || permCtx.mode === "bypassPermissions") {
              return { behavior: "allow" };
            }

            // Check permission rules (explicit allow/deny lists, mode-based rules)
            const ruleResult = checkToolPermission(toolName, toolInput, permCtx);
            if (ruleResult.behavior === "allow" || ruleResult.behavior === "deny") {
              return ruleResult;
            }

            // Read-only tools: auto-allow without prompting
            const handler = toolHandlers.find(t => t.name === toolName);
            if (handler?.isReadOnly) {
              return { behavior: "allow" };
            }

            // User previously pressed "a" (always) for this tool: auto-allow
            if (alwaysAllowedTools.has(toolName)) {
              return { behavior: "allow" };
            }

            // Write tool — show permission dialog and wait for y/n/a
            const summary = toolSummary(toolName, toolInput);
            const decision = await requestPermission(toolName, summary);

            if (decision === "always") {
              alwaysAllowedTools.add(toolName);
              return { behavior: "allow" };
            }
            return { behavior: decision === "allow" ? "allow" : "deny" };
          },
          onTextDelta: (text) => {
            // Only show streaming when no tools are running
            // (completed tools are removed from activeTools, so length===0 means all done)
            if (activeToolsRef.current.length === 0) {
              setStreaming((prev) => prev + text);
            }
          },
          onThinkingDelta: (thinking) => {
            if (thinkingEnabled) {
              setThinkingText((prev) => prev + thinking);
            }
          },
          onToolUseStart: (name, id, toolInput) => {
            // Clear streaming when a tool starts — switch to tool display mode
            setStreaming("");
            toolStartTimes.set(id, performance.now());
            onToolStart(id, name, toolSummary(name, toolInput));
          },
          onToolUseEnd: (name, id, toolResult) => {
            const isErr = toolResult.isError || !!toolResult.error;
            const startTime = toolStartTimes.get(id);
            const dur = startTime ? performance.now() - startTime : undefined;
            onToolEnd(id, String(toolResult.data ?? "").slice(0, 500), isErr ? toolResult.error : undefined, dur);
            // Fire PostToolUse hook (fire-and-forget — post-hooks don't block)
            executeHooks("PostToolUse", { toolName: name }).catch(() => {});
          },
        },
      );

      const dur = performance.now() - t0;

      // Extract final assistant text and thinking
      const lastAssistant = [...result.messages].reverse().find((m) => m.role === "assistant");
      let finalText = "";
      let finalThinking = "";
      if (lastAssistant) {
        if (typeof lastAssistant.content === "string") finalText = lastAssistant.content;
        else if (Array.isArray(lastAssistant.content)) {
          finalText = lastAssistant.content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("\n");
          finalThinking = lastAssistant.content
            .filter((b: any) => b.type === "thinking")
            .map((b: any) => b.thinking)
            .join("\n");
        }
      }

      // If we were streaming and got the same text, use streaming version
      if (!finalText && streaming) finalText = streaming;
      // Use accumulated thinking text if API didn't return thinking blocks
      if (!finalThinking && thinkingText) finalThinking = thinkingText;

      const c = estimateCost(
        { inputTokens: result.usage.totalInputTokens, outputTokens: result.usage.totalOutputTokens },
        model,
      );
      setCost((p) => p + c.totalCostUsd);
      setTokens((p) => p + result.usage.totalInputTokens + result.usage.totalOutputTokens);

      // Persist assistant response to DB
      try {
        const assistantText = finalText || streaming || "";
        addMessage(sessionRef.current.id, "assistant", assistantText, {
          tokensIn: result.usage.totalInputTokens,
          tokensOut: result.usage.totalOutputTokens,
          costUsd: c.totalCostUsd,
          durationMs: dur,
        });
        updateSession(sessionRef.current, result.messages, { model });
      } catch { /* silent — don't break the UI if DB write fails */ }

      // Tools were already committed to Static individually via onToolEnd.
      // Only add the text response here (no tools — prevents duplication).
      const verb = VERBS[Math.floor(Math.random() * VERBS.length)];
      const textContent = finalText || streaming || "";

      if (textContent && textContent !== "(no response)") {
        setMsgs((p) => [...p, {
          id: `a${Date.now()}`, role: "assistant",
          content: textContent,
          thinking: finalThinking || undefined,
          timestamp: Date.now(),
          durationMs: dur,
          durationVerb: verb,
        }]);
      } else if (dur > 1000) {
        // No text but show duration for tool-only responses
        setMsgs((p) => [...p, {
          id: `a${Date.now()}`, role: "assistant",
          content: "",
          thinking: finalThinking || undefined,
          timestamp: Date.now(),
          durationMs: dur,
          durationVerb: verb,
        }]);
      }

      // Update conversation history for next turn
      setHistory(result.messages.filter((m) => m.role === "user" || m.role === "assistant"));
      setStreaming("");
      setThinkingText("");
      setActiveTools([]);
    } catch (err) {
      const e = err instanceof Error ? err.message : String(err);
      setMsgs((p) => [...p, { id: `e${Date.now()}`, role: "system", content: `Error: ${e}`, timestamp: Date.now() }]);
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [busy, history, model, exit, onToolStart, onToolEnd, streaming, thinkingText, activeTools]);

  // ── Process queued messages after agent finishes ──
  useEffect(() => {
    if (!busy && queuedMessages.length > 0) {
      const next = queuedMessages[0];
      setQueuedMessages((q) => q.slice(1));
      // Small delay to let the UI settle before next submission
      setTimeout(() => submit(next), 100);
    }
  }, [busy, queuedMessages]);

  useEffect(() => { if (initialPrompt) submit(initialPrompt); }, []); // eslint-disable-line

  useInput((ch, key) => {
    // Permission dialog has its own handler
    if (permissionPending) return;

    // ── While busy: typing + queue (Enter) + interrupt (Ctrl+Enter) ──
    if (busy) {
      if (key.ctrl && ch === "c") { setBusy(false); setStreaming(""); abortRef.current?.abort(); return; }
      // Ctrl+Enter: INTERRUPT — abort current turn and send message immediately
      if (key.ctrl && key.return && input.trim()) {
        const msg = input.trim();
        setInput("");
        abortRef.current?.abort();
        // Queue as first item — it'll auto-submit once the aborted turn settles
        setQueuedMessages((q) => [msg, ...q]);
        return;
      }
      // Enter: QUEUE — send after current turn finishes
      if (key.return && input.trim()) {
        setQueuedMessages((q) => [...q, input.trim()]);
        setInput("");
        return;
      }
      // Allow typing, backspace, escape even while busy
      if (key.backspace || key.delete) { setInput((p) => p.slice(0, -1)); return; }
      if (key.escape) { setInput(""); return; }
      if (!key.ctrl && !key.meta && ch) { setInput((p) => p + ch); return; }
      return;
    }

    // ── Slash autocomplete navigation ──
    if (showSlashMenu && filteredCommands.length > 0) {
      if (key.downArrow || (key.tab && !key.shift)) {
        setSlashSelected((s) => Math.min(s + 1, filteredCommands.length - 1));
        return;
      }
      if (key.upArrow || (key.tab && key.shift)) {
        setSlashSelected((s) => Math.max(s - 1, 0));
        return;
      }
      if (key.return) {
        const cmd = filteredCommands[slashSelected];
        if (cmd) { setInput(""); setSlashSelected(0); submit(`/${cmd.name}`); return; }
      }
      if (key.escape) { setInput(""); setSlashSelected(0); return; }
    }

    // ── Normal input ──
    if (key.return) { const t = input; setInput(""); setSlashSelected(0); submit(t); }
    else if (key.backspace || key.delete) { setInput((p) => p.slice(0, -1)); setSlashSelected(0); }
    else if (key.ctrl && ch === "c") exit();
    else if (key.ctrl && ch === "d") exit();
    else if (key.ctrl && ch === "l") { setMsgs([]); setHistory([]); }
    else if (key.escape) setInput("");
    else if (!key.ctrl && !key.meta && ch) setInput((p) => p + ch);
  });

  const cols = stdout?.columns ?? 80;
  const pad = 2; // left+right padding
  const sep = "─".repeat(Math.min(cols - pad, 120));
  const hasRunningTools = activeTools.some(t => t.status === "running");

  return (
    <>
      {/* ══ STATIC ZONE: completed messages scroll naturally in terminal ══ */}
      <Static items={msgs}>
        {(msg) => (
          <Box key={msg.id} flexDirection="column" paddingLeft={1} paddingRight={1}>
            <MessageView msg={msg} />
          </Box>
        )}
      </Static>

      {/* ══ DYNAMIC ZONE: only this part re-renders ══ */}
      <Box flexDirection="column" paddingLeft={1} paddingRight={1}>

        {/* ALL active tools shown sequentially while agent is working */}
        {busy && activeTools.length > 0 && (
          <Box flexDirection="column">
            {activeTools.map((t) => <ToolItem key={t.id} tool={t} />)}
          </Box>
        )}

        {/* Live thinking stream — shown while model is thinking (before text output) */}
        {busy && thinkingText && !streaming && activeTools.length === 0 && (
          <Box flexDirection="column">
            <Box>
              <SpinnerDot />
              <Text dimColor color="magenta"> Thinking...</Text>
            </Box>
            {thinkingText.split("\n").filter(l => l.trim()).slice(-3).map((line, i) => (
              <Box key={i}>
                <Text dimColor>  {CONN} {line.slice(0, 120)}</Text>
              </Box>
            ))}
          </Box>
        )}

        {/* Streaming text — show only last 3 lines */}
        {busy && streaming && (
          <Box>
            <Text>{streaming.split("\n").filter(l => l.trim()).slice(-3).join("\n").slice(-200)}</Text>
          </Box>
        )}

        {/* Spinner while thinking (no thinking text yet) */}
        {busy && !streaming && !thinkingText && activeTools.length === 0 && (
          <Box>
            <SpinnerDot />
            <Text dimColor> Thinking...</Text>
          </Box>
        )}

        {/* Spinner while tools are running (shown below tool list) */}
        {busy && hasRunningTools && (
          <Box>
            <SpinnerDot />
            <Text dimColor> Working...</Text>
          </Box>
        )}

        {/* Permission dialog — blocks agent loop until user responds */}
        {permissionPending && (
          <Box flexDirection="column" marginTop={1}>
            <Box>
              <Text color="yellow" bold>? </Text>
              <Text bold>Allow </Text>
              <Text color="cyan" bold>{permissionPending.toolName}</Text>
              {permissionPending.summary ? <Text dimColor> ({permissionPending.summary.slice(0, 60)})</Text> : null}
            </Box>
            <Box paddingLeft={2}>
              <Text dimColor>[</Text>
              <Text color="green" bold>y</Text>
              <Text dimColor>]es  [</Text>
              <Text color="red" bold>n</Text>
              <Text dimColor>]o  [</Text>
              <Text color="blue" bold>a</Text>
              <Text dimColor>]lways</Text>
            </Box>
          </Box>
        )}

        {/* ── Background task list (shown above input when tasks are active) ── */}
        {bgTasks.length > 0 && (
          <BackgroundTaskList tasks={bgTasks} />
        )}

        {/* ── Separator + Input + Autocomplete + Status ── */}
        <Box flexDirection="column">
          <Text dimColor>{sep}</Text>
        <Box>
          <Text color="cyan" bold>{PROMPT} </Text>
          {input.startsWith("/") ? <Text color="magenta">{input}</Text> : <Text>{input}</Text>}
          <Text color="gray">▎</Text>
        </Box>
        {busy && input.trim() && (
          <Box>
            <Text dimColor>  Enter: queue · Ctrl+Enter: interrupt and send now</Text>
          </Box>
        )}
        {queuedMessages.length > 0 && (
          <Box>
            <Text color="yellow">  {queuedMessages.length} queued</Text>
            <Text dimColor> — will send after current response</Text>
          </Box>
        )}

        {/* Slash command autocomplete dropdown */}
        {showSlashMenu && filteredCommands.length > 0 && (
          <Box flexDirection="column" paddingLeft={2}>
            {filteredCommands.map((cmd, i) => (
              <Box key={cmd.name}>
                <Text color={i === slashSelected ? "cyan" : undefined} bold={i === slashSelected}>
                  {i === slashSelected ? "▸ " : "  "}
                </Text>
                <Text color={i === slashSelected ? "cyan" : "blue"}>/{cmd.name.padEnd(16)}</Text>
                <Text dimColor> {cmd.description}</Text>
              </Box>
            ))}
          </Box>
        )}

        <Text dimColor>{sep}</Text>
        <StatusBar model={model} mode={mode} cost={cost} tokens={tokens} agentName={agentName ?? agentId} teamName={teamName} classification={lastClassification} bgTaskCount={bgTasks.filter(t => t.status === "running").length} customStatusLine={customStatusLine} />
        </Box>
      </Box>
    </>
  );
}

// ── Launch ─────────────────────────────────────────────────────────

export function launchInkApp(opts: {
  model?: string; mode?: string; dangerouslySkipPermissions?: boolean; initialPrompt?: string;
  resume?: string; // session ID or "last" to resume the most recent session
  agentId?: string; agentName?: string; teamName?: string;
} = {}): void {
  const settings = getSettings();
  const model = opts.model ?? settings.model ?? "sonnet";
  const mode = opts.mode ?? "default";

  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.log(`\x1b[1m@hasna/coders\x1b[0m v${VERSION}\n\x1b[33mNo API key found.\x1b[0m Set ANTHROPIC_API_KEY or run: coders auth login\n`);
    process.exit(1);
  }

  // ── Resume session if requested ──────────────────────────
  let resumedSession: { session: Session; history: ApiMessage[]; chatMessages: ChatMessage[] } | undefined;

  if (opts.resume) {
    let sessionId = opts.resume;
    if (sessionId === "last") {
      const recent = listRecentSessions(1);
      if (recent.length > 0) {
        sessionId = recent[0].id;
      } else {
        console.log("\x1b[33mNo previous sessions found.\x1b[0m Starting a new session.\n");
        sessionId = "";
      }
    }

    if (sessionId) {
      const loaded = loadSession(sessionId);
      if (loaded) {
        // Rebuild API history from loaded messages
        const apiHistory: ApiMessage[] = loaded.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        // Rebuild chat messages for display
        const chatMessages: ChatMessage[] = loaded.messages.map((m, i) => ({
          id: `r${i}`,
          role: m.role as "user" | "assistant" | "system",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          timestamp: Date.now() - (loaded.messages.length - i) * 1000,
        }));

        resumedSession = { session: loaded, history: apiHistory, chatMessages };
        console.log(`\x1b[2mResuming session ${sessionId.slice(0, 8)}... (${loaded.messages.length} messages)\x1b[0m`);
      } else {
        console.log(`\x1b[33mSession ${sessionId.slice(0, 8)}... not found.\x1b[0m Starting a new session.\n`);
      }
    }
  }

  // ── Connect MCP servers before launching the UI ──────────
  // This runs async but we start the render immediately.
  // MCP tools become available once connection completes.
  const mcpReady = initMcpServers(process.cwd()).then((result) => {
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        // Log to stderr (will be suppressed by Ink, but captured in debug logs)
        process.stderr.write(`${err}\n`);
      }
    }
    const totalTools = result.handlers.length;
    if (totalTools > 0) {
      const serverCount = result.connected.size;
      process.stderr.write(`\x1b[2m[mcp] Connected ${serverCount} server(s), ${totalTools} tool(s) available\x1b[0m\n`);
    }
    return result.handlers;
  }).catch((err) => {
    process.stderr.write(`\x1b[33m[mcp] Init failed: ${err instanceof Error ? err.message : String(err)}\x1b[0m\n`);
    return [] as ToolHandler[];
  });

  // Wait for MCP init before rendering so tools are available from the first turn
  mcpReady.then((mcpToolHandlers) => {
    // Suppress console.warn/error — they corrupt the Ink UI
    console.warn = () => {};
    console.error = () => {};

    const { waitUntilExit } = render(
      <App model={model} mode={mode} dangerouslySkipPermissions={opts.dangerouslySkipPermissions} initialPrompt={opts.initialPrompt} resumedSession={resumedSession} mcpToolHandlers={mcpToolHandlers.length > 0 ? mcpToolHandlers : undefined} agentId={opts.agentId} agentName={opts.agentName} teamName={opts.teamName} />,
      { exitOnCtrlC: false },
    );
    waitUntilExit().then(() => {
      // Disconnect all MCP servers on exit
      disconnectAllMcpServers().catch(() => {});
      process.exit(0);
    });
  });
}

// ── Headless ───────────────────────────────────────────────────────

export async function runHeadless(opts: { model: string; prompt: string; systemPrompt?: string; outputFormat: "text" | "json" | "stream-json" }): Promise<void> {
  const client = getApiClient();
  if (opts.outputFormat === "stream-json") {
    for await (const item of client.streamMessage({ model: opts.model, messages: [{ role: "user", content: opts.prompt }], systemPrompt: opts.systemPrompt, stream: true })) {
      process.stdout.write(JSON.stringify(item.event) + "\n");
    }
  } else {
    const r = await client.createMessage({ model: opts.model, messages: [{ role: "user", content: opts.prompt }], systemPrompt: opts.systemPrompt });
    if (opts.outputFormat === "json") process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    else { for (const b of r.content) if ("text" in b) process.stdout.write(b.text as string); process.stdout.write("\n"); }
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function fmtDur(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtTok(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1e6) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1e6).toFixed(2)}M`;
}
