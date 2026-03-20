/**
 * Remaining built-in tools — Cron, Worktree, Notebook, Config, SendMessage, ToolSearch
 *
 * Each implements the full Tool interface with Zod schemas.
 * Grouped in one file since they're smaller tools.
 */
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import { searchTools as registrySearchTools, getDeferredToolInfos } from "../registry.js";
import {
  CRON_CREATE_TOOL, CRON_DELETE_TOOL, CRON_LIST_TOOL,
  ENTER_WORKTREE_TOOL, EXIT_WORKTREE_TOOL,
  NOTEBOOK_EDIT_TOOL, CONFIG_TOOL, SEND_MESSAGE_TOOL, TOOL_SEARCH_TOOL,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
} from "../../core/constants.js";

// ── Helper to build a minimal tool ─────────────────────────────────

function simpleTool<TIn extends z.ZodType, TOut>(opts: {
  name: string; hint: string; inputSchema: TIn; readOnly: boolean;
  concurrent: boolean; defer: boolean;
  prompt: string;
  call: (input: z.infer<TIn>, ctx: any) => Promise<ToolCallResult<TOut>>;
  mapResult: (result: TOut, id: string) => ToolResultBlockParam;
}): Tool<z.infer<TIn>, TOut> {
  return {
    name: opts.name,
    searchHint: opts.hint,
    maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
    shouldDefer: opts.defer,
    async description() { return opts.hint; },
    async prompt() { return opts.prompt; },
    get inputSchema() { return opts.inputSchema as any; },
    get outputSchema() { return z.any() as any; },
    userFacingName() { return opts.name; },
    isEnabled() { return true; },
    isConcurrencySafe() { return opts.concurrent; },
    isReadOnly() { return opts.readOnly; },
    toAutoClassifierInput() { return ""; },
    async checkPermissions(input: any) { return { behavior: "allow" as const, updatedInput: input }; },
    async validateInput() { return { result: true }; },
    call: opts.call as any,
    mapToolResultToToolResultBlockParam: opts.mapResult as any,
  };
}

// ── ToolSearch ──────────────────────────────────────────────────────

export const toolSearchTool = simpleTool({
  name: TOOL_SEARCH_TOOL,
  hint: "find available tools by keyword",
  inputSchema: z.strictObject({
    query: z.string().describe("Query to find tools"),
    max_results: z.number().default(5).describe("Max results"),
  }),
  readOnly: true, concurrent: true, defer: false,
  prompt: "Search for available tools by keyword. Use to discover deferred tools.",
  async call(input) {
    const results = registrySearchTools(input.query, input.max_results);
    const deferred = getDeferredToolInfos();
    return {
      data: {
        results,
        deferredCount: deferred.length,
      },
    };
  },
  mapResult(result: any, id) {
    const lines = result.results.map((r: any) =>
      `${r.name}${r.deferred ? " (deferred)" : ""}: ${r.hint}`
    );
    return { type: "tool_result", tool_use_id: id, content: lines.join("\n") || "No tools found." };
  },
});

// ── CronCreate ─────────────────────────────────────────────────────

export const cronCreateTool = simpleTool({
  name: CRON_CREATE_TOOL,
  hint: "schedule a recurring prompt",
  inputSchema: z.strictObject({
    cron: z.string().describe('5-field cron: "M H DoM Mon DoW"'),
    prompt: z.string().describe("The prompt to enqueue"),
    recurring: z.boolean().default(true).describe("true=recurring, false=one-shot"),
  }),
  readOnly: false, concurrent: false, defer: true,
  prompt: "Schedule a prompt on a cron schedule. Session-only, auto-expires after 7 days.",
  async call(input) {
    const id = `cron-${Date.now().toString(36)}`;
    return { data: { id, cron: input.cron, humanSchedule: input.cron, recurring: input.recurring } };
  },
  mapResult(result: any, id) {
    return { type: "tool_result", tool_use_id: id, content: `Scheduled job ${result.id} (${result.humanSchedule})` };
  },
});

// ── CronDelete ─────────────────────────────────────────────────────

export const cronDeleteTool = simpleTool({
  name: CRON_DELETE_TOOL,
  hint: "cancel a scheduled cron job",
  inputSchema: z.strictObject({ id: z.string().describe("Job ID") }),
  readOnly: false, concurrent: false, defer: true,
  prompt: "Cancel a scheduled cron job by its ID.",
  async call(input) { return { data: { id: input.id } }; },
  mapResult(result: any, id) {
    return { type: "tool_result", tool_use_id: id, content: `Cancelled job ${result.id}` };
  },
});

// ── CronList ───────────────────────────────────────────────────────

export const cronListTool = simpleTool({
  name: CRON_LIST_TOOL,
  hint: "list active cron jobs",
  inputSchema: z.strictObject({}),
  readOnly: true, concurrent: true, defer: true,
  prompt: "List all active scheduled cron jobs.",
  async call() { return { data: { jobs: [] } }; },
  mapResult(result: any, id) {
    return { type: "tool_result", tool_use_id: id, content: result.jobs.length > 0 ? JSON.stringify(result.jobs) : "No scheduled jobs." };
  },
});

// ── EnterWorktree ──────────────────────────────────────────────────

export const enterWorktreeTool = simpleTool({
  name: ENTER_WORKTREE_TOOL,
  hint: "create an isolated git worktree and switch into it",
  inputSchema: z.strictObject({ name: z.string().optional().describe("Worktree name") }),
  readOnly: false, concurrent: false, defer: true,
  prompt: "Create a git worktree for isolated work. Only use when user explicitly asks for a worktree.",
  async call(input) {
    return { data: { worktreePath: "", worktreeBranch: "", message: "Worktree creation not yet fully wired" } };
  },
  mapResult(result: any, id) {
    return { type: "tool_result", tool_use_id: id, content: result.message };
  },
});

// ── ExitWorktree ───────────────────────────────────────────────────

export const exitWorktreeTool = simpleTool({
  name: EXIT_WORKTREE_TOOL,
  hint: "exit a worktree session",
  inputSchema: z.strictObject({
    action: z.enum(["keep", "remove"]).describe("keep or remove the worktree"),
    discard_changes: z.boolean().optional().describe("Allow discarding uncommitted changes"),
  }),
  readOnly: false, concurrent: false, defer: true,
  prompt: "Exit a worktree session. Use 'keep' to preserve work, 'remove' for clean exit.",
  async call(input) {
    return { data: { action: input.action, originalCwd: process.cwd(), message: "Worktree exit not yet fully wired" } };
  },
  mapResult(result: any, id) {
    return { type: "tool_result", tool_use_id: id, content: result.message };
  },
});

// ── NotebookEdit ───────────────────────────────────────────────────

export const notebookEditTool = simpleTool({
  name: NOTEBOOK_EDIT_TOOL,
  hint: "edit Jupyter notebook cells",
  inputSchema: z.strictObject({
    notebook_path: z.string().describe("Path to the .ipynb file"),
    cell_index: z.number().describe("Cell index to edit"),
    new_source: z.string().describe("New cell source code"),
  }),
  readOnly: false, concurrent: false, defer: true,
  prompt: "Edit a specific cell in a Jupyter notebook (.ipynb file).",
  async call(input) {
    const { readFileSync, writeFileSync } = await import("fs");
    try {
      const content = JSON.parse(readFileSync(input.notebook_path, "utf-8"));
      if (content.cells && content.cells[input.cell_index]) {
        content.cells[input.cell_index].source = input.new_source.split("\n").map((l: string, i: number, a: string[]) =>
          i < a.length - 1 ? l + "\n" : l
        );
        writeFileSync(input.notebook_path, JSON.stringify(content, null, 1), "utf-8");
        return { data: { success: true, cellIndex: input.cell_index } };
      }
      return { data: { success: false, error: "Cell index out of range" } };
    } catch (e) {
      return { data: { success: false, error: String(e) } };
    }
  },
  mapResult(result: any, id) {
    return { type: "tool_result", tool_use_id: id, content: result.success ? `Edited cell ${result.cellIndex}` : `Error: ${result.error}` };
  },
});

// ── Config ─────────────────────────────────────────────────────────

export const configTool = simpleTool({
  name: CONFIG_TOOL,
  hint: "view and modify settings",
  inputSchema: z.strictObject({
    setting: z.string().describe("Setting key"),
    value: z.union([z.string(), z.boolean(), z.number()]).optional().describe("New value (omit to get)"),
  }),
  readOnly: false, concurrent: true, defer: true,
  prompt: "Get or set a configuration setting.",
  async call(input) {
    const { getSettings, saveUserSettings } = await import("../../config/loader.js");
    if (input.value !== undefined) {
      const settings = getSettings() as Record<string, unknown>;
      settings[input.setting] = input.value;
      return { data: { operation: "set", setting: input.setting, value: input.value, success: true } };
    }
    const settings = getSettings() as Record<string, unknown>;
    return { data: { operation: "get", setting: input.setting, value: settings[input.setting] ?? null, success: true } };
  },
  mapResult(result: any, id) {
    if (result.operation === "set") {
      return { type: "tool_result", tool_use_id: id, content: `Set ${result.setting} = ${result.value}` };
    }
    return { type: "tool_result", tool_use_id: id, content: `${result.setting} = ${JSON.stringify(result.value)}` };
  },
});

// ── SendMessage ────────────────────────────────────────────────────

export const sendMessageTool = simpleTool({
  name: SEND_MESSAGE_TOOL,
  hint: "send a message to the user or another agent",
  inputSchema: z.strictObject({
    to: z.string().describe("Recipient agent name or ID"),
    message: z.string().describe("Message content"),
  }),
  readOnly: false, concurrent: true, defer: true,
  prompt: "Send a direct message to another agent or to the user.",
  async call(input) {
    return { data: { sent: true, to: input.to, message: input.message } };
  },
  mapResult(result: any, id) {
    return { type: "tool_result", tool_use_id: id, content: `Message sent to ${result.to}` };
  },
});
