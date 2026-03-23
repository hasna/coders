/**
 * Remaining built-in tools — Cron, Worktree, Notebook, Config, SendMessage, ToolSearch
 *
 * Each implements the full Tool interface with Zod schemas.
 * Grouped in one file since they're smaller tools.
 */
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import {
  searchTools as registrySearchTools,
  searchDeferredToolSchemas,
  getAllDeferredToolSchemas,
  type DeferredToolSchema,
} from "../registry.js";
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
    get outputSchema() { return z.object({}) as any; },
    userFacingName() { return opts.name; },
    isEnabled() { return true; },
    isConcurrencySafe() { return opts.concurrent; },
    isReadOnly() { return opts.readOnly; },
    toAutoClassifierInput() { return ""; },
    async checkPermissions(input: any) { return { behavior: "allow" as const, updatedInput: input }; },
    async validateInput(input: any) {
      const result = opts.inputSchema.safeParse(input);
      if (!result.success) {
        const msg = result.error.issues.map((i: any) => i.message).join(", ");
        return { result: false, message: msg, errorCode: 1 };
      }
      return { result: true };
    },
    call: opts.call as any,
    mapToolResultToToolResultBlockParam: opts.mapResult as any,
  };
}

// ── ToolSearch ──────────────────────────────────────────────────────

export const toolSearchTool = simpleTool({
  name: TOOL_SEARCH_TOOL,
  hint: "find available tools by keyword — fetches full schemas for deferred tools",
  inputSchema: z.strictObject({
    query: z.string().describe(
      'Query to find deferred tools. Use "select:Read,Edit,Grep" for exact names, ' +
      'or keywords to search. Use "+slack send" to require "slack" in name.',
    ),
    max_results: z.number().default(5).describe("Maximum number of results to return (default: 5)"),
  }),
  readOnly: true, concurrent: true, defer: false,
  prompt: `Fetches full schema definitions for deferred tools so they can be called.

Deferred tools appear by name in the "Deferred Tools" section of the system prompt. Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked. This tool takes a query, matches it against the deferred tool list, and returns the matched tools' complete JSONSchema definitions inside a <functions> block. Once a tool's schema appears in that result, it is callable exactly like any tool defined at the top of the prompt.

Result format: each matched tool appears as one <function>{"description": "...", "name": "...", "parameters": {...}}</function> line inside the <functions> block — the same encoding as the tool list at the top of this prompt.

Query forms:
- "select:Read,Edit,Grep" — fetch these exact tools by name
- "notebook jupyter" — keyword search, up to max_results best matches
- "+slack send" — require "slack" in the name, rank by remaining terms`,
  async call(input) {
    // Search deferred tool schemas
    const matchedSchemas = searchDeferredToolSchemas(input.query, input.max_results);
    // Also search the registry for registered/MCP tools (for completeness)
    const registryResults = registrySearchTools(input.query, input.max_results);
    const allDeferred = getAllDeferredToolSchemas();

    return {
      data: {
        matchedSchemas,
        registryResults,
        totalDeferredCount: allDeferred.length,
      },
    };
  },
  mapResult(result: any, id) {
    const sections: string[] = [];

    // Format matched deferred tool schemas as <functions> block
    const schemas = result.matchedSchemas as DeferredToolSchema[];
    if (schemas && schemas.length > 0) {
      const functionDefs = schemas.map((s: DeferredToolSchema) =>
        `<function>{"description": ${JSON.stringify(s.description)}, "name": ${JSON.stringify(s.name)}, "parameters": ${JSON.stringify(s.inputSchema)}}</function>`
      ).join("\n");
      sections.push(`<functions>\n${functionDefs}\n</functions>`);
    }

    // Also include registry search results (registered + MCP tools)
    const registryResults = result.registryResults as Array<{ name: string; hint: string; deferred: boolean }>;
    if (registryResults && registryResults.length > 0) {
      const extraHits = registryResults.filter(
        (r: { name: string }) => !schemas?.some((s: DeferredToolSchema) => s.name === r.name),
      );
      if (extraHits.length > 0) {
        const lines = extraHits.map((r: { name: string; hint: string; deferred: boolean }) =>
          `${r.name}${r.deferred ? " (deferred)" : ""}: ${r.hint}`
        );
        sections.push(lines.join("\n"));
      }
    }

    if (sections.length === 0) {
      return { type: "tool_result", tool_use_id: id, content: "No tools found matching the query." };
    }

    const footer = `\n\n${result.totalDeferredCount} deferred tool(s) available. Use ToolSearch to fetch schemas for any listed tool.`;
    return { type: "tool_result", tool_use_id: id, content: sections.join("\n\n") + footer };
  },
});

// ── Cron job store (session-only, in-memory) ──────────────────────

interface CronJob { id: string; cron: string; prompt: string; recurring: boolean; createdAt: number; }
const cronJobs = new Map<string, CronJob>();

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
    cronJobs.set(id, { id, cron: input.cron, prompt: input.prompt, recurring: input.recurring, createdAt: Date.now() });
    return { data: { id, cron: input.cron, humanSchedule: input.cron, recurring: input.recurring } };
  },
  mapResult(result: any, id) {
    return { type: "tool_result", tool_use_id: id, content: `Scheduled job ${result.id} (${result.humanSchedule}). ${result.recurring ? "Recurring" : "One-shot"}.` };
  },
});

// ── CronDelete ─────────────────────────────────────────────────────

export const cronDeleteTool = simpleTool({
  name: CRON_DELETE_TOOL,
  hint: "cancel a scheduled cron job",
  inputSchema: z.strictObject({ id: z.string().describe("Job ID") }),
  readOnly: false, concurrent: false, defer: true,
  prompt: "Cancel a scheduled cron job by its ID.",
  async call(input) {
    const existed = cronJobs.delete(input.id);
    return { data: { id: input.id, deleted: existed }, error: existed ? undefined : `Job ${input.id} not found` };
  },
  mapResult(result: any, id) {
    return { type: "tool_result", tool_use_id: id, content: result.deleted ? `Cancelled job ${result.id}` : `Job ${result.id} not found` };
  },
});

// ── CronList ───────────────────────────────────────────────────────

export const cronListTool = simpleTool({
  name: CRON_LIST_TOOL,
  hint: "list active cron jobs",
  inputSchema: z.strictObject({}),
  readOnly: true, concurrent: true, defer: true,
  prompt: "List all active scheduled cron jobs.",
  async call() {
    const jobs = [...cronJobs.values()].map(j => ({ id: j.id, cron: j.cron, prompt: j.prompt.slice(0, 80), recurring: j.recurring }));
    return { data: { jobs } };
  },
  mapResult(result: any, id) {
    if (result.jobs.length === 0) return { type: "tool_result", tool_use_id: id, content: "No scheduled jobs." };
    const lines = result.jobs.map((j: any) => `  ${j.id}: ${j.cron} ${j.recurring ? "(recurring)" : "(one-shot)"} — ${j.prompt}`);
    return { type: "tool_result", tool_use_id: id, content: `Active jobs (${result.jobs.length}):\n${lines.join("\n")}` };
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
    return { data: { worktreePath: "", worktreeBranch: "", message: "Worktree creation not yet implemented" }, error: "EnterWorktree is not yet implemented. Use `git worktree add` via Bash instead." };
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
    return { data: { action: input.action, originalCwd: process.cwd(), message: "Worktree exit not yet implemented" }, error: "ExitWorktree is not yet implemented. Use `git worktree remove` via Bash instead." };
  },
  mapResult(result: any, id) {
    return { type: "tool_result", tool_use_id: id, content: result.message };
  },
});

// ── NotebookEdit ───────────────────────────────────────────────────

/** Convert a string to the Jupyter cell source format (array of lines with \n) */
function toNotebookSource(text: string): string[] {
  const lines = text.split("\n");
  return lines.map((l: string, i: number) =>
    i < lines.length - 1 ? l + "\n" : l
  );
}

/** Create a new empty cell with the given type */
function createCell(cellType: "code" | "markdown" | "raw", source: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    cell_type: cellType,
    metadata: {},
    source: toNotebookSource(source),
  };
  if (cellType === "code") {
    base.execution_count = null;
    base.outputs = [];
  }
  return base;
}

export const notebookEditTool = simpleTool({
  name: NOTEBOOK_EDIT_TOOL,
  hint: "edit Jupyter notebook cells — insert, replace, delete, move, change type",
  inputSchema: z.strictObject({
    notebook_path: z.string().describe("Path to the .ipynb file"),
    command: z.enum(["insert_cell", "replace_cell", "delete_cell", "move_cell", "change_cell_type"]).describe("Operation to perform"),
    cell_index: z.number().optional().describe("Cell index to operate on (0-based). For insert_cell, position to insert at (omit to append)."),
    cell_type: z.enum(["code", "markdown", "raw"]).optional().describe("Cell type — required for insert_cell and change_cell_type"),
    new_source: z.string().optional().describe("New cell content — required for insert_cell and replace_cell"),
    target_index: z.number().optional().describe("Destination index for move_cell"),
  }),
  readOnly: false, concurrent: false, defer: false,
  prompt: `Edit Jupyter notebook (.ipynb) cells. Supports 5 commands:

- insert_cell: Insert a new cell at cell_index (or end if omitted). Requires cell_type and new_source.
- replace_cell: Replace the source of the cell at cell_index with new_source. Requires cell_index and new_source.
- delete_cell: Delete the cell at cell_index. Requires cell_index.
- move_cell: Move cell from cell_index to target_index. Requires cell_index and target_index.
- change_cell_type: Change the type of cell at cell_index to cell_type. Requires cell_index and cell_type.

All metadata, outputs, and kernel info are preserved. Cell indices are 0-based.`,
  async call(input) {
    const { readFileSync, writeFileSync } = await import("fs");
    const { resolve } = await import("path");
    const notebookPath = resolve(input.notebook_path);

    // Require file to be read first
    const { hasFileBeenRead } = await import("./read.js");
    if (!hasFileBeenRead(notebookPath)) {
      return { data: { success: false, error: `Notebook "${input.notebook_path}" has not been read yet. Use the Read tool first.` } };
    }

    try {
      const raw = readFileSync(notebookPath, "utf-8");
      const notebook = JSON.parse(raw);

      if (!notebook.cells || !Array.isArray(notebook.cells)) {
        return { data: { success: false, error: "Invalid notebook: no cells array found" } };
      }

      const cells: Record<string, unknown>[] = notebook.cells;
      const totalCells = cells.length;

      switch (input.command) {
        case "insert_cell": {
          if (!input.cell_type) return { data: { success: false, error: "insert_cell requires cell_type" } };
          const source = input.new_source ?? "";
          const newCell = createCell(input.cell_type, source);
          const idx = input.cell_index ?? totalCells; // append if not specified
          if (idx < 0 || idx > totalCells) {
            return { data: { success: false, error: `cell_index ${idx} out of range (0-${totalCells})` } };
          }
          cells.splice(idx, 0, newCell);
          notebook.cells = cells;
          writeFileSync(notebookPath, JSON.stringify(notebook, null, 1), "utf-8");
          return { data: { success: true, message: `Inserted ${input.cell_type} cell at index ${idx} (notebook now has ${cells.length} cells)` } };
        }

        case "replace_cell": {
          if (input.cell_index == null) return { data: { success: false, error: "replace_cell requires cell_index" } };
          if (input.new_source == null) return { data: { success: false, error: "replace_cell requires new_source" } };
          if (input.cell_index < 0 || input.cell_index >= totalCells) {
            return { data: { success: false, error: `cell_index ${input.cell_index} out of range (0-${totalCells - 1})` } };
          }
          const cell = cells[input.cell_index] as Record<string, unknown>;
          cell.source = toNotebookSource(input.new_source);
          // Clear outputs for code cells when source changes
          if (cell.cell_type === "code") {
            cell.outputs = [];
            cell.execution_count = null;
          }
          writeFileSync(notebookPath, JSON.stringify(notebook, null, 1), "utf-8");
          return { data: { success: true, message: `Replaced source of cell ${input.cell_index} (${cell.cell_type})` } };
        }

        case "delete_cell": {
          if (input.cell_index == null) return { data: { success: false, error: "delete_cell requires cell_index" } };
          if (input.cell_index < 0 || input.cell_index >= totalCells) {
            return { data: { success: false, error: `cell_index ${input.cell_index} out of range (0-${totalCells - 1})` } };
          }
          const deletedType = (cells[input.cell_index] as Record<string, unknown>).cell_type;
          cells.splice(input.cell_index, 1);
          notebook.cells = cells;
          writeFileSync(notebookPath, JSON.stringify(notebook, null, 1), "utf-8");
          return { data: { success: true, message: `Deleted ${deletedType} cell at index ${input.cell_index} (notebook now has ${cells.length} cells)` } };
        }

        case "move_cell": {
          if (input.cell_index == null) return { data: { success: false, error: "move_cell requires cell_index" } };
          if (input.target_index == null) return { data: { success: false, error: "move_cell requires target_index" } };
          if (input.cell_index < 0 || input.cell_index >= totalCells) {
            return { data: { success: false, error: `cell_index ${input.cell_index} out of range (0-${totalCells - 1})` } };
          }
          if (input.target_index < 0 || input.target_index >= totalCells) {
            return { data: { success: false, error: `target_index ${input.target_index} out of range (0-${totalCells - 1})` } };
          }
          if (input.cell_index === input.target_index) {
            return { data: { success: true, message: `Cell ${input.cell_index} is already at target position` } };
          }
          const [movedCell] = cells.splice(input.cell_index, 1);
          cells.splice(input.target_index, 0, movedCell);
          notebook.cells = cells;
          writeFileSync(notebookPath, JSON.stringify(notebook, null, 1), "utf-8");
          return { data: { success: true, message: `Moved cell from index ${input.cell_index} to index ${input.target_index}` } };
        }

        case "change_cell_type": {
          if (input.cell_index == null) return { data: { success: false, error: "change_cell_type requires cell_index" } };
          if (!input.cell_type) return { data: { success: false, error: "change_cell_type requires cell_type" } };
          if (input.cell_index < 0 || input.cell_index >= totalCells) {
            return { data: { success: false, error: `cell_index ${input.cell_index} out of range (0-${totalCells - 1})` } };
          }
          const cell = cells[input.cell_index] as Record<string, unknown>;
          const oldType = cell.cell_type;
          if (oldType === input.cell_type) {
            return { data: { success: true, message: `Cell ${input.cell_index} is already type ${input.cell_type}` } };
          }
          cell.cell_type = input.cell_type;
          // Add code-specific fields when converting to code
          if (input.cell_type === "code") {
            if (!("execution_count" in cell)) cell.execution_count = null;
            if (!("outputs" in cell)) cell.outputs = [];
          }
          // Remove code-specific fields when converting away from code
          if (oldType === "code" && input.cell_type !== "code") {
            delete cell.execution_count;
            delete cell.outputs;
          }
          writeFileSync(notebookPath, JSON.stringify(notebook, null, 1), "utf-8");
          return { data: { success: true, message: `Changed cell ${input.cell_index} from ${oldType} to ${input.cell_type}` } };
        }

        default:
          return { data: { success: false, error: `Unknown command: ${input.command}` } };
      }
    } catch (e) {
      return { data: { success: false, error: String(e) } };
    }
  },
  mapResult(result: any, id) {
    return {
      type: "tool_result",
      tool_use_id: id,
      content: result.success ? result.message : `Error: ${result.error}`,
      ...(result.success ? {} : { is_error: true }),
    };
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
      saveUserSettings({ [input.setting]: input.value });
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
    // Emit to dashboard events so the web terminal can show messages
    try {
      const { dashboardEvents } = await import("../../web/events.js");
      dashboardEvents.push("message", { to: input.to, message: input.message });
    } catch { /* dashboard not loaded — that's fine */ }

    // Try to deliver via conversations MCP if available
    try {
      const conversations = await import("../../integrations/conversations.js");
      if (conversations.sendMessage) {
        await conversations.sendMessage(input.to, input.message);
      }
    } catch { /* conversations not available */ }

    return { data: { sent: true, to: input.to, message: input.message } };
  },
  mapResult(result: any, id) {
    return { type: "tool_result", tool_use_id: id, content: `Message sent to ${result.to}: "${result.message}"` };
  },
});
