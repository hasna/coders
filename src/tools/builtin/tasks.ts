/**
 * Task tools — TaskCreate, TaskGet, TaskList, TaskUpdate
 *
 * Wire up the @hasna/todos integration as built-in tools.
 * These match Claude Code's 25-tools-task.js interface.
 */
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import {
  TASK_CREATE_TOOL,
  TASK_GET_TOOL,
  TASK_LIST_TOOL,
  TASK_UPDATE_TOOL,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
} from "../../core/constants.js";
import { getTodosIntegration, type Task } from "../../integrations/todos.js";
import { parseLimit, sliceWithLimit, truncateLine, compactLongText } from "../../utils/output.js";

// ── Shared schema pieces ───────────────────────────────────────────

const TaskStatusSchema = z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]);

// ── TaskCreate ─────────────────────────────────────────────────────

const TaskCreateInputSchema = z.strictObject({
  subject: z.string().describe("A brief title for the task"),
  description: z.string().describe("A detailed description of what needs to be done"),
  activeForm: z.string().optional().describe('Present continuous form for spinner (e.g., "Running tests")'),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Arbitrary metadata"),
});

type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;

export const taskCreateTool: Tool<TaskCreateInput, { task: { id: string; subject: string } }> = {
  name: TASK_CREATE_TOOL,
  searchHint: "create a task in the task list",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,

  async description() { return "Create a new task"; },
  async prompt() { return TASK_CREATE_PROMPT; },

  get inputSchema() { return TaskCreateInputSchema; },
  get outputSchema() { return z.object({ task: z.object({ id: z.string(), subject: z.string() }) }); },

  userFacingName() { return "TaskCreate"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return false; },
  toAutoClassifierInput(input) { return input.subject; },

  async checkPermissions(input) { return { behavior: "allow", updatedInput: input }; },
  async validateInput(input) {
    if (!input.subject?.trim()) return { result: false, message: "subject is required", errorCode: 1 };
    return { result: true };
  },

  async call(input, context): Promise<ToolCallResult<{ task: { id: string; subject: string } }>> {
    const todos = getTodosIntegration();
    const task = await todos.createTask({
      subject: input.subject,
      description: input.description,
      activeForm: input.activeForm,
      metadata: input.metadata,
    });

    context.setAppState((s) => ({ ...s, expandedView: "tasks" }));
    return { data: { task: { id: task.id, subject: task.subject } } };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: `Task #${result.task.id} created: ${result.task.subject}`,
    };
  },
};

// ── TaskGet ────────────────────────────────────────────────────────

const TaskGetInputSchema = z.strictObject({
  taskId: z.string().describe("The ID of the task to retrieve"),
});

type TaskGetInput = z.infer<typeof TaskGetInputSchema>;

export const taskGetTool: Tool<TaskGetInput, { task: Task | null }> = {
  name: TASK_GET_TOOL,
  searchHint: "retrieve a task by ID",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,

  async description() { return "Get a task by ID"; },
  async prompt() { return TASK_GET_PROMPT; },

  get inputSchema() { return TaskGetInputSchema; },
  get outputSchema() { return z.object({ task: z.any() }); },

  userFacingName() { return "TaskGet"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },
  toAutoClassifierInput(input) { return input.taskId; },

  async checkPermissions(input) { return { behavior: "allow", updatedInput: input }; },
  async validateInput(input) {
    if (!input.taskId?.trim()) return { result: false, message: "taskId is required", errorCode: 1 };
    return { result: true };
  },

  async call(input): Promise<ToolCallResult<{ task: Task | null }>> {
    const todos = getTodosIntegration();
    const task = await todos.getTask(input.taskId);
    return { data: { task } };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    if (!result.task) {
      return { type: "tool_result", tool_use_id: toolUseId, content: "Task not found" };
    }
    const t = result.task;
    const lines = [
      `Task #${t.id}: ${t.subject}`,
      `Status: ${t.status}`,
      `Description: ${compactLongText(t.description, 2_000, "Use task storage directly or JSON export for the full description.")}`,
    ];
    if (t.owner) lines.push(`Owner: ${t.owner}`);
    if (t.blockedBy.length > 0) lines.push(`Blocked by: ${t.blockedBy.map(id => `#${id}`).join(", ")}`);
    if (t.blocks.length > 0) lines.push(`Blocks: ${t.blocks.map(id => `#${id}`).join(", ")}`);
    return { type: "tool_result", tool_use_id: toolUseId, content: lines.join("\n") };
  },
};

// ── TaskList ───────────────────────────────────────────────────────

const TaskListInputSchema = z.strictObject({
  status: TaskStatusSchema.optional().describe("Only list tasks with this status"),
  limit: z.number().optional().describe("Maximum number of tasks to return in the default summary"),
  offset: z.number().optional().describe("Number of matching tasks to skip before rendering the summary"),
  verbose: z.boolean().optional().describe("Include truncated descriptions in the summary"),
});

type TaskListInput = z.infer<typeof TaskListInputSchema>;

interface TaskListOutput {
  tasks: Task[];
  totalCount: number;
  hiddenCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset?: number;
  verbose?: boolean;
}

export const taskListTool: Tool<TaskListInput, TaskListOutput> = {
  name: TASK_LIST_TOOL,
  searchHint: "list all tasks",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,

  async description() { return "List all tasks"; },
  async prompt() { return TASK_LIST_PROMPT; },

  get inputSchema() { return TaskListInputSchema; },
  get outputSchema() { return z.object({ tasks: z.array(z.any()), totalCount: z.number(), hiddenCount: z.number(), limit: z.number(), offset: z.number(), hasMore: z.boolean(), nextOffset: z.number().optional(), verbose: z.boolean().optional() }); },

  userFacingName() { return "TaskList"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },
  toAutoClassifierInput() { return ""; },

  async checkPermissions(input) { return { behavior: "allow", updatedInput: input }; },
  async validateInput() { return { result: true }; },

  async call(input = {}): Promise<ToolCallResult<TaskListOutput>> {
    const todos = getTodosIntegration();
    const allTasks = await todos.listTasks(input.status ? { status: input.status } : undefined);
    const limit = parseLimit(input.limit, 20, 200);
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const shown = Math.min(limit, Math.max(0, allTasks.length - offset));
    const hidden = Math.max(0, allTasks.length - offset - shown);
    return {
      data: {
        tasks: allTasks,
        totalCount: allTasks.length,
        hiddenCount: hidden,
        limit,
        offset,
        hasMore: hidden > 0,
        nextOffset: hidden > 0 ? offset + shown : undefined,
        verbose: input.verbose,
      },
    };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    const totalCount = result.totalCount ?? result.tasks.length;
    const limit = result.limit ?? Math.max(result.tasks.length, 20);
    const offset = result.offset ?? 0;
    const { items: visibleTasks, hidden } = sliceWithLimit(result.tasks.slice(offset), limit);
    const hiddenCount = result.hiddenCount ?? hidden;
    const nextOffset = result.nextOffset ?? (hiddenCount > 0 ? offset + visibleTasks.length : undefined);
    if (totalCount === 0) {
      return { type: "tool_result", tool_use_id: toolUseId, content: "No tasks found" };
    }
    const lines = visibleTasks.map((t) => {
      const owner = t.owner ? ` (${t.owner})` : "";
      const blocked = t.blockedBy.length > 0 ? ` [blocked by ${t.blockedBy.map(id => `#${id}`).join(", ")}]` : "";
      const subject = truncateLine(t.subject, 100);
      const description = result.verbose && t.description
        ? ` — ${truncateLine(t.description, 160)}`
        : "";
      return `#${t.id} [${t.status}] ${subject}${owner}${blocked}${description}`;
    });
    const footer = hiddenCount > 0
      ? `\n\n${hiddenCount} more task(s) hidden. Use TaskList with offset:${nextOffset} limit:${limit}, or TaskGet for details.`
      : "\n\nUse TaskGet with an ID for full details.";
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: `Tasks (${offset + visibleTasks.length}/${totalCount}, showing ${visibleTasks.length}):\n${lines.join("\n")}${footer}`,
    };
  },
};

// ── TaskUpdate ─────────────────────────────────────────────────────

const TaskUpdateInputSchema = z.strictObject({
  taskId: z.string().describe("The ID of the task to update"),
  subject: z.string().optional().describe("New subject"),
  description: z.string().optional().describe("New description"),
  activeForm: z.string().optional().describe("New active form"),
  status: TaskStatusSchema.or(z.literal("deleted")).optional().describe("New status"),
  owner: z.string().optional().describe("New owner"),
  addBlocks: z.array(z.string()).optional().describe("Task IDs this task blocks"),
  addBlockedBy: z.array(z.string()).optional().describe("Task IDs that block this task"),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Metadata to merge"),
});

type TaskUpdateInput = z.infer<typeof TaskUpdateInputSchema>;

interface TaskUpdateOutput {
  success: boolean;
  taskId: string;
  updatedFields: string[];
  error?: string;
  statusChange?: { from: string; to: string };
}

export const taskUpdateTool: Tool<TaskUpdateInput, TaskUpdateOutput> = {
  name: TASK_UPDATE_TOOL,
  searchHint: "update a task",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,

  async description() { return "Update a task"; },
  async prompt() { return TASK_UPDATE_PROMPT; },

  get inputSchema() { return TaskUpdateInputSchema; },
  get outputSchema() { return z.object({ success: z.boolean(), taskId: z.string(), updatedFields: z.array(z.string()), error: z.string().optional() }); },

  userFacingName() { return "TaskUpdate"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return false; },
  toAutoClassifierInput(input) { return `${input.taskId} ${input.status ?? ""}`; },

  async checkPermissions(input) { return { behavior: "allow", updatedInput: input }; },
  async validateInput() { return { result: true }; },

  async call(input, context): Promise<ToolCallResult<TaskUpdateOutput>> {
    const todos = getTodosIntegration();
    const existing = await todos.getTask(input.taskId);
    if (!existing) {
      return { data: { success: false, taskId: input.taskId, updatedFields: [], error: "Task not found" } };
    }

    // Handle delete
    if (input.status === "deleted") {
      await todos.deleteTask(input.taskId);
      return { data: { success: true, taskId: input.taskId, updatedFields: ["deleted"], statusChange: { from: existing.status, to: "deleted" } } };
    }

    const fields: string[] = [];
    const update: Record<string, unknown> = {};

    if (input.subject !== undefined) { update.subject = input.subject; fields.push("subject"); }
    if (input.description !== undefined) { update.description = input.description; fields.push("description"); }
    if (input.activeForm !== undefined) { update.activeForm = input.activeForm; fields.push("activeForm"); }
    if (input.status !== undefined) { update.status = input.status; fields.push("status"); }
    if (input.owner !== undefined) { update.owner = input.owner; fields.push("owner"); }
    if (input.metadata !== undefined) { update.metadata = { ...existing.metadata, ...input.metadata }; fields.push("metadata"); }

    if (Object.keys(update).length > 0) {
      await todos.updateTask(input.taskId, update);
    }

    // Handle dependencies
    if (input.addBlocks) {
      for (const blockedId of input.addBlocks) {
        await todos.addDependency(input.taskId, blockedId);
      }
      fields.push("blocks");
    }
    if (input.addBlockedBy) {
      for (const blockerId of input.addBlockedBy) {
        await todos.addDependency(blockerId, input.taskId);
      }
      fields.push("blockedBy");
    }

    context.setAppState((s) => ({ ...s, expandedView: "tasks" }));
    return {
      data: {
        success: true,
        taskId: input.taskId,
        updatedFields: fields,
        statusChange: input.status ? { from: existing.status, to: input.status } : undefined,
      },
    };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    if (!result.success) {
      return { type: "tool_result", tool_use_id: toolUseId, content: result.error ?? "Update failed" };
    }
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: `Updated task #${result.taskId}: ${result.updatedFields.join(", ")}`,
    };
  },
};

// ── Prompts ────────────────────────────────────────────────────────

const TASK_CREATE_PROMPT = `Create a new task in the task list. Use proactively for multi-step tasks.`;
const TASK_GET_PROMPT = `Get a task by ID to view full details including description and dependencies.`;
const TASK_LIST_PROMPT = `List tasks compactly to see status, owners, and blockers. Use status to filter, limit and offset to page rows, verbose:true for description previews, and TaskGet for full task details.`;
const TASK_UPDATE_PROMPT = `Update a task: change status, subject, description, owner, or dependencies. Use "deleted" status to remove.`;
