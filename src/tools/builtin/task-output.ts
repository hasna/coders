/**
 * TaskOutput + TaskStop tools — let the AI check on and control background tasks.
 *
 * TaskOutput: check status/output of a background task (bash or agent).
 * TaskStop: kill a running background task.
 *
 * Used when the AI starts a bash command or agent in the background and
 * needs to check its status/output later, or kill it.
 */
import { z } from "zod";
import type { Tool, ToolCallResult } from "../interface.js";
import {
  TASK_OUTPUT_TOOL,
  TASK_STOP_TOOL,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
} from "../../core/constants.js";
import {
  getTask,
  killTask,
  readTaskOutput,
  type BackgroundTask,
} from "../../core/background-tasks.js";

// ── Max output chars to return in a single call ─────────────────────

const MAX_OUTPUT_CHARS = 30_000;

// ══════════════════════════════════════════════════════════════════════
// TaskOutput Tool
// ══════════════════════════════════════════════════════════════════════

const TaskOutputInputSchema = z.strictObject({
  task_id: z.string().describe("The ID of the background task to check (e.g. 'bg-1', 'agent-2')"),
});

type TaskOutputInput = z.infer<typeof TaskOutputInputSchema>;

interface TaskOutputResult {
  task_id: string;
  status: string;
  output: string;
  exitCode?: number | null;
  durationMs?: number;
  error?: string;
  progress?: BackgroundTask["progress"];
}

const TaskOutputOutputSchema = z.object({
  task_id: z.string(),
  status: z.string(),
  output: z.string(),
  exitCode: z.number().nullable().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  progress: z.object({
    tokenCount: z.number().optional(),
    lastActivity: z.string().optional(),
  }).optional(),
});

export const taskOutputTool: Tool<TaskOutputInput, TaskOutputResult> = {
  name: TASK_OUTPUT_TOOL,
  searchHint: "check status and output of a background task",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,

  async description() { return "Check the status and output of a background task"; },
  async prompt() { return TASK_OUTPUT_PROMPT; },

  get inputSchema() { return TaskOutputInputSchema; },
  get outputSchema() { return TaskOutputOutputSchema; },

  userFacingName() { return "TaskOutput"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return true; },

  toAutoClassifierInput(input) { return input.task_id; },

  getActivityDescription(input) { return `Checking task ${input.task_id}`; },

  async validateInput(input) {
    if (!input.task_id || !input.task_id.trim()) {
      return { result: false, message: "task_id is required", errorCode: 1 };
    }
    return { result: true };
  },

  async checkPermissions(input) {
    // Read-only — always allowed
    return { behavior: "allow", updatedInput: input };
  },

  async call(input): Promise<ToolCallResult<TaskOutputResult>> {
    const task = getTask(input.task_id);

    if (!task) {
      return {
        data: {
          task_id: input.task_id,
          status: "not_found",
          output: `No background task found with ID "${input.task_id}". Use TaskList or check the ID returned when you started the background task.`,
          error: `Task "${input.task_id}" not found`,
        },
      };
    }

    // Read output (prefer disk for large output, fall back to in-memory)
    let output = readTaskOutput(task.id);
    if (!output && task.output) output = task.output;

    // Truncate if needed
    if (output.length > MAX_OUTPUT_CHARS) {
      const half = Math.floor(MAX_OUTPUT_CHARS / 2);
      output = output.slice(0, half)
        + `\n\n... (${output.length - MAX_OUTPUT_CHARS} characters truncated) ...\n\n`
        + output.slice(-half);
    }

    const durationMs = task.endTime
      ? task.endTime - task.startTime
      : Date.now() - task.startTime;

    return {
      data: {
        task_id: task.id,
        status: task.status,
        output: output || "(no output yet)",
        exitCode: task.exitCode,
        durationMs,
        error: task.error,
        progress: task.progress,
      },
    };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    const parts: string[] = [];

    parts.push(`Task: ${result.task_id}`);
    parts.push(`Status: ${result.status}`);

    if (result.durationMs != null) {
      const sec = (result.durationMs / 1000).toFixed(1);
      parts.push(`Duration: ${sec}s`);
    }

    if (result.exitCode != null) {
      parts.push(`Exit code: ${result.exitCode}`);
    }

    if (result.progress?.tokenCount) {
      parts.push(`Tokens: ${result.progress.tokenCount}`);
    }

    if (result.progress?.lastActivity) {
      parts.push(`Last activity: ${result.progress.lastActivity}`);
    }

    if (result.error) {
      parts.push(`Error: ${result.error}`);
    }

    parts.push("");
    parts.push(result.output);

    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: parts.join("\n"),
      is_error: result.status === "not_found",
    };
  },
};

// ══════════════════════════════════════════════════════════════════════
// TaskStop Tool
// ══════════════════════════════════════════════════════════════════════

const TaskStopInputSchema = z.strictObject({
  task_id: z.string().describe("The ID of the background task to stop (e.g. 'bg-1', 'agent-2')"),
});

type TaskStopInput = z.infer<typeof TaskStopInputSchema>;

interface TaskStopResult {
  task_id: string;
  status: string;
  message: string;
}

const TaskStopOutputSchema = z.object({
  task_id: z.string(),
  status: z.string(),
  message: z.string(),
});

export const taskStopTool: Tool<TaskStopInput, TaskStopResult> = {
  name: TASK_STOP_TOOL,
  searchHint: "stop kill a running background task",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,

  async description() { return "Stop a running background task"; },
  async prompt() { return TASK_STOP_PROMPT; },

  get inputSchema() { return TaskStopInputSchema; },
  get outputSchema() { return TaskStopOutputSchema; },

  userFacingName() { return "TaskStop"; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return false; },

  toAutoClassifierInput(input) { return input.task_id; },

  getActivityDescription(input) { return `Stopping task ${input.task_id}`; },

  async validateInput(input) {
    if (!input.task_id || !input.task_id.trim()) {
      return { result: false, message: "task_id is required", errorCode: 1 };
    }
    return { result: true };
  },

  async checkPermissions(input) {
    return { behavior: "allow", updatedInput: input };
  },

  async call(input): Promise<ToolCallResult<TaskStopResult>> {
    const task = getTask(input.task_id);

    if (!task) {
      return {
        data: {
          task_id: input.task_id,
          status: "not_found",
          message: `No background task found with ID "${input.task_id}".`,
        },
      };
    }

    if (task.status !== "running") {
      return {
        data: {
          task_id: task.id,
          status: task.status,
          message: `Task ${task.id} is already ${task.status} — cannot stop.`,
        },
      };
    }

    killTask(task.id);

    return {
      data: {
        task_id: task.id,
        status: "killed",
        message: `Task ${task.id} has been killed.`,
      },
    };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: result.message,
      is_error: result.status === "not_found",
    };
  },
};

// ── Prompts ─────────────────────────────────────────────────────────

const TASK_OUTPUT_PROMPT = `Check the status and output of a background task.

Use this tool when you have previously started a bash command or agent with run_in_background:true
and need to check whether it has completed, and retrieve its output.

The task_id is returned when you start a background task (e.g., "bg-1" for bash, "agent-1" for agents).

The tool returns:
- status: "running", "completed", "failed", or "killed"
- output: The stdout/stderr from the task (truncated to 30000 chars)
- exitCode: The exit code (for bash tasks)
- durationMs: How long the task has been running or ran
- progress: For agents, includes tokenCount and lastActivity`;

const TASK_STOP_PROMPT = `Stop a running background task.

Use this tool to kill a background bash command or agent that is still running.
The task will be marked as "killed" and its process terminated.

The task_id is returned when you start a background task (e.g., "bg-1" for bash, "agent-1" for agents).`;
